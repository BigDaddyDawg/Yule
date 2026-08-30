(() => {
  const ASSET_V = "3";
  const PASS_KEY = "yule_passwords_v1";
  const OLD_PASS_KEYS = ["sleigh_passwords_v1", "wrapnest_passwords_v1", "mantel_passwords_v1"];
  const PUSHED_KEY = "yule_gcal_pushed_v1";
  const YEAR = window.YuleSync?.YEAR || window.SleighSync?.YEAR || 2026;
  const XMAS = new Date(YEAR, 11, 25);

  let people = [];
  let events = [];
  let house = {};
  let activeId = null;
  let lockMode = "lock";
  let priceContext = null;
  let spendPersonId = null;
  let editingEventId = null;
  let calMonth = 11;
  let peopleFilter = "all";
  let passwords = loadPasswords();

  const sync = (window.YuleSync || window.SleighSync).create({
    year: YEAR,
    onRemoteChange: async (rows, settings, remoteEvents) => {
      house = settings || house;
      if (Array.isArray(remoteEvents)) events = remoteEvents;
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

  function loadPushed() {
    try {
      const raw = JSON.parse(localStorage.getItem(PUSHED_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function markPushed(id) {
    const pushed = loadPushed();
    pushed[id] = new Date().toISOString();
    try {
      localStorage.setItem(PUSHED_KEY, JSON.stringify(pushed));
    } catch {
      /* ignore */
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

  function daysLeft() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((XMAS - now) / 86400000));
  }

  function spentOf(person) {
    return (person.purchases || []).reduce((sum, buy) => sum + (Number(buy.price) || 0), 0);
  }

  function leftOf(person) {
    if (person.budget == null || person.budget === "") return null;
    return Number(person.budget) - spentOf(person);
  }

  function estimatesOf(person) {
    return (person.ideas || []).reduce((sum, idea) => sum + (Number(idea.estimate) || 0), 0);
  }

  function openPeople() {
    return people.filter((p) => p._open);
  }

  function groups() {
    const seen = [];
    for (const person of people) {
      const name = person.group_name || "Ungrouped";
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }

  function statusOf(person) {
    if (!person._open) return "locked";
    const left = leftOf(person);
    if (left != null && left < 0) return "over";
    if (person.wrapped) return "wrapped";
    if ((person.purchases || []).length && !(person.ideas || []).length) return "done";
    if ((person.ideas || []).length) return "shopping";
    if ((person.purchases || []).length) return "buying";
    return "empty";
  }

  function statusLabel(status) {
    return {
      locked: "Locked",
      over: "Over",
      wrapped: "Wrapped",
      done: "Bought",
      shopping: "To buy",
      buying: "In progress",
      empty: "No ideas",
    }[status] || "";
  }

  function totals() {
    const open = openPeople();
    const allocated = open.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
    const spent = open.reduce((sum, p) => sum + spentOf(p), 0);
    const forecast = spent + open.reduce((sum, p) => sum + estimatesOf(p), 0);
    const lastSpent = people.reduce((sum, p) => sum + (Number(p.last_year_spent) || 0), 0);
    const cap = house.budget == null || house.budget === "" ? allocated : Number(house.budget);
    const secret = people.filter((p) => p.locked && p._open).reduce((sum, p) => sum + spentOf(p), 0);
    const hidden = people.filter((p) => !p._open).length;
    return {
      allocated,
      spent,
      cap,
      left: cap - spent,
      unallocated: cap - allocated,
      forecast,
      lastSpent,
      secret,
      hidden,
      over: open.filter((p) => statusOf(p) === "over"),
      empty: open.filter((p) => statusOf(p) === "empty"),
      shop: open.filter((p) => (p.ideas || []).length),
      wrapped: open.filter((p) => p.wrapped || statusOf(p) === "done"),
    };
  }

  async function decorate(rows) {
    const out = [];
    for (const row of rows) {
      const person = {
        ...row,
        ideas: row.ideas || [],
        purchases: row.purchases || [],
        note: row.note || "",
        wrapped: Boolean(row.wrapped),
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
            person.note = "";
            person.wrapped = false;
          }
        } else {
          person._open = false;
          person.budget = null;
          person.ideas = [];
          person.purchases = [];
          person.note = "";
          person.wrapped = false;
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
    people = people.map((p) => (p.id === person.id ? { ...person } : p));
    render();
    await sync.upsert(row);
  }

  function personById(id) {
    return people.find((p) => p.id === id) || null;
  }

  function stillYear(text, lastNote) {
    if (!text || !lastNote) return false;
    const hay = lastNote.toLowerCase();
    const needle = text.toLowerCase().trim();
    if (needle.length < 4) return false;
    return hay.includes(needle) || needle.split(/\s+/).filter((w) => w.length > 4).some((w) => hay.includes(w));
  }

  function render() {
    const days = daysLeft();
    document.getElementById("countdown").textContent =
      days === 0 ? "Christmas Day" : `${days} day${days === 1 ? "" : "s"} to Christmas`;
    renderBudget();
    renderPeople();
    renderShop();
    renderBought();
    renderCalendar();
    if (activeId) renderPerson(activeId);
    const addGroups = document.getElementById("groupOptions");
    if (addGroups) {
      addGroups.innerHTML = groups().map((g) => `<option value="${escapeHtml(g)}"></option>`).join("");
    }
  }

  function renderBudget() {
    const t = totals();
    const pct = t.cap > 0 ? Math.min(100, Math.max(0, (t.spent / t.cap) * 100)) : 0;
    const health = t.left < 0 ? "over" : t.cap > 0 && t.spent / t.cap >= 0.85 ? "tight" : "ok";
    const pace = daysLeft() > 0 ? t.left / daysLeft() : t.left;
    const root = document.getElementById("budgetView");
    root.innerHTML = `
      <article class="hero">
        <p class="hero-kicker">${health === "over" ? "Over the kitty" : health === "tight" ? "Getting tight" : "Left in the kitty"}</p>
        <p class="hero-left ${health === "over" ? "is-over" : health === "tight" ? "is-tight" : ""}">${money(t.left)}</p>
        <p class="hero-sub">${money(t.spent)} spent of ${money(t.cap)} house cap · ${pct.toFixed(0)}%</p>
        <div class="hero-bar ${health === "over" ? "is-over" : health === "tight" ? "is-tight" : ""}"><span style="width:${Math.min(100, pct)}%"></span></div>
        <div class="stat-grid">
          <div class="stat"><span>Allocated</span><strong>${money(t.allocated)}</strong></div>
          <div class="stat"><span>If ideas land</span><strong>${money(t.forecast)}</strong></div>
          <div class="stat"><span>£ / day left</span><strong>${money(pace)}</strong></div>
        </div>
        <p class="hero-sub" style="margin-bottom:0">
          <button type="button" class="linkish" id="editHouse">Change house cap</button>
          · last year you spent ${money(t.lastSpent)}
        </p>
        ${t.unallocated < -0.5 ? `<p class="warn">Person budgets add up to ${money(Math.abs(t.unallocated))} more than the house cap.</p>` : ""}
        ${t.unallocated > 0.5 ? `<p class="gold-note">${money(t.unallocated)} of the kitty isn’t allocated to anyone yet.</p>` : ""}
        ${t.forecast > t.cap + 0.5 ? `<p class="warn">If you bought every estimated idea, you’d be ${money(t.forecast - t.cap)} over.</p>` : ""}
        ${t.secret ? `<p class="gold-note">Your locked lists: ${money(t.secret)} spent (hidden on the other phone).</p>` : ""}
        ${t.hidden ? `<p class="gold-note">${t.hidden} locked ${t.hidden === 1 ? "person isn’t" : "people aren’t"} in these numbers on this phone.</p>` : ""}
      </article>
      <article class="card">
        <h2>Needs a look</h2>
        ${
          ![...t.over, ...t.empty, ...t.shop.filter((p) => !t.over.includes(p) && !t.empty.includes(p))].length
            ? `<p class="hint" style="margin:0">Nothing needs you right now.</p>`
            : `${t.over.map((p) => attnBtn(p, `${money(Math.abs(leftOf(p)))} over`, "over")).join("")}
               ${t.empty.map((p) => attnBtn(p, "No ideas yet", "")).join("")}
               ${t.shop.filter((p) => statusOf(p) !== "over" && statusOf(p) !== "empty").map((p) => attnBtn(p, `${p.ideas.length} to buy · ${money(leftOf(p))} left`, "ok")).join("")}`
        }
      </article>
      ${groups()
        .map((group) => {
          const members = openPeople().filter((p) => (p.group_name || "Ungrouped") === group);
          const budget = members.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
          const spent = members.reduce((sum, p) => sum + spentOf(p), 0);
          const left = budget - spent;
          const gPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
          return `
            <article class="card">
              <h2>${escapeHtml(group)}</h2>
              <div class="totals-row"><span>${members.length} people</span><strong>${money(left)} left</strong></div>
              <div class="totals-row"><span>Spent ${money(spent)}</span><span>of ${money(budget)}</span></div>
              <div class="mini-bar${left < 0 ? " is-over" : ""}"><span style="width:${gPct}%"></span></div>
            </article>`;
        })
        .join("")}
    `;
    document.getElementById("editHouse")?.addEventListener("click", () => {
      document.getElementById("houseBudget").value = house.budget ?? t.allocated ?? "";
      document.getElementById("houseModal").showModal();
    });
    root.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openPerson(btn.dataset.open));
    });
  }

  function attnBtn(person, detail, tagClass) {
    return `<button type="button" class="attn" data-open="${escapeHtml(person.id)}">
      <span><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(detail)}</span></span>
      <span class="tag ${tagClass ? `is-${tagClass}` : ""}">${escapeHtml(statusLabel(statusOf(person)))}</span>
    </button>`;
  }

  function renderPeople() {
    const q = (document.getElementById("search").value || "").trim().toLowerCase();
    const filters = [
      ["all", "All"],
      ["over", "Over"],
      ["shop", "To buy"],
      ["empty", "No ideas"],
      ["done", "Wrapped"],
    ];
    document.getElementById("peopleFilters").innerHTML = filters
      .map(([id, label]) => `<button type="button" class="filter-chip${peopleFilter === id ? " is-on" : ""}" data-filter="${id}">${label}</button>`)
      .join("");
    document.getElementById("peopleFilters").querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        peopleFilter = btn.dataset.filter;
        renderPeople();
      });
    });

    const visible = people.filter((p) => {
      const st = statusOf(p);
      if (peopleFilter === "over" && st !== "over") return false;
      if (peopleFilter === "shop" && !(p._open && (p.ideas || []).length)) return false;
      if (peopleFilter === "empty" && st !== "empty") return false;
      if (peopleFilter === "done" && st !== "wrapped" && st !== "done") return false;
      if (!q) return true;
      const blob = `${p.name} ${p.group_name} ${(p.ideas || []).map((i) => i.text).join(" ")} ${(p.purchases || []).map((b) => b.item).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });

    const empty = document.getElementById("peopleEmpty");
    empty.hidden = visible.length > 0;
    const list = document.getElementById("peopleList");
    list.innerHTML = "";
    let lastGroup = null;
    for (const person of visible) {
      const group = person.group_name || "Ungrouped";
      if (group !== lastGroup) {
        const label = document.createElement("h2");
        label.className = "group-label";
        label.textContent = group;
        list.appendChild(label);
        lastGroup = group;
      }
      const spent = spentOf(person);
      const left = leftOf(person);
      const st = statusOf(person);
      const pct = person._open && person.budget ? Math.min(100, Math.max(0, (spent / Number(person.budget)) * 100)) : 0;
      const leftLabel = !person._open
        ? "Locked"
        : st === "wrapped"
          ? "Wrapped"
          : left == null
            ? "No budget"
            : left < 0
              ? `${money(Math.abs(left))} over`
              : `${money(left)} left`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "person-card";
      btn.innerHTML = `
        <strong>${escapeHtml(person.name)}${person.locked ? " 🔒" : ""}</strong>
        <span class="left ${st === "over" ? "is-over" : !person._open ? "is-lock" : st === "wrapped" || st === "done" ? "is-done" : ""}">${escapeHtml(leftLabel)}</span>
        <span class="meta">${
          !person._open
            ? "Budget, ideas and buys are hidden"
            : `${money(spent)} spent${person.budget != null ? ` of ${money(person.budget)}` : ""} · ${person.ideas.length} idea${person.ideas.length === 1 ? "" : "s"}`
        }</span>
        <span class="status-pill ${st === "over" ? "is-over" : st === "wrapped" || st === "done" ? "is-done" : ""}">${escapeHtml(statusLabel(st))}</span>
        ${person._open && person.budget ? `<div class="progress${left != null && left < 0 ? " is-over" : ""}"><span style="width:${pct}%"></span></div>` : ""}
      `;
      btn.addEventListener("click", () => openPerson(person.id));
      list.appendChild(btn);
    }
  }

  function renderShop() {
    const ideas = [];
    for (const person of openPeople()) {
      for (const idea of person.ideas || []) ideas.push({ person, idea });
    }
    ideas.sort((a, b) => Number(b.idea.must) - Number(a.idea.must) || a.person.sort_order - b.person.sort_order);
    const root = document.getElementById("shopView");
    document.getElementById("shopHint").textContent = ideas.length
      ? `${ideas.length} idea${ideas.length === 1 ? "" : "s"} still out there.`
      : "Nothing left to hunt — nice.";
    if (!ideas.length) {
      root.innerHTML = `<p class="empty">The shop list is clear. Add ideas on a person when you spot something.</p>`;
      return;
    }
    root.innerHTML = ideas
      .map(({ person, idea }) => {
        const left = leftOf(person);
        const repeat = stillYear(idea.text, person.last_year_note);
        return `<article class="item" style="margin:0 1.05rem 0.55rem">
          <p><strong>${escapeHtml(idea.text)}</strong>${idea.must ? " · must" : ""}</p>
          <p class="who">${escapeHtml(person.name)} · ${left == null ? "no budget" : `${money(left)} left`}${idea.estimate ? ` · est ${money(idea.estimate)}` : ""}${repeat ? " · you got this last year" : ""}</p>
          <div class="item-actions">
            <button type="button" class="chip" data-price="${escapeHtml(person.id)}:${escapeHtml(idea.id)}">Find cheapest</button>
            <button type="button" class="chip" data-buy="${escapeHtml(person.id)}:${escapeHtml(idea.id)}">Bought</button>
          </div>
        </article>`;
      })
      .join("");
    root.querySelectorAll("[data-price], [data-buy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [pid, iid] = (btn.dataset.price || btn.dataset.buy).split(":");
        const person = personById(pid);
        const idea = person?.ideas.find((i) => i.id === iid);
        if (person && idea) openPrice(person, idea);
      });
    });
  }

  function renderBought() {
    const rows = [];
    for (const person of openPeople()) {
      for (const buy of person.purchases || []) rows.push({ person, buy });
    }
    rows.sort((a, b) => String(b.buy.createdAt || "").localeCompare(String(a.buy.createdAt || "")));
    const spent = rows.reduce((sum, row) => sum + (Number(row.buy.price) || 0), 0);
    const root = document.getElementById("boughtView");
    if (!rows.length) {
      root.innerHTML = `<p class="empty">Nothing bought yet. Log a price when you pay.</p>`;
      return;
    }
    root.innerHTML = `
      <article class="card"><h2>This year’s bag</h2>
        <div class="totals-row"><span>${rows.length} presents</span><strong>${money(spent)}</strong></div>
      </article>
      ${rows
        .map(({ person, buy }) => {
          const when = buy.createdAt ? new Date(buy.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
          return `<article class="item" style="margin:0 1.05rem 0.55rem">
            <p><strong>${escapeHtml(buy.item)}</strong> · ${money(buy.price)}</p>
            <p class="who">${escapeHtml(person.name)}${buy.shop ? ` · ${escapeHtml(buy.shop)}` : ""}${when ? ` · ${when}` : ""}</p>
            <div class="item-actions">
              <button type="button" class="danger" data-drop="${escapeHtml(person.id)}:${escapeHtml(buy.id)}">Undo</button>
            </div>
          </article>`;
        })
        .join("")}`;
    root.querySelectorAll("[data-drop]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [pid, bid] = btn.dataset.drop.split(":");
        const person = personById(pid);
        if (!person) return;
        person.purchases = person.purchases.filter((b) => b.id !== bid);
        await savePerson(person);
      });
    });
  }

  function openPerson(id) {
    activeId = id;
    document.getElementById("personSheet").hidden = false;
    renderPerson(id);
    document.getElementById("ideaInput")?.focus();
  }

  function closePerson() {
    activeId = null;
    document.getElementById("personSheet").hidden = true;
  }

  function renderPerson(id) {
    const person = personById(id);
    if (!person) {
      closePerson();
      return;
    }
    const body = document.getElementById("personBody");
    if (!person._open) {
      body.innerHTML = `
        <h2 id="personName">${escapeHtml(person.name)}</h2>
        <p class="hint">${escapeHtml(person.group_name || "")}</p>
        <div class="lock-banner">
          <h3>Locked</h3>
          <p>Enter the password to see budget, ideas, and buys on this phone.</p>
          <button type="button" class="primary" data-action="unlock">Unlock</button>
        </div>`;
      bindPersonActions(person);
      return;
    }

    const spent = spentOf(person);
    const left = leftOf(person);
    const est = estimatesOf(person);
    const forecast = spent + est;
    const st = statusOf(person);
    body.innerHTML = `
      <h2 id="personName">${escapeHtml(person.name)}</h2>
      <span class="status-pill ${st === "over" ? "is-over" : st === "wrapped" || st === "done" ? "is-done" : ""}">${escapeHtml(statusLabel(st))}</span>
      <div class="row-edit">
        <label><span>Name</span><input id="editName" type="text" maxlength="80" value="${escapeHtml(person.name)}" /></label>
        <label><span>Group</span><input id="editGroup" type="text" maxlength="80" list="groupOptions" value="${escapeHtml(person.group_name || "")}" /></label>
        <label><span>Budget</span><input id="editBudget" type="number" inputmode="decimal" min="0" step="0.01" placeholder="£" value="${person.budget ?? ""}" /></label>
        <label><span>Note</span><input id="editNote" type="text" maxlength="160" placeholder="Sizes, likes, don’t-buys…" value="${escapeHtml(person.note || "")}" /></label>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>Budget</span><strong>${money(person.budget)}</strong></div>
        <div class="stat"><span>Spent</span><strong>${money(spent)}</strong></div>
        <div class="stat${left != null && left < 0 ? " is-over" : ""}"><span>Left</span><strong>${money(left)}</strong></div>
      </div>
      <p class="forecast">If remaining idea estimates land: <strong>${money(forecast)}</strong>${person.last_year_spent != null ? ` · last year ${money(person.last_year_spent)}` : ""}</p>
      <form class="jot" id="ideaForm">
        <input id="ideaInput" type="text" maxlength="160" placeholder="Jot an idea…" autocomplete="off" />
        <button type="submit" class="primary">Add</button>
      </form>
      <div class="jot-extra">
        <input id="ideaEstimate" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Est. £" />
        <label style="display:flex;align-items:center;gap:0.4rem;margin:0">
          <input id="ideaMust" type="checkbox" />
          <span style="margin:0">Must-have</span>
        </label>
      </div>
      <div class="item-actions" style="margin-bottom:0.8rem">
        <button type="button" class="chip" data-action="log-spend">Log a buy</button>
        <button type="button" class="chip" data-action="toggle-wrap">${person.wrapped ? "Unmark wrapped" : "Mark wrapped"}</button>
        ${person.last_year_note ? `<button type="button" class="ghost" data-action="reuse-year">Reuse last year’s gifts as ideas</button>` : ""}
      </div>
      ${person.last_year_note ? `<p class="last-year"><strong>Last Christmas:</strong> ${escapeHtml(person.last_year_note)}${person.last_year_spent != null ? ` (${money(person.last_year_spent)})` : ""}</p>` : ""}
      <h3 class="section-title">Ideas</h3>
      ${
        person.ideas.length
          ? person.ideas
              .map((idea) => `
          <div class="item">
            <p>${escapeHtml(idea.text)}${idea.must ? " · <strong>must</strong>" : ""}${idea.estimate ? ` · est ${money(idea.estimate)}` : ""}</p>
            ${stillYear(idea.text, person.last_year_note) ? `<p class="who">You got them something like this last year.</p>` : ""}
            <div class="item-actions">
              <button type="button" class="chip" data-action="price" data-id="${escapeHtml(idea.id)}">Find cheapest</button>
              <button type="button" class="chip" data-action="buy-idea" data-id="${escapeHtml(idea.id)}">Bought</button>
              <button type="button" class="danger" data-action="drop-idea" data-id="${escapeHtml(idea.id)}">Remove</button>
            </div>
          </div>`)
              .join("")
          : `<p class="hint" style="margin:0 0 0.8rem">No ideas yet — add one when you spot something.</p>`
      }
      <h3 class="section-title">Bought</h3>
      ${
        person.purchases.length
          ? person.purchases
              .map((buy) => `
          <div class="item">
            <p>${escapeHtml(buy.item)} · <strong>${money(buy.price)}</strong></p>
            <p class="who">${buy.shop ? escapeHtml(buy.shop) : "Shop not noted"}</p>
            <div class="item-actions">
              <button type="button" class="danger" data-action="drop-buy" data-id="${escapeHtml(buy.id)}">Remove</button>
            </div>
          </div>`)
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
    const persistFields = async () => {
      const next = personById(person.id);
      if (!next) return;
      next.name = (document.getElementById("editName")?.value || "").trim() || next.name;
      next.group_name = (document.getElementById("editGroup")?.value || "").trim();
      const budgetEl = document.getElementById("editBudget");
      next.budget = budgetEl && budgetEl.value !== "" ? Number(budgetEl.value) : null;
      next.note = (document.getElementById("editNote")?.value || "").trim();
      await savePerson(next);
    };
    ["editName", "editGroup", "editBudget", "editNote"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", persistFields);
    });
    document.getElementById("ideaForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("ideaInput");
      const text = (input?.value || "").trim();
      if (!text) return;
      const next = personById(person.id);
      const estimateRaw = document.getElementById("ideaEstimate")?.value;
      next.ideas = [
        {
          id: crypto.randomUUID(),
          text,
          estimate: estimateRaw === "" ? null : Number(estimateRaw),
          must: Boolean(document.getElementById("ideaMust")?.checked),
          createdAt: new Date().toISOString(),
        },
        ...(next.ideas || []),
      ];
      input.value = "";
      const est = document.getElementById("ideaEstimate");
      if (est) est.value = "";
      const must = document.getElementById("ideaMust");
      if (must) must.checked = false;
      await savePerson(next);
      document.getElementById("ideaInput")?.focus();
    });
    document.getElementById("personBody").querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(person.id, btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleAction(personId, action, itemId) {
    const person = personById(personId);
    if (!person) return;
    if (action === "unlock") return openLock("unlock", person);
    if (action === "lock") return openLock("lock", person);
    if (action === "remove-lock") return openLock("remove", person);
    if (action === "log-spend") {
      spendPersonId = person.id;
      document.getElementById("spendTitle").textContent = `Log a buy for ${person.name}`;
      document.getElementById("spendItem").value = "";
      document.getElementById("spendPrice").value = "";
      document.getElementById("spendShop").value = "";
      document.getElementById("spendModal").showModal();
      document.getElementById("spendItem").focus();
      return;
    }
    if (action === "toggle-wrap") {
      person.wrapped = !person.wrapped;
      await savePerson(person);
      if (person.wrapped) burst();
      return;
    }
    if (action === "reuse-year") {
      const bits = String(person.last_year_note || "")
        .split("·")
        .map((s) => s.trim())
        .filter(Boolean);
      const have = new Set((person.ideas || []).map((i) => i.text.toLowerCase()));
      for (const text of bits) {
        if (have.has(text.toLowerCase())) continue;
        person.ideas.push({ id: crypto.randomUUID(), text, estimate: null, must: false, createdAt: new Date().toISOString() });
        have.add(text.toLowerCase());
      }
      await savePerson(person);
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
    if (action === "buy-idea" || action === "price") {
      const idea = person.ideas.find((item) => item.id === itemId);
      if (idea) openPrice(person, idea);
    }
  }

  function openLock(mode, person) {
    lockMode = mode;
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
    document.getElementById("lockModal").dataset.personId = person.id;
    document.getElementById("lockModal").showModal();
    document.getElementById("lockPass").focus();
  }

  function openPrice(person, idea) {
    priceContext = { personId: person.id, ideaId: idea.id, text: idea.text };
    document.getElementById("priceTitle").textContent = idea.text;
    document.getElementById("priceHint").textContent = "Compare UK shops, then type the cheapest you found.";
    document.getElementById("foundPrice").value = idea.estimate || "";
    document.getElementById("foundShop").value = "";
    document.getElementById("priceError").hidden = true;
    const q = encodeURIComponent(`${idea.text} UK buy`);
    const shops = [
      ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`],
      ["Amazon", `https://www.amazon.co.uk/s?k=${q}`],
      ["eBay", `https://www.ebay.co.uk/sch/i.html?_nkw=${q}`],
      ["Argos", `https://www.argos.co.uk/search/${q}`],
      ["John Lewis", `https://www.johnlewis.com/search?search-term=${q}`],
      ["Next", `https://www.next.co.uk/search?w=${q}`],
    ];
    document.getElementById("shopGrid").innerHTML = shops
      .map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
      .join("");
    document.getElementById("priceModal").showModal();
  }

  function burst() {
    const canvas = document.getElementById("confetti");
    const ctx = canvas.getContext("2d");
    canvas.hidden = false;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const bits = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 80,
      r: 3 + Math.random() * 5,
      vy: 3 + Math.random() * 4,
      vx: -2 + Math.random() * 4,
      c: ["#c43c3c", "#d4a84b", "#1f5a3a", "#fffaf3"][Math.floor(Math.random() * 4)],
    }));
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy;
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, b.y, b.r, b.r * 1.4);
      }
      frame += 1;
      if (frame < 70) requestAnimationFrame(tick);
      else canvas.hidden = true;
    };
    tick();
  }

  function isoDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function eventsOn(date) {
    return events.filter((e) => e.event_date === date);
  }

  function upcomingEvents() {
    const today = isoDate(YEAR, new Date().getMonth() + 1, new Date().getDate());
    return [...events]
      .filter((e) => e.event_date >= "2026-11-01" && e.event_date <= "2026-12-31")
      .sort((a, b) => `${a.event_date}${a.event_time}`.localeCompare(`${b.event_date}${b.event_time}`));
  }

  function personName(id) {
    return people.find((p) => p.id === id)?.name || "";
  }

  function googleDates(event) {
    const day = event.event_date.replace(/-/g, "");
    if (event.event_time) {
      const [h, m] = event.event_time.split(":");
      const start = new Date(`${event.event_date}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const stamp = (d) =>
        `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;
      return `${stamp(start)}/${stamp(end)}`;
    }
    const next = new Date(`${event.event_date}T12:00:00`);
    next.setDate(next.getDate() + 1);
    const end = isoDate(next.getFullYear(), next.getMonth() + 1, next.getDate()).replace(/-/g, "");
    return `${day}/${end}`;
  }

  function googleTemplate(event) {
    const who = personName(event.person_id);
    const details = [event.notes, who ? `For ${who}` : ""].filter(Boolean).join(" — ");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: event.title,
      dates: googleDates(event),
      details,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function icsStamp(event) {
    if (event.event_time) {
      const compact = event.event_time.replace(":", "") + "00";
      return `DTSTART:${event.event_date.replace(/-/g, "")}T${compact}\r\nDTEND:${event.event_date.replace(/-/g, "")}T${compact}`;
    }
    const next = new Date(`${event.event_date}T12:00:00`);
    next.setDate(next.getDate() + 1);
    const end = isoDate(next.getFullYear(), next.getMonth() + 1, next.getDate()).replace(/-/g, "");
    return `DTSTART;VALUE=DATE:${event.event_date.replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${end}`;
  }

  function downloadIcs(list) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Yule//EN",
      "CALSCALE:GREGORIAN",
    ];
    for (const event of list) {
      const who = personName(event.person_id);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${event.id}@yule`,
        icsStamp(event),
        `SUMMARY:${(event.title || "").replace(/,/g, "\\,")}`,
        `DESCRIPTION:${[event.notes, who ? `For ${who}` : ""].filter(Boolean).join(" — ").replace(/,/g, "\\,")}`,
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yule-dates.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    for (const event of list) markPushed(event.id);
  }

  function openGoogle(event) {
    markPushed(event.id);
    window.open(googleTemplate(event), "_blank", "noopener");
  }

  function fillEventPeople(selected) {
    const sel = document.getElementById("eventPerson");
    sel.innerHTML =
      `<option value="">Nobody specific</option>` +
      people.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
  }

  function openEventEditor(date, event) {
    editingEventId = event?.id || null;
    document.getElementById("eventTitle").textContent = event ? "Edit date" : "Add a date";
    document.getElementById("eventName").value = event?.title || "";
    document.getElementById("eventDate").value = event?.event_date || date || "2026-12-01";
    document.getElementById("eventTime").value = event?.event_time || "";
    document.getElementById("eventNotes").value = event?.notes || "";
    document.getElementById("eventError").hidden = true;
    document.getElementById("eventDelete").hidden = !event;
    fillEventPeople(event?.person_id || "");
    document.getElementById("eventModal").showModal();
    document.getElementById("eventName").focus();
  }

  function renderCalendar() {
    const root = document.getElementById("calendarView");
    if (!root) return;
    const month = calMonth;
    const first = new Date(YEAR, month - 1, 1);
    const daysInMonth = new Date(YEAR, month, 0).getDate();
    const startDow = (first.getDay() + 6) % 7;
    const today = isoDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-day is-empty"></div>`);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = isoDate(YEAR, month, day);
      const on = eventsOn(date);
      const cls = [
        date === today ? "is-today" : "",
        date === "2026-12-25" ? "is-xmas" : "",
      ].filter(Boolean).join(" ");
      cells.push(
        `<button type="button" class="cal-day ${cls}" data-day="${date}">
          <span class="num">${day}</span>
          <span class="cal-dots">${on.map(() => "<i></i>").join("")}</span>
        </button>`
      );
    }
    const upcoming = upcomingEvents();
    const pushed = loadPushed();
    root.innerHTML = `
      <div class="month-switch">
        <button type="button" class="filter-chip${month === 11 ? " is-on" : ""}" data-month="11">November</button>
        <button type="button" class="filter-chip${month === 12 ? " is-on" : ""}" data-month="12">December</button>
      </div>
      <div class="cal-grid">
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
      <div class="gcal-row">
        <button type="button" class="chip" id="addDateBtn">Add a date</button>
        <button type="button" class="primary" id="icsAllBtn">Add upcoming to my calendar</button>
      </div>
      <p class="hint">Tap a day to add something. “Add to Google” opens your calendar on this phone — confirm once. “Add upcoming” downloads a file your phone can import into Google Calendar. That stays on this phone only.</p>
      <article class="card"><h2>Coming up</h2>
        ${
          upcoming.length
            ? upcoming
                .map((event) => {
                  const when = new Date(`${event.event_date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                  const who = personName(event.person_id);
                  return `<article class="item">
                    <p><strong>${escapeHtml(event.title)}</strong></p>
                    <p class="who">${when}${event.event_time ? ` · ${escapeHtml(event.event_time)}` : ""}${who ? ` · ${escapeHtml(who)}` : ""}${event.notes ? ` · ${escapeHtml(event.notes)}` : ""}${pushed[event.id] ? " · on this phone" : ""}</p>
                    <div class="item-actions">
                      <button type="button" class="chip" data-gcal="${escapeHtml(event.id)}">Add to Google</button>
                      <button type="button" class="ghost" data-edit-event="${escapeHtml(event.id)}">Edit</button>
                      <button type="button" class="danger" data-drop-event="${escapeHtml(event.id)}">Remove</button>
                    </div>
                  </article>`;
                })
                .join("")
            : `<p class="hint" style="margin:0">No dates yet. Tap a day on the grid.</p>`
        }
      </article>
    `;
    root.querySelectorAll("[data-month]").forEach((btn) => {
      btn.addEventListener("click", () => {
        calMonth = Number(btn.dataset.month);
        renderCalendar();
      });
    });
    root.querySelectorAll("[data-day]").forEach((btn) => {
      btn.addEventListener("click", () => openEventEditor(btn.dataset.day, null));
    });
    document.getElementById("addDateBtn")?.addEventListener("click", () => openEventEditor(isoDate(YEAR, calMonth, 1), null));
    document.getElementById("icsAllBtn")?.addEventListener("click", () => {
      const list = upcoming.filter((e) => e.event_date >= today || YEAR > new Date().getFullYear());
      downloadIcs(list.length ? list : upcoming);
    });
    root.querySelectorAll("[data-gcal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const event = events.find((e) => e.id === btn.dataset.gcal);
        if (event) openGoogle(event);
      });
    });
    root.querySelectorAll("[data-edit-event]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const event = events.find((e) => e.id === btn.dataset.editEvent);
        if (event) openEventEditor(event.event_date, event);
      });
    });
    root.querySelectorAll("[data-drop-event]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        events = events.filter((e) => e.id !== btn.dataset.dropEvent);
        renderCalendar();
        await sync.removeEvent(btn.dataset.dropEvent);
      });
    });
  }

  function showTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    ["budget", "people", "shop", "dates", "bought"].forEach((id) => {
      const panel = document.getElementById(`panel${id[0].toUpperCase()}${id.slice(1)}`);
      const on = tab === id;
      panel.hidden = !on;
      panel.classList.toggle("is-active", on);
    });
  }

  document.getElementById("personBack").addEventListener("click", closePerson);
  document.getElementById("search").addEventListener("input", renderPeople);
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

  document.getElementById("addPersonBtn").addEventListener("click", () => {
    document.getElementById("addName").value = "";
    document.getElementById("addGroup").value = "";
    document.getElementById("addBudget").value = "";
    document.getElementById("addModal").showModal();
    document.getElementById("addName").focus();
  });
  document.getElementById("addCancel").addEventListener("click", () => document.getElementById("addModal").close());
  document.getElementById("addForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("addName").value.trim();
    if (!name) return;
    const person = {
      id: crypto.randomUUID(),
      year: YEAR,
      name,
      group_name: document.getElementById("addGroup").value.trim(),
      sort_order: people.reduce((max, p) => Math.max(max, p.sort_order || 0), 0) + 10,
      locked: false,
      budget: document.getElementById("addBudget").value === "" ? null : Number(document.getElementById("addBudget").value),
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
    render();
    await savePerson(person);
    showTab("people");
    openPerson(person.id);
  });

  document.getElementById("houseCancel").addEventListener("click", () => document.getElementById("houseModal").close());
  document.getElementById("houseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const budget = Number(document.getElementById("houseBudget").value);
    if (!Number.isFinite(budget) || budget < 0) return;
    house = { ...house, budget };
    document.getElementById("houseModal").close();
    render();
    await sync.saveSettings({ budget });
  });

  document.getElementById("lockCancel").addEventListener("click", () => document.getElementById("lockModal").close());
  document.getElementById("lockForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const person = personById(document.getElementById("lockModal").dataset.personId);
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
        const fresh = await sync.hydrate();
        house = fresh.settings || house;
        people = await decorate(fresh.people);
        render();
      } else {
        const secret = person._open ? secretPayload(person) : await window.WrapNestCrypto.decryptSecret(pw, person.salt, person.iv, person.ciphertext);
        Object.assign(person, secret, { locked: false, _open: true, salt: null, iv: null, ciphertext: null });
        delete passwords[person.id];
        savePasswords();
        await savePerson(person);
      }
      document.getElementById("lockModal").close();
    } catch (err) {
      error.hidden = false;
      error.textContent = lockMode === "lock" ? err.message : "That password did not work.";
    }
  });

  document.getElementById("priceClose").addEventListener("click", () => document.getElementById("priceModal").close());
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
      {
        id: crypto.randomUUID(),
        item: idea.text,
        price,
        shop: document.getElementById("foundShop").value.trim(),
        createdAt: new Date().toISOString(),
      },
      ...person.purchases,
    ];
    document.getElementById("priceModal").close();
    await savePerson(person);
    const left = leftOf(person);
    if (left != null && left <= 0 && !(person.ideas || []).length) burst();
  });

  document.getElementById("eventCancel").addEventListener("click", () => document.getElementById("eventModal").close());
  document.getElementById("eventDelete").addEventListener("click", async () => {
    if (!editingEventId) return;
    events = events.filter((e) => e.id !== editingEventId);
    document.getElementById("eventModal").close();
    renderCalendar();
    await sync.removeEvent(editingEventId);
  });
  document.getElementById("eventForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("eventName").value.trim();
    const event_date = document.getElementById("eventDate").value;
    if (!title || !event_date) return;
    if (event_date < "2026-11-01" || event_date > "2026-12-31") {
      const err = document.getElementById("eventError");
      err.hidden = false;
      err.textContent = "Keep dates in November or December.";
      return;
    }
    const row = {
      id: editingEventId || crypto.randomUUID(),
      year: YEAR,
      title,
      event_date,
      event_time: document.getElementById("eventTime").value || "",
      notes: document.getElementById("eventNotes").value.trim(),
      person_id: document.getElementById("eventPerson").value || "",
    };
    events = events.filter((e) => e.id !== row.id).concat([row]);
    document.getElementById("eventModal").close();
    renderCalendar();
    await sync.upsertEvent(row);
  });

  document.getElementById("spendCancel").addEventListener("click", () => document.getElementById("spendModal").close());
  document.getElementById("spendForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const person = personById(spendPersonId);
    if (!person) return;
    const item = document.getElementById("spendItem").value.trim();
    const price = Number(document.getElementById("spendPrice").value);
    if (!item || !Number.isFinite(price) || price < 0) return;
    person.purchases = [
      {
        id: crypto.randomUUID(),
        item,
        price,
        shop: document.getElementById("spendShop").value.trim(),
        createdAt: new Date().toISOString(),
      },
      ...person.purchases,
    ];
    document.getElementById("spendModal").close();
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
        if (event.data && ["YULE_SW_UPDATED", "SLEIGH_SW_UPDATED", "WRAPNEST_SW_UPDATED"].includes(event.data.type) && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  async function boot() {
    registerServiceWorker();
    const pill = document.getElementById("syncPill");
    pill.textContent = sync.ready() ? "Live" : "On this phone";
    pill.classList.toggle("is-live", sync.ready());
    pill.classList.toggle("is-off", !sync.ready());
    try {
      const fresh = await sync.hydrate();
      house = fresh.settings || {};
      events = fresh.events || [];
      people = await decorate(fresh.people);
    } catch (err) {
      console.warn(err);
      house = sync.settings();
      events = sync.readEvents ? sync.readEvents() : [];
      people = await decorate(sync.readCache());
    }
    render();
    sync.subscribe();
  }

  boot();
})();
