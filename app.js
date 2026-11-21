(() => {
  const ASSET_V = "7";
  const SIDES = ["Scott's dad's side", "Scott's mum's side", "Ours", "Rachel's side", "Friends"];
  const PASS_KEY = "yule_passwords_v1";
  const OLD_PASS_KEYS = ["sleigh_passwords_v1", "wrapnest_passwords_v1", "mantel_passwords_v1"];
  const YEAR = window.YuleSync?.YEAR || 2026;

  let people = [];
  let house = {};
  let activeId = null;
  const passwords = loadPasswords();

  const sync = window.YuleSync.create({
    year: YEAR,
    onRemoteChange: async (rows, settings) => {
      house = settings || house;
      people = await decorate(rows);
      render();
    },
  });

  function loadPasswords() {
    try {
      let merged = {};
      for (const key of OLD_PASS_KEYS) {
        const old = JSON.parse(localStorage.getItem(key) || "{}");
        if (old && typeof old === "object") merged = { ...merged, ...old };
      }
      const next = JSON.parse(localStorage.getItem(PASS_KEY) || "{}");
      return { ...merged, ...(next && typeof next === "object" ? next : {}) };
    } catch {
      return {};
    }
  }

  function money(n) {
    if (n == null || n === "" || !Number.isFinite(Number(n))) return "—";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n));
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function spentOf(person) {
    return (person.purchases || []).reduce((sum, buy) => sum + (Number(buy.price) || 0), 0);
  }

  function householdSpent() {
    return people.filter((person) => person._open).reduce((sum, person) => sum + spentOf(person), 0);
  }

  function budgetCap() {
    if (house.budget == null || house.budget === "") return null;
    const cap = Number(house.budget);
    return Number.isFinite(cap) ? cap : null;
  }

  function lastYearTotals() {
    let budget = 0;
    let spent = 0;
    let hasBudget = false;
    let hasSpent = false;
    for (const person of people) {
      if (person.last_year_budget != null && person.last_year_budget !== "") {
        budget += Number(person.last_year_budget) || 0;
        hasBudget = true;
      }
      if (person.last_year_spent != null && person.last_year_spent !== "") {
        spent += Number(person.last_year_spent) || 0;
        hasSpent = true;
      }
    }
    return { budget: hasBudget ? budget : null, spent: hasSpent ? spent : null };
  }

  async function decorate(rows) {
    const out = [];
    for (const row of rows) {
      const person = {
        ...row,
        ideas: row.ideas || [],
        purchases: row.purchases || [],
        _open: !row.locked,
      };
      if (row.locked) {
        const pw = passwords[row.id];
        if (pw && row.ciphertext) {
          try {
            const secret = await window.WrapNestCrypto.decryptSecret(pw, row.salt, row.iv, row.ciphertext);
            person.budget = secret.budget ?? null;
            person.ideas = Array.isArray(secret.ideas) ? secret.ideas : [];
            person.purchases = Array.isArray(secret.purchases) ? secret.purchases : [];
            person.last_year_note = secret.last_year_note || person.last_year_note || "";
            person.note = secret.note || "";
            person.wrapped = Boolean(secret.wrapped);
            person._open = true;
          } catch {
            person._open = false;
            person.budget = null;
            person.ideas = [];
            person.purchases = [];
          }
        } else {
          person._open = false;
          person.budget = null;
          person.ideas = [];
          person.purchases = [];
        }
      }
      out.push(person);
    }
    out.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return out;
  }

  function secretPayload(person) {
    return {
      budget: person.budget,
      ideas: person.ideas || [],
      purchases: person.purchases || [],
      last_year_note: person.last_year_note || "",
      note: person.note || "",
      wrapped: Boolean(person.wrapped),
    };
  }

  function personById(id) {
    return people.find((person) => person.id === id) || null;
  }

  function setPill(text, live) {
    const pill = document.getElementById("syncPill");
    pill.textContent = text;
    pill.classList.toggle("is-live", Boolean(live));
    pill.classList.toggle("is-off", !live);
  }

  async function savePerson(person) {
    const row = { ...person };
    if (person.locked && person._open) {
      const pw = passwords[person.id];
      if (!pw) throw new Error("Password missing for locked person");
      const packed = await window.WrapNestCrypto.encryptSecret(pw, secretPayload(person));
      row.salt = packed.salt;
      row.iv = packed.iv;
      row.ciphertext = packed.ciphertext;
    } else if (!person.locked) {
      row.salt = null;
      row.iv = null;
      row.ciphertext = null;
    }
    people = people.map((item) => (item.id === person.id ? { ...person } : item));
    render();
    await sync.upsert(row);
  }

  async function run(task) {
    try {
      await task();
      setPill(sync.ready() ? "Live" : "On this phone", sync.ready());
    } catch (err) {
      console.warn(err);
      setPill("Not saved", false);
    }
  }

  function render() {
    renderBudget();
    renderPeople();
    if (activeId) renderPerson(activeId);
  }

  function renderBudget() {
    const cap = budgetCap();
    const spent = householdSpent();
    const left = cap == null ? null : cap - spent;
    const last = lastYearTotals();
    const over = left != null && left < 0;
    const root = document.getElementById("budgetCard");
    const lastBits = [];
    if (last.budget != null) lastBits.push(`${money(last.budget)} budget`);
    if (last.spent != null) lastBits.push(`${money(last.spent)} spent`);
    const balance = cap == null ? `${money(spent)} spent` : `${money(spent)} spent · ${over ? `${money(Math.abs(left))} over` : `${money(left)} left`}`;
    root.innerHTML = `
      <article class="hero">
        <p class="hero-kicker">This year</p>
        <p class="hero-left ${over ? "is-over" : ""}">${cap == null ? "No budget yet" : money(cap)}</p>
        <p class="hero-sub">${balance}</p>
        <button type="button" class="primary" id="editBudget">${cap == null ? "Add a budget" : "Change budget"}</button>
      </article>
      <article class="card">
        <h2>Last year</h2>
        <p class="last-line">${lastBits.length ? lastBits.join(" · ") : "Nothing saved from last year."}</p>
      </article>
    `;
    document.getElementById("editBudget").addEventListener("click", () => {
      document.getElementById("budgetInput").value = cap == null ? "" : String(cap);
      document.getElementById("budgetModal").showModal();
      document.getElementById("budgetInput").focus();
    });
  }

  function sideNames() {
    const names = [...SIDES];
    for (const person of people) {
      const name = (person.group_name || "").trim();
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  }

  function sideOptions(selected) {
    return sideNames()
      .map((name) => `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");
  }

  function budgetState(person) {
    if (person.budget == null || person.budget === "" || !Number.isFinite(Number(person.budget))) return "none";
    return spentOf(person) > Number(person.budget) + 0.009 ? "over" : "in";
  }

  function personSummary(person) {
    if (!person._open) return { text: "Hidden on this phone", over: false };
    const ideas = person.ideas.length;
    const bought = (person.purchases || []).length;
    const state = budgetState(person);
    const status = state === "over" ? "Over budget" : state === "in" ? "In budget" : "No budget";
    return {
      text: `${ideas} idea${ideas === 1 ? "" : "s"} · ${bought} bought · ${status}`,
      over: state === "over",
    };
  }

  function renderPeople() {
    const list = document.getElementById("peopleList");
    const empty = document.getElementById("peopleEmpty");
    empty.hidden = people.length > 0;
    const sections = [];
    for (const name of sideNames()) {
      const members = people.filter((person) => (person.group_name || "").trim() === name);
      if (members.length) sections.push([name, members]);
    }
    const loose = people.filter((person) => !(person.group_name || "").trim());
    if (loose.length) sections.push(["No side", loose]);

    list.innerHTML = sections
      .map(([name, members]) => {
        const rows = members
          .map((person) => {
            const summary = personSummary(person);
            return `<a class="person-row" href="${escapeHtml(personHref(person.id))}">
              <strong>${escapeHtml(person.name)}</strong>
              <span class="${summary.over ? "is-over" : ""}">${escapeHtml(summary.text)}</span>
            </a>`;
          })
          .join("");
        return `<h2 class="group-label">${escapeHtml(name)}</h2>${rows}`;
      })
      .join("");
  }

  function listHref() {
    const url = new URL(location.href);
    url.searchParams.delete("person");
    url.hash = "";
    return url.pathname + url.search;
  }

  function personHref(id) {
    const url = new URL(location.href);
    url.searchParams.set("person", id);
    url.hash = "";
    return url.pathname + url.search;
  }

  function goToList() {
    location.replace(listHref());
  }

  function renderPerson(id) {
    const person = personById(id);
    const body = document.getElementById("personBody");
    if (!person) {
      goToList();
      return;
    }
    const lastBits = [];
    if (person.last_year_budget != null && person.last_year_budget !== "") lastBits.push(`${money(person.last_year_budget)} budget`);
    if (person.last_year_spent != null && person.last_year_spent !== "") lastBits.push(`${money(person.last_year_spent)} spent`);

    if (!person._open) {
      body.innerHTML = `
        <label class="name-label">
          <span>Name</span>
          <input id="editName" type="text" maxlength="80" value="${escapeHtml(person.name)}" autocomplete="off" />
        </label>
        <label class="name-label">
          <span>Side</span>
          <select id="editSide">${sideOptions(person.group_name || "")}</select>
        </label>
        <p class="hint">Ideas and purchases are hidden on this phone.</p>
        ${lastBits.length ? `<p class="last-line">Last year · ${lastBits.join(" · ")}</p>` : ""}
        <button type="button" class="danger" data-action="remove-person">Remove person</button>
      `;
      bindPerson(person);
      return;
    }

    body.innerHTML = `
      <label class="name-label">
        <span>Name</span>
        <input id="editName" type="text" maxlength="80" value="${escapeHtml(person.name)}" autocomplete="off" />
      </label>
      <label class="name-label">
        <span>Side</span>
        <select id="editSide">${sideOptions(person.group_name || "")}</select>
      </label>
      ${lastBits.length ? `<p class="last-line">Last year · ${lastBits.join(" · ")}</p>` : ""}
      <h3>Ideas</h3>
      ${
        person.ideas.length
          ? person.ideas
              .map(
                (idea) => `<div class="line">
            <span>${escapeHtml(idea.text)}</span>
            <button type="button" class="danger" data-action="drop-idea" data-id="${escapeHtml(idea.id)}">Remove</button>
          </div>`
              )
              .join("")
          : `<p class="hint">No ideas yet.</p>`
      }
      <form class="add-line" id="ideaForm">
        <input id="ideaInput" type="text" maxlength="160" placeholder="Add an idea" autocomplete="off" />
        <button type="submit" class="primary">Add</button>
      </form>
      <h3>Bought</h3>
      ${
        person.purchases.length
          ? person.purchases
              .map(
                (buy) => `<div class="line">
            <span>${escapeHtml(buy.item)} · ${money(buy.price)}</span>
            <button type="button" class="danger" data-action="drop-buy" data-id="${escapeHtml(buy.id)}">Remove</button>
          </div>`
              )
              .join("")
          : `<p class="hint">Nothing bought yet.</p>`
      }
      <form class="add-buy" id="buyForm">
        <input id="buyItem" type="text" maxlength="160" placeholder="What" autocomplete="off" required />
        <input id="buyPrice" type="number" inputmode="decimal" min="0" step="0.01" placeholder="£" required />
        <button type="submit" class="primary">Add</button>
      </form>
      <button type="button" class="danger remove-person" data-action="remove-person">Remove person</button>
    `;
    bindPerson(person);
  }

  function bindPerson(person) {
    const nameInput = document.getElementById("editName");
    nameInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nameInput.blur();
      }
    });
    nameInput?.addEventListener("change", () => {
      const next = personById(person.id);
      if (!next) return;
      const name = nameInput.value.trim();
      if (!name || name === next.name) {
        nameInput.value = next.name;
        return;
      }
      next.name = name;
      run(() => savePerson(next));
    });
    document.getElementById("editSide")?.addEventListener("change", (event) => {
      const next = personById(person.id);
      if (!next) return;
      next.group_name = event.target.value;
      run(() => savePerson(next));
    });

    document.getElementById("ideaForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("ideaInput");
      const text = (input?.value || "").trim();
      const next = personById(person.id);
      if (!text || !next || !next._open) return;
      next.ideas = [
        { id: crypto.randomUUID(), text, estimate: null, must: false, createdAt: new Date().toISOString() },
        ...(next.ideas || []),
      ];
      run(() => savePerson(next));
    });

    document.getElementById("buyForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = personById(person.id);
      const item = (document.getElementById("buyItem")?.value || "").trim();
      const price = Number(document.getElementById("buyPrice")?.value);
      if (!next || !next._open || !item || !Number.isFinite(price) || price < 0) return;
      next.purchases = [
        { id: crypto.randomUUID(), item, price, shop: "", createdAt: new Date().toISOString() },
        ...(next.purchases || []),
      ];
      run(() => savePerson(next));
    });

    document.getElementById("personBody").querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(person.id, btn.dataset.action, btn.dataset.id));
    });
  }

  function handleAction(personId, action, itemId) {
    const person = personById(personId);
    if (!person) return;
    if (action === "remove-person") {
      if (!confirm(`Remove ${person.name}?`)) return;
      people = people.filter((item) => item.id !== personId);
      run(async () => {
        await sync.remove(personId);
        goToList();
      });
      return;
    }
    if (!person._open) return;
    if (action === "drop-idea") {
      person.ideas = person.ideas.filter((idea) => idea.id !== itemId);
      run(() => savePerson(person));
      return;
    }
    if (action === "drop-buy") {
      person.purchases = person.purchases.filter((buy) => buy.id !== itemId);
      run(() => savePerson(person));
    }
  }

  document.getElementById("personBack").addEventListener("click", (event) => {
    event.preventDefault();
    goToList();
  });
  document.getElementById("addPersonBtn").addEventListener("click", () => {
    document.getElementById("addName").value = "";
    document.getElementById("addSide").innerHTML = sideOptions(sideNames()[0] || "");
    document.getElementById("addModal").showModal();
    document.getElementById("addName").focus();
  });
  document.getElementById("addCancel").addEventListener("click", () => document.getElementById("addModal").close());
  document.getElementById("addForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("addName").value.trim();
    if (!name) return;
    const person = {
      id: crypto.randomUUID(),
      year: YEAR,
      name,
      group_name: document.getElementById("addSide").value,
      sort_order: people.reduce((max, item) => Math.max(max, item.sort_order || 0), 0) + 10,
      locked: false,
      budget: null,
      ideas: [],
      purchases: [],
      last_year_note: "",
      last_year_spent: null,
      last_year_budget: null,
      wrapped: false,
      note: "",
      _open: true,
    };
    people = [...people, person];
    document.getElementById("addModal").close();
    run(async () => {
      await savePerson(person);
      location.assign(personHref(person.id));
    });
  });

  document.getElementById("budgetCancel").addEventListener("click", () => document.getElementById("budgetModal").close());
  document.getElementById("budgetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const budget = Number(document.getElementById("budgetInput").value);
    if (!Number.isFinite(budget) || budget < 0) return;
    house = { ...house, budget };
    document.getElementById("budgetModal").close();
    render();
    run(() => sync.saveSettings({ budget }));
  });

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(`service-worker.js?v=${ASSET_V}`)
        .then((reg) => {
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          reg.update().catch(() => {});
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") reg.update().catch(() => {});
          });
        })
        .catch(() => {});
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && ["YULE_SW_UPDATED", "SLEIGH_SW_UPDATED", "WRAPNEST_SW_UPDATED"].includes(event.data.type) && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  async function boot() {
    const requestedId = new URLSearchParams(location.search).get("person");
    registerServiceWorker();
    setPill(sync.ready() ? "Live" : "On this phone", sync.ready());
    try {
      const fresh = await sync.hydrate();
      house = fresh.settings || {};
      people = await decorate(fresh.people);
    } catch (err) {
      console.warn(err);
      house = sync.settings();
      people = await decorate(sync.readCache());
      setPill("On this phone", false);
    }
    render();
    if (requestedId && personById(requestedId)) {
      activeId = requestedId;
      document.getElementById("personSheet").hidden = false;
      renderPerson(requestedId);
    }
    sync.subscribe();
  }

  boot();
})();
