(() => {
  const ASSET_V = "1";
  const PASS_KEY = "wrapnest_passwords_v1";
  const YEAR = window.WrapNestSync?.YEAR || 2026;

  const peopleList = document.getElementById("peopleList");
  const peopleEmpty = document.getElementById("peopleEmpty");
  const peopleHint = document.getElementById("peopleHint");
  const search = document.getElementById("search");
  const syncPill = document.getElementById("syncPill");
  const personSheet = document.getElementById("personSheet");
  const personBody = document.getElementById("personBody");
  const addModal = document.getElementById("addModal");
  const lockModal = document.getElementById("lockModal");
  const priceModal = document.getElementById("priceModal");
  const totalsView = document.getElementById("totalsView");

  let people = [];
  let activeId = null;
  let lockMode = "lock";
  let priceContext = null;
  let passwords = loadPasswords();

  const sync = window.WrapNestSync.create({
    year: YEAR,
    onRemoteChange: async (rows) => {
      people = await decorate(rows);
      render();
    },
  });

  function loadPasswords() {
    try {
      const raw = JSON.parse(localStorage.getItem(PASS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function savePasswords() {
    try {
      localStorage.setItem(PASS_KEY, JSON.stringify(passwords));
    } catch {
      /* ignore */
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

  function leftOf(person) {
    if (person.budget == null || person.budget === "") return null;
    return Number(person.budget) - spentOf(person);
  }

  function groups() {
    const seen = [];
    for (const person of people) {
      const name = person.group_name || "Ungrouped";
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }

  async function decorate(rows) {
    const out = [];
    for (const row of rows) {
      const person = { ...row, ideas: row.ideas || [], purchases: row.purchases || [], _open: !row.locked };
      if (row.locked) {
        const pw = passwords[row.id];
        if (pw && row.ciphertext) {
          try {
            const secret = await window.WrapNestCrypto.decryptSecret(pw, row.salt, row.iv, row.ciphertext);
            person.budget = secret.budget ?? null;
            person.ideas = Array.isArray(secret.ideas) ? secret.ideas : [];
            person.purchases = Array.isArray(secret.purchases) ? secret.purchases : [];
            person.last_year_note = secret.last_year_note || "";
            person._open = true;
          } catch {
            person._open = false;
            person.budget = null;
            person.ideas = [];
            person.purchases = [];
            person.last_year_note = "";
          }
        } else {
          person._open = false;
          person.budget = null;
          person.ideas = [];
          person.purchases = [];
          person.last_year_note = "";
        }
      }
      out.push(person);
    }
    out.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return out;
  }

  async function savePerson(person) {
    const row = { ...person };
    if (person.locked && person._open) {
      const pw = passwords[person.id];
      if (!pw) throw new Error("Password missing for locked person");
      const packed = await window.WrapNestCrypto.encryptSecret(pw, {
        budget: person.budget,
        ideas: person.ideas || [],
        purchases: person.purchases || [],
        last_year_note: person.last_year_note || "",
      });
      row.salt = packed.salt;
      row.iv = packed.iv;
      row.ciphertext = packed.ciphertext;
    } else if (!person.locked) {
      row.salt = null;
      row.iv = null;
      row.ciphertext = null;
    }
    people = people.map((p) => (p.id === person.id ? { ...person } : p));
    render();
    await sync.upsert(row);
  }

  function personById(id) {
    return people.find((p) => p.id === id) || null;
  }

  function render() {
    renderPeople();
    renderTotals();
    if (activeId) renderPerson(activeId);
    const addGroups = document.getElementById("groupOptions");
    if (addGroups) {
      addGroups.innerHTML = groups()
        .map((g) => `<option value="${escapeHtml(g)}"></option>`)
        .join("");
    }
  }

  function renderPeople() {
    const q = (search.value || "").trim().toLowerCase();
    const visible = people.filter((p) => {
      if (!q) return true;
      return `${p.name} ${p.group_name}`.toLowerCase().includes(q);
    });
    peopleEmpty.hidden = visible.length > 0;
    peopleHint.hidden = !people.length;
    peopleList.innerHTML = "";
    let lastGroup = null;
    for (const person of visible) {
      const group = person.group_name || "Ungrouped";
      if (group !== lastGroup) {
        const label = document.createElement("h2");
        label.className = "group-label";
        label.textContent = group;
        peopleList.appendChild(label);
        lastGroup = group;
      }
      const spent = spentOf(person);
      const left = leftOf(person);
      const pct =
        person._open && person.budget
          ? Math.min(100, Math.max(0, (spent / Number(person.budget)) * 100))
          : 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "person-card";
      btn.dataset.id = person.id;
      const leftLabel = !person._open
        ? "Locked"
        : left == null
          ? "No budget"
          : left < 0
            ? `${money(Math.abs(left))} over`
            : `${money(left)} left`;
      const leftClass = !person._open ? "is-lock" : left != null && left < 0 ? "is-over" : "";
      const meta = !person._open
        ? "Budget, ideas and buys are hidden"
        : `${person.ideas.length} idea${person.ideas.length === 1 ? "" : "s"} · ${person.purchases.length} bought`;
      btn.innerHTML = `
        <strong>${escapeHtml(person.name)}${person.locked ? " 🔒" : ""}</strong>
        <span class="left ${leftClass}">${escapeHtml(leftLabel)}</span>
        <span class="meta">${escapeHtml(meta)}</span>
        ${
          person._open && person.budget
            ? `<div class="progress${left != null && left < 0 ? " is-over" : ""}"><span style="width:${pct}%"></span></div>`
            : ""
        }
      `;
      btn.addEventListener("click", () => openPerson(person.id));
      peopleList.appendChild(btn);
    }
  }

  function renderTotals() {
    const open = people.filter((p) => p._open);
    const hidden = people.filter((p) => !p._open).length;
    const budget = open.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
    const spent = open.reduce((sum, p) => sum + spentOf(p), 0);
    const left = budget - spent;
    const byGroup = groups().map((group) => {
      const members = open.filter((p) => (p.group_name || "Ungrouped") === group);
      const gBudget = members.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
      const gSpent = members.reduce((sum, p) => sum + spentOf(p), 0);
      return { group, count: members.length, budget: gBudget, spent: gSpent, left: gBudget - gSpent };
    });
    totalsView.innerHTML = `
      <article class="totals-card">
        <h2>Household</h2>
        <div class="totals-row"><span>Budget</span><strong>${money(budget)}</strong></div>
        <div class="totals-row"><span>Spent</span><strong>${money(spent)}</strong></div>
        <div class="totals-row"><span>Left</span><strong>${money(left)}</strong></div>
        ${hidden ? `<p class="hint" style="margin:0.7rem 0 0">${hidden} locked ${hidden === 1 ? "person is" : "people are"} hidden on this phone.</p>` : ""}
      </article>
      ${byGroup
        .map(
          (g) => `
        <article class="group-total">
          <h2>${escapeHtml(g.group)}</h2>
          <div class="totals-row"><span>${g.count} people</span><span></span></div>
          <div class="totals-row"><span>Budget</span><strong>${money(g.budget)}</strong></div>
          <div class="totals-row"><span>Spent</span><strong>${money(g.spent)}</strong></div>
          <div class="totals-row"><span>Left</span><strong>${money(g.left)}</strong></div>
        </article>`
        )
        .join("")}
    `;
  }

  function openPerson(id) {
    activeId = id;
    personSheet.hidden = false;
    renderPerson(id);
    const jot = document.getElementById("ideaInput");
    if (jot) jot.focus();
  }

  function closePerson() {
    activeId = null;
    personSheet.hidden = true;
  }

  function renderPerson(id) {
    const person = personById(id);
    if (!person) {
      closePerson();
      return;
    }
    if (!person._open) {
      personBody.innerHTML = `
        <h2 id="personName">${escapeHtml(person.name)}</h2>
        <p class="hint">${escapeHtml(person.group_name || "")}</p>
        <div class="lock-banner">
          <h3>Locked</h3>
          <p>Enter the password to see budget, ideas, and buys on this phone.</p>
          <button type="button" class="primary" data-action="unlock">Unlock</button>
        </div>
      `;
      bindPersonActions(person);
      return;
    }

    const spent = spentOf(person);
    const left = leftOf(person);
    personBody.innerHTML = `
      <h2 id="personName">${escapeHtml(person.name)}</h2>
      <div class="row-edit">
        <label>
          <span>Name</span>
          <input id="editName" type="text" maxlength="80" value="${escapeHtml(person.name)}" />
        </label>
        <label>
          <span>Group</span>
          <input id="editGroup" type="text" maxlength="80" list="groupOptions" value="${escapeHtml(person.group_name || "")}" />
        </label>
        <label>
          <span>Budget</span>
          <input id="editBudget" type="number" inputmode="decimal" min="0" step="0.01" placeholder="£" value="${person.budget ?? ""}" />
        </label>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>Budget</span><strong>${money(person.budget)}</strong></div>
        <div class="stat"><span>Spent</span><strong>${money(spent)}</strong></div>
        <div class="stat${left != null && left < 0 ? " is-over" : ""}"><span>Left</span><strong>${money(left)}</strong></div>
      </div>
      <form class="jot" id="ideaForm">
        <input id="ideaInput" type="text" maxlength="160" placeholder="Jot an idea…" autocomplete="off" />
        <button type="submit" class="primary">Add</button>
      </form>
      ${
        person.last_year_note
          ? `<p class="last-year"><strong>Last Christmas:</strong> ${escapeHtml(person.last_year_note)}</p>`
          : ""
      }
      <h3 class="section-title">Ideas</h3>
      ${
        person.ideas.length
          ? person.ideas
              .map(
                (idea) => `
          <div class="item">
            <p>${escapeHtml(idea.text)}</p>
            <div class="item-actions">
              <button type="button" class="chip" data-action="price" data-id="${escapeHtml(idea.id)}">Find cheapest</button>
              <button type="button" class="chip" data-action="buy-idea" data-id="${escapeHtml(idea.id)}">Bought</button>
              <button type="button" class="danger" data-action="drop-idea" data-id="${escapeHtml(idea.id)}">Remove</button>
            </div>
          </div>`
              )
              .join("")
          : `<p class="hint" style="margin:0 0 0.8rem">No ideas yet — add one when you spot something.</p>`
      }
      <h3 class="section-title">Bought</h3>
      ${
        person.purchases.length
          ? person.purchases
              .map(
                (buy) => `
          <div class="item">
            <p>${escapeHtml(buy.item)} · <strong>${money(buy.price)}</strong></p>
            <div class="item-actions">
              <button type="button" class="danger" data-action="drop-buy" data-id="${escapeHtml(buy.id)}">Remove</button>
            </div>
          </div>`
              )
              .join("")
          : `<p class="hint" style="margin:0 0 0.8rem">Nothing bought yet.</p>`
      }
      <div class="item-actions" style="margin-top:1rem">
        ${
          person.locked
            ? `<button type="button" class="ghost" data-action="remove-lock">Remove lock</button>`
            : `<button type="button" class="ghost" data-action="lock">Password-protect</button>`
        }
        <button type="button" class="danger" data-action="remove-person">Remove person</button>
      </div>
    `;
    bindPersonActions(person);
  }

  function bindPersonActions(person) {
    const nameEl = document.getElementById("editName");
    const groupEl = document.getElementById("editGroup");
    const budgetEl = document.getElementById("editBudget");
    const persistFields = async () => {
      const next = personById(person.id);
      if (!next) return;
      next.name = (nameEl?.value || "").trim() || next.name;
      next.group_name = (groupEl?.value || "").trim();
      next.budget = budgetEl && budgetEl.value !== "" ? Number(budgetEl.value) : null;
      await savePerson(next);
    };
    nameEl?.addEventListener("change", persistFields);
    groupEl?.addEventListener("change", persistFields);
    budgetEl?.addEventListener("change", persistFields);

    document.getElementById("ideaForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("ideaInput");
      const text = (input?.value || "").trim();
      if (!text) return;
      const next = personById(person.id);
      next.ideas = [
        { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() },
        ...(next.ideas || []),
      ];
      input.value = "";
      await savePerson(next);
      document.getElementById("ideaInput")?.focus();
    });

    personBody.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(person.id, btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleAction(personId, action, itemId) {
    const person = personById(personId);
    if (!person) return;
    if (action === "unlock") {
      openLock("unlock", person);
      return;
    }
    if (action === "lock") {
      openLock("lock", person);
      return;
    }
    if (action === "remove-lock") {
      openLock("remove", person);
      return;
    }
    if (action === "remove-person") {
      if (!confirm(`Remove ${person.name} from the list?`)) return;
      people = people.filter((p) => p.id !== personId);
      closePerson();
      render();
      await sync.remove(personId);
      return;
    }
    if (action === "drop-idea") {
      person.ideas = person.ideas.filter((idea) => idea.id !== itemId);
      await savePerson(person);
      return;
    }
    if (action === "drop-buy") {
      person.purchases = person.purchases.filter((buy) => buy.id !== itemId);
      await savePerson(person);
      return;
    }
    if (action === "buy-idea") {
      const idea = person.ideas.find((item) => item.id === itemId);
      if (!idea) return;
      openPrice(person, idea);
      return;
    }
    if (action === "price") {
      const idea = person.ideas.find((item) => item.id === itemId);
      if (!idea) return;
      openPrice(person, idea);
    }
  }

  function openLock(mode, person) {
    lockMode = mode;
    lockModal.returnValue = "";
    document.getElementById("lockPass").value = "";
    document.getElementById("lockConfirm").value = "";
    document.getElementById("lockError").hidden = true;
    const confirmWrap = document.getElementById("lockConfirmWrap");
    const title = document.getElementById("lockTitle");
    const hint = document.getElementById("lockHint");
    const submit = document.getElementById("lockSubmit");
    if (mode === "lock") {
      title.textContent = `Lock ${person.name}`;
      hint.textContent = "Only phones with this password can see the budget, ideas, and buys. Use this for each other.";
      confirmWrap.hidden = false;
      document.getElementById("lockConfirm").required = true;
      submit.textContent = "Lock";
    } else if (mode === "unlock") {
      title.textContent = `Unlock ${person.name}`;
      hint.textContent = "This stays unlocked on this phone until you clear the site data.";
      confirmWrap.hidden = true;
      document.getElementById("lockConfirm").required = false;
      submit.textContent = "Unlock";
    } else {
      title.textContent = `Remove lock on ${person.name}`;
      hint.textContent = "Both of you will be able to see everything for this person.";
      confirmWrap.hidden = true;
      document.getElementById("lockConfirm").required = false;
      submit.textContent = "Remove lock";
    }
    lockModal.dataset.personId = person.id;
    lockModal.showModal();
    document.getElementById("lockPass").focus();
  }

  function openPrice(person, idea) {
    priceContext = { personId: person.id, ideaId: idea.id, text: idea.text };
    document.getElementById("priceTitle").textContent = idea.text;
    document.getElementById("priceHint").textContent = "Opens UK shops so you can compare, then type the cheapest you found.";
    document.getElementById("foundPrice").value = "";
    document.getElementById("priceError").hidden = true;
    const q = encodeURIComponent(`${idea.text} UK`);
    const shops = [
      ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`],
      ["Amazon", `https://www.amazon.co.uk/s?k=${q}`],
      ["eBay", `https://www.ebay.co.uk/sch/i.html?_nkw=${q}`],
      ["Argos", `https://www.argos.co.uk/search/${q}`],
      ["John Lewis", `https://www.johnlewis.com/search?search-term=${q}`],
    ];
    document.getElementById("shopGrid").innerHTML = shops
      .map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
      .join("");
    priceModal.showModal();
  }

  document.getElementById("personBack").addEventListener("click", closePerson);
  search.addEventListener("input", renderPeople);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      document.getElementById("panelPeople").hidden = tab !== "people";
      document.getElementById("panelPeople").classList.toggle("is-active", tab === "people");
      document.getElementById("panelTotals").hidden = tab !== "totals";
      document.getElementById("panelTotals").classList.toggle("is-active", tab === "totals");
    });
  });

  document.getElementById("addPersonBtn").addEventListener("click", () => {
    document.getElementById("addName").value = "";
    document.getElementById("addGroup").value = "";
    document.getElementById("addBudget").value = "";
    addModal.showModal();
    document.getElementById("addName").focus();
  });
  document.getElementById("addCancel").addEventListener("click", () => addModal.close());
  document.getElementById("addForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("addName").value.trim();
    if (!name) return;
    const group_name = document.getElementById("addGroup").value.trim();
    const budgetRaw = document.getElementById("addBudget").value;
    const person = {
      id: crypto.randomUUID(),
      year: YEAR,
      name,
      group_name,
      sort_order: people.reduce((max, p) => Math.max(max, p.sort_order || 0), 0) + 10,
      locked: false,
      budget: budgetRaw === "" ? null : Number(budgetRaw),
      ideas: [],
      purchases: [],
      last_year_note: "",
      _open: true,
    };
    people = [...people, person];
    addModal.close();
    render();
    await savePerson(person);
    openPerson(person.id);
  });

  document.getElementById("lockCancel").addEventListener("click", () => lockModal.close());
  document.getElementById("lockForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const person = personById(lockModal.dataset.personId);
    const pw = document.getElementById("lockPass").value;
    const confirmPw = document.getElementById("lockConfirm").value;
    const error = document.getElementById("lockError");
    error.hidden = true;
    if (!person) return;
    try {
      if (lockMode === "lock") {
        if (pw.length < 4) throw new Error("Use at least 4 characters.");
        if (pw !== confirmPw) throw new Error("Passwords do not match.");
        passwords[person.id] = pw;
        savePasswords();
        person.locked = true;
        person._open = true;
        await savePerson(person);
      } else if (lockMode === "unlock") {
        if (!person.ciphertext) throw new Error("Nothing to unlock.");
        await window.WrapNestCrypto.decryptSecret(pw, person.salt, person.iv, person.ciphertext);
        passwords[person.id] = pw;
        savePasswords();
        people = await decorate(await sync.hydrate());
        render();
      } else {
        const secret = person._open
          ? {
              budget: person.budget,
              ideas: person.ideas,
              purchases: person.purchases,
              last_year_note: person.last_year_note,
            }
          : await window.WrapNestCrypto.decryptSecret(pw, person.salt, person.iv, person.ciphertext);
        passwords[person.id] = pw;
        savePasswords();
        person.locked = false;
        person._open = true;
        person.budget = secret.budget ?? null;
        person.ideas = secret.ideas || [];
        person.purchases = secret.purchases || [];
        person.last_year_note = secret.last_year_note || "";
        person.salt = null;
        person.iv = null;
        person.ciphertext = null;
        delete passwords[person.id];
        savePasswords();
        await savePerson(person);
      }
      lockModal.close();
    } catch (err) {
      error.hidden = false;
      error.textContent = lockMode === "lock" ? err.message : "That password did not work.";
    }
  });

  document.getElementById("priceClose").addEventListener("click", () => priceModal.close());
  document.getElementById("priceBought").addEventListener("click", async () => {
    if (!priceContext) return;
    const person = personById(priceContext.personId);
    const idea = person?.ideas.find((item) => item.id === priceContext.ideaId);
    const price = Number(document.getElementById("foundPrice").value);
    const error = document.getElementById("priceError");
    if (!person || !idea || !Number.isFinite(price) || price < 0) {
      error.hidden = false;
      error.textContent = "Enter the price you found.";
      return;
    }
    person.ideas = person.ideas.filter((item) => item.id !== idea.id);
    person.purchases = [
      { id: crypto.randomUUID(), item: idea.text, price, createdAt: new Date().toISOString() },
      ...person.purchases,
    ];
    priceModal.close();
    await savePerson(person);
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
        if (event.data && event.data.type === "WRAPNEST_SW_UPDATED" && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  async function boot() {
    registerServiceWorker();
    syncPill.textContent = sync.ready() ? "Live" : "On this phone";
    syncPill.classList.toggle("is-live", sync.ready());
    syncPill.classList.toggle("is-off", !sync.ready());
    try {
      const rows = await sync.hydrate();
      people = await decorate(rows);
    } catch (err) {
      console.warn(err);
      people = await decorate(sync.readCache());
    }
    render();
    sync.subscribe();
  }

  boot();
})();
