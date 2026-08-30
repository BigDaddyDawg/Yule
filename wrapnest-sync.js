/**
 * WrapNest people sync via the Family Vault Supabase hub.
 * Cloud is the source of truth, with a local cache for offline use.
 */
(function () {
  const DEVICE_KEY = "family_vault_device_name_v1";
  const CACHE_KEY = "wrapnest_people_cache_v1";
  const POLL_MS = 8000;
  const YEAR = 2026;

  function cfg() {
    return window.FAMILY_VAULT || {};
  }

  function ready() {
    const c = cfg();
    return Boolean((c.url || "").trim() && (c.anonKey || "").trim());
  }

  function deviceName() {
    try {
      let name = (localStorage.getItem(DEVICE_KEY) || "").trim();
      if (!name) {
        name = `device-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(DEVICE_KEY, name);
      }
      return name;
    } catch {
      return "unknown";
    }
  }

  function headers(prefer) {
    const key = cfg().anonKey.trim();
    const h = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (prefer) h.Prefer = prefer;
    return h;
  }

  function baseUrl() {
    const table = (cfg().table || "wrapnest_people").trim();
    return `${cfg().url.replace(/\/$/, "")}/rest/v1/${table}`;
  }

  function persist(people) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(people));
    } catch (err) {
      console.warn("Could not cache list locally", err);
    }
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function normalizeRow(row) {
    return {
      id: String(row.id),
      year: Number(row.year) || YEAR,
      name: String(row.name || "").trim(),
      group_name: String(row.group_name || "").trim(),
      sort_order: Number(row.sort_order) || 0,
      locked: Boolean(row.locked),
      salt: row.salt || null,
      iv: row.iv || null,
      ciphertext: row.ciphertext || null,
      budget: row.budget == null || row.budget === "" ? null : Number(row.budget),
      ideas: Array.isArray(row.ideas) ? row.ideas : [],
      purchases: Array.isArray(row.purchases) ? row.purchases : [],
      last_year_note: String(row.last_year_note || ""),
      updated_at: row.updated_at || null,
      updated_by: row.updated_by || null,
    };
  }

  function create(options) {
    const onRemoteChange = typeof options.onRemoteChange === "function" ? options.onRemoteChange : null;
    const year = Number(options.year) || YEAR;

    let client = null;
    let channel = null;
    let pollTimer = null;
    let lastKnown = [];
    let applyingRemote = false;

    async function fetchRemote() {
      if (!ready()) return null;
      const url =
        `${baseUrl()}?year=eq.${encodeURIComponent(year)}` +
        `&select=id,year,name,group_name,sort_order,locked,salt,iv,ciphertext,budget,ideas,purchases,last_year_note,updated_at,updated_by` +
        `&order=sort_order.asc,name.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) throw new Error(`WrapNest fetch failed (${res.status})`);
      const rows = await res.json();
      return (rows || []).map(normalizeRow);
    }

    function applyRemote(people, notify) {
      lastKnown = people.map((p) => ({ ...p }));
      persist(lastKnown);
      if (notify && onRemoteChange) onRemoteChange(lastKnown.map((p) => ({ ...p })));
      return lastKnown.map((p) => ({ ...p }));
    }

    async function hydrate() {
      const local = readCache();
      if (!ready()) {
        lastKnown = local;
        return local.map((p) => ({ ...p }));
      }
      try {
        const remote = await fetchRemote();
        if (!remote) {
          lastKnown = local;
          return local.map((p) => ({ ...p }));
        }
        return applyRemote(remote, false);
      } catch (err) {
        console.warn("WrapNest hydrate failed; using local cache", err);
        lastKnown = local;
        return local.map((p) => ({ ...p }));
      }
    }

    function toRow(person) {
      return {
        id: person.id,
        year,
        name: person.name,
        group_name: person.group_name || "",
        sort_order: Number(person.sort_order) || 0,
        locked: Boolean(person.locked),
        salt: person.locked ? person.salt || null : null,
        iv: person.locked ? person.iv || null : null,
        ciphertext: person.locked ? person.ciphertext || null : null,
        budget: person.locked ? null : person.budget,
        ideas: person.locked ? [] : person.ideas || [],
        purchases: person.locked ? [] : person.purchases || [],
        last_year_note: person.locked ? "" : person.last_year_note || "",
        updated_at: new Date().toISOString(),
        updated_by: deviceName(),
      };
    }

    async function upsert(person) {
      const row = toRow(person);
      lastKnown = lastKnown.filter((p) => p.id !== person.id).concat([normalizeRow({ ...person, ...row })]);
      persist(lastKnown);
      if (!ready()) return;
      const res = await fetch(`${baseUrl()}?on_conflict=id`, {
        method: "POST",
        headers: headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`WrapNest upsert failed (${res.status}) ${text}`);
      }
    }

    async function remove(id) {
      lastKnown = lastKnown.filter((p) => p.id !== id);
      persist(lastKnown);
      if (!ready()) return;
      const url = `${baseUrl()}?id=eq.${encodeURIComponent(id)}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`WrapNest delete failed (${res.status}) ${text}`);
      }
    }

    async function pullAndNotify() {
      if (applyingRemote) return;
      applyingRemote = true;
      try {
        const remote = await fetchRemote();
        if (!remote) return;
        const a = JSON.stringify(remote);
        const b = JSON.stringify(lastKnown);
        if (a === b) return;
        applyRemote(remote, true);
      } catch (err) {
        console.warn("WrapNest pull failed", err);
      } finally {
        applyingRemote = false;
      }
    }

    function subscribe() {
      if (!ready()) return;
      if (!pollTimer) {
        pollTimer = window.setInterval(() => pullAndNotify(), POLL_MS);
      }
      if (!window.supabase?.createClient || channel) return;
      try {
        client = window.supabase.createClient(cfg().url.trim(), cfg().anonKey.trim());
        channel = client
          .channel(`wrapnest-people-${year}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: cfg().table || "wrapnest_people",
            },
            () => pullAndNotify()
          )
          .subscribe();
      } catch (err) {
        console.warn("WrapNest realtime unavailable; polling only", err);
      }
    }

    function unsubscribe() {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (channel && client) client.removeChannel(channel).catch(() => {});
      channel = null;
      client = null;
    }

    return {
      ready,
      year,
      hydrate,
      upsert,
      remove,
      subscribe,
      unsubscribe,
      pullAndNotify,
      readCache,
    };
  }

  window.WrapNestSync = { create, YEAR };
})();
