/**
 * Yule sync via the Family Vault Supabase hub.
 * Cloud is the source of truth, with a local cache for offline use.
 */
(function () {
  const DEVICE_KEY = "family_vault_device_name_v1";
  const CACHE_KEY = "yule_people_cache_v3";
  const SETTINGS_CACHE = "yule_settings_cache_v1";
  const EVENTS_CACHE = "yule_events_cache_v1";
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

  function peopleUrl() {
    const table = (cfg().table || "wrapnest_people").trim();
    return `${cfg().url.replace(/\/$/, "")}/rest/v1/${table}`;
  }

  function settingsUrl() {
    const table = (cfg().settingsTable || "wrapnest_settings").trim();
    return `${cfg().url.replace(/\/$/, "")}/rest/v1/${table}`;
  }

  function eventsUrl() {
    const table = (cfg().eventsTable || "wrapnest_events").trim();
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

  function persistSettings(value) {
    try {
      localStorage.setItem(SETTINGS_CACHE, JSON.stringify(value || {}));
    } catch {
      /* ignore */
    }
  }

  function readSettingsCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_CACHE) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function persistEvents(events) {
    try {
      localStorage.setItem(EVENTS_CACHE, JSON.stringify(events || []));
    } catch {
      /* ignore */
    }
  }

  function readEventsCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(EVENTS_CACHE) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function normalizeEvent(row) {
    return {
      id: String(row.id),
      year: Number(row.year) || YEAR,
      title: String(row.title || "").trim(),
      event_date: String(row.event_date || "").slice(0, 10),
      event_time: row.event_time ? String(row.event_time).slice(0, 5) : "",
      notes: String(row.notes || ""),
      person_id: row.person_id ? String(row.person_id) : "",
      updated_at: row.updated_at || null,
      updated_by: row.updated_by || null,
    };
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
      last_year_spent: row.last_year_spent == null || row.last_year_spent === "" ? null : Number(row.last_year_spent),
      last_year_budget: row.last_year_budget == null || row.last_year_budget === "" ? null : Number(row.last_year_budget),
      wrapped: Boolean(row.wrapped),
      note: String(row.note || ""),
      updated_at: row.updated_at || null,
      updated_by: row.updated_by || null,
    };
  }

  function create(options) {
    const onRemoteChange = typeof options.onRemoteChange === "function" ? options.onRemoteChange : null;
    const year = Number(options.year) || YEAR;
    const settingsKey = `household_${year}`;

    let client = null;
    let channel = null;
    let pollTimer = null;
    let lastKnown = [];
    let lastSettings = readSettingsCache();
    let lastEvents = readEventsCache();
    let applyingRemote = false;

    async function fetchRemote() {
      if (!ready()) return null;
      const url =
        `${peopleUrl()}?year=eq.${encodeURIComponent(year)}` +
        `&select=id,year,name,group_name,sort_order,locked,salt,iv,ciphertext,budget,ideas,purchases,last_year_note,last_year_spent,last_year_budget,wrapped,note,updated_at,updated_by` +
        `&order=sort_order.asc,name.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) throw new Error(`Yule fetch failed (${res.status})`);
      return (await res.json() || []).map(normalizeRow);
    }

    async function fetchSettings() {
      if (!ready()) return lastSettings;
      const url = `${settingsUrl()}?key=eq.${encodeURIComponent(settingsKey)}&select=value`;
      const res = await fetch(url, {
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) throw new Error(`Yule settings fetch failed (${res.status})`);
      const rows = await res.json();
      const value = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
      lastSettings = value;
      persistSettings(value);
      return value;
    }

    async function fetchEvents() {
      if (!ready()) return lastEvents;
      const url =
        `${eventsUrl()}?year=eq.${encodeURIComponent(year)}` +
        `&select=id,year,title,event_date,event_time,notes,person_id,updated_at,updated_by` +
        `&order=event_date.asc,event_time.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) throw new Error(`Yule events fetch failed (${res.status})`);
      return (await res.json() || []).map(normalizeEvent);
    }

    function applyRemote(people, settings, events, notify) {
      lastKnown = people.map((p) => ({ ...p }));
      if (settings) {
        lastSettings = settings;
        persistSettings(settings);
      }
      if (events) {
        lastEvents = events.map((e) => ({ ...e }));
        persistEvents(lastEvents);
      }
      persist(lastKnown);
      if (notify && onRemoteChange) {
        onRemoteChange(lastKnown.map((p) => ({ ...p })), { ...lastSettings }, lastEvents.map((e) => ({ ...e })));
      }
      return lastKnown.map((p) => ({ ...p }));
    }

    async function hydrate() {
      const local = readCache();
      if (!ready()) {
        lastKnown = local;
        return { people: local.map((p) => ({ ...p })), settings: lastSettings, events: lastEvents.map((e) => ({ ...e })) };
      }
      try {
        const [remote, settings, events] = await Promise.all([fetchRemote(), fetchSettings(), fetchEvents()]);
        if (!remote) {
          lastKnown = local;
          return { people: local.map((p) => ({ ...p })), settings: lastSettings, events: lastEvents.map((e) => ({ ...e })) };
        }
        applyRemote(remote, settings, events, false);
        return { people: remote.map((p) => ({ ...p })), settings: { ...lastSettings }, events: lastEvents.map((e) => ({ ...e })) };
      } catch (err) {
        console.warn("Yule hydrate failed; using local cache", err);
        lastKnown = local;
        return { people: local.map((p) => ({ ...p })), settings: lastSettings, events: lastEvents.map((e) => ({ ...e })) };
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
        last_year_spent: person.last_year_spent,
        last_year_budget: person.last_year_budget,
        wrapped: person.locked ? false : Boolean(person.wrapped),
        note: person.locked ? "" : person.note || "",
        updated_at: new Date().toISOString(),
        updated_by: deviceName(),
      };
    }

    async function upsert(person) {
      const row = toRow(person);
      lastKnown = lastKnown.filter((p) => p.id !== person.id).concat([normalizeRow({ ...person, ...row })]);
      persist(lastKnown);
      if (!ready()) return;
      const res = await fetch(`${peopleUrl()}?on_conflict=id`, {
        method: "POST",
        headers: headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Yule upsert failed (${res.status}) ${text}`);
      }
    }

    async function remove(id) {
      lastKnown = lastKnown.filter((p) => p.id !== id);
      persist(lastKnown);
      if (!ready()) return;
      const res = await fetch(`${peopleUrl()}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Yule delete failed (${res.status}) ${text}`);
      }
    }

    async function saveSettings(patch) {
      lastSettings = { ...lastSettings, ...(patch || {}) };
      persistSettings(lastSettings);
      if (!ready()) return lastSettings;
      const res = await fetch(`${settingsUrl()}?on_conflict=key`, {
        method: "POST",
        headers: headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({
          key: settingsKey,
          value: lastSettings,
          updated_at: new Date().toISOString(),
          updated_by: deviceName(),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Yule settings save failed (${res.status}) ${text}`);
      }
      return lastSettings;
    }

    function toEventRow(event) {
      return {
        id: event.id,
        year,
        title: event.title,
        event_date: event.event_date,
        event_time: event.event_time || null,
        notes: event.notes || "",
        person_id: event.person_id || null,
        updated_at: new Date().toISOString(),
        updated_by: deviceName(),
      };
    }

    async function upsertEvent(event) {
      const row = toEventRow(event);
      lastEvents = lastEvents.filter((e) => e.id !== event.id).concat([normalizeEvent(row)]);
      persistEvents(lastEvents);
      if (!ready()) return;
      const res = await fetch(`${eventsUrl()}?on_conflict=id`, {
        method: "POST",
        headers: headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Yule event save failed (${res.status}) ${text}`);
      }
    }

    async function removeEvent(id) {
      lastEvents = lastEvents.filter((e) => e.id !== id);
      persistEvents(lastEvents);
      if (!ready()) return;
      const res = await fetch(`${eventsUrl()}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          apikey: cfg().anonKey.trim(),
          Authorization: `Bearer ${cfg().anonKey.trim()}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Yule event delete failed (${res.status}) ${text}`);
      }
    }

    async function pullAndNotify() {
      if (applyingRemote) return;
      applyingRemote = true;
      try {
        const [remote, settings, events] = await Promise.all([fetchRemote(), fetchSettings(), fetchEvents()]);
        if (!remote) return;
        if (
          JSON.stringify(remote) === JSON.stringify(lastKnown) &&
          JSON.stringify(settings) === JSON.stringify(lastSettings) &&
          JSON.stringify(events) === JSON.stringify(lastEvents)
        ) {
          return;
        }
        applyRemote(remote, settings, events, true);
      } catch (err) {
        console.warn("Yule pull failed", err);
      } finally {
        applyingRemote = false;
      }
    }

    function subscribe() {
      if (!ready()) return;
      if (!pollTimer) pollTimer = window.setInterval(() => pullAndNotify(), POLL_MS);
      if (!window.supabase?.createClient || channel) return;
      try {
        client = window.supabase.createClient(cfg().url.trim(), cfg().anonKey.trim());
        channel = client
          .channel(`yule-${year}`)
          .on("postgres_changes", { event: "*", schema: "public", table: cfg().table || "wrapnest_people" }, () => pullAndNotify())
          .on("postgres_changes", { event: "*", schema: "public", table: cfg().settingsTable || "wrapnest_settings" }, () => pullAndNotify())
          .on("postgres_changes", { event: "*", schema: "public", table: cfg().eventsTable || "wrapnest_events" }, () => pullAndNotify())
          .subscribe();
      } catch (err) {
        console.warn("Yule realtime unavailable; polling only", err);
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
      saveSettings,
      upsertEvent,
      removeEvent,
      settings: () => ({ ...lastSettings }),
      readEvents: () => lastEvents.map((e) => ({ ...e })),
      subscribe,
      unsubscribe,
      pullAndNotify,
      readCache,
    };
  }

  window.YuleSync = { create, YEAR };
  window.SleighSync = window.YuleSync;
  window.MantelSync = window.YuleSync;
})();
