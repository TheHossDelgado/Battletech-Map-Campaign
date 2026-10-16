// A small document store on top of one Supabase table ("docs").
// It mirrors the slice of the Claude artifact `db` API that game.js uses:
//   db.doc(path).get() / set(data) / delete() / acquire({holder,ttlMs}) / onSnapshot(fn)
//   db.collection(path).onSnapshot(fn) / db.collection(path).doc(id)
// Every document lives in a "room" (one game), so one database can host many games.

const parentOf = (path) => path.split("/").slice(0, -1).join("/");
const idOf = (path) => path.split("/").pop();
const freeze = (v) => (v == null ? v : Object.freeze(JSON.parse(JSON.stringify(v))));

export function createStore(supabase, room) {
  const cache = new Map(); // path -> { data, updatedAt }
  const docListeners = new Map(); // path -> Set(fn)
  const colListeners = new Map(); // collection -> Set(fn)
  let loaded = false;
  const waiting = [];

  const docSnap = (path, pending = false) => {
    const e = cache.get(path);
    const data = e ? freeze(e.data) : undefined;
    return { id: idOf(path), exists: !!e, data: () => data, metadata: { fromCache: !loaded, hasPendingWrites: pending } };
  };
  const colSnap = (col) => {
    const docs = [];
    for (const [p] of cache) if (parentOf(p) === col) docs.push(docSnap(p));
    docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: !loaded } };
  };
  const notify = (path, pending = false) => {
    (docListeners.get(path) || []).forEach((fn) => safe(fn, docSnap(path, pending)));
    (colListeners.get(parentOf(path)) || []).forEach((fn) => safe(fn, colSnap(parentOf(path))));
  };
  const safe = (fn, arg) => { try { fn(arg); } catch (e) { console.error(e); } };

  function apply(path, data, updatedAt) {
    const cur = cache.get(path);
    if (data == null) {
      if (!cur) return false;
      cache.delete(path);
      return true;
    }
    if (cur && updatedAt && cur.updatedAt && updatedAt < cur.updatedAt) return false; // older than what we have
    cache.set(path, { data, updatedAt: updatedAt || new Date().toISOString() });
    return true;
  }

  async function loadAll() {
    const seen = new Set();
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from("docs").select("path,data,updated_at").eq("room", room)
        .order("path").range(from, from + page - 1);
      if (error) throw error;
      for (const row of data) { seen.add(row.path); if (apply(row.path, row.data, row.updated_at)) notify(row.path); }
      if (data.length < page) break;
    }
    // anything we hold that the server no longer has was deleted while we were away
    for (const p of [...cache.keys()]) if (!seen.has(p)) { cache.delete(p); notify(p); }
    if (!loaded) { loaded = true; waiting.splice(0).forEach((r) => r()); }
  }

  // Live updates. If Supabase Realtime isn't switched on for the table, fall back to
  // re-reading the game every few seconds so the game still saves and syncs.
  let pollTimer = null;
  const startPolling = () => {
    if (pollTimer) return;
    console.warn("Realtime unavailable; syncing by polling every 3 s.");
    pollTimer = setInterval(() => loadAll().catch((e) => console.error(e)), 3000);
  };
  const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

  const onRow = (payload) => {
    if (payload.eventType === "DELETE") {
      const old = payload.old || {};
      if (old.room !== room || !old.path) return;
      if (apply(old.path, null)) notify(old.path);
      return;
    }
    const row = payload.new;
    if (!row || row.room !== room) return;
    if (apply(row.path, row.data, row.updated_at)) notify(row.path);
  };
  let realtime = "connecting";
  supabase
    .channel("hex-docs-" + room)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "docs", filter: `room=eq.${room}` }, onRow)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "docs", filter: `room=eq.${room}` }, onRow)
    // Supabase can't filter DELETE events, so check the room in onRow
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "docs" }, onRow)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtime = "live"; stopPolling();
        // reload on every (re)connect so nothing missed while disconnected is lost
        if (loaded) loadAll().catch((e) => console.error(e));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        realtime = "polling"; startPolling();
      }
    });
  setTimeout(() => { if (realtime === "connecting") { realtime = "polling"; startPolling(); } }, 6000);

  // The first load comes straight from the database, so saved games appear even
  // before (or without) the live connection.
  const ready = loadAll().catch((e) => {
    const msg = (e && (e.message || e.code)) || String(e);
    throw new Error(/relation .*docs.* does not exist|Could not find the table/i.test(msg)
      ? "The database table is missing. Run supabase/schema.sql in the Supabase SQL editor."
      : /JWT|apikey|Invalid API key|No API key/i.test(msg)
      ? "Supabase rejected the key. Check VITE_SUPABASE_ANON_KEY in Vercel, then redeploy."
      : /Invalid path specified/i.test(msg)
      ? "VITE_SUPABASE_URL has extra text after the project address. Set it to just https://<your-project-ref>.supabase.co in Vercel, then redeploy."
      : "Couldn't read the game from Supabase: " + msg);
  });

  const whenLoaded = () => (loaded ? Promise.resolve() : new Promise((r) => waiting.push(r)));
  const collectionOf = (path) => parentOf(path);

  function doc(path) {
    return {
      id: idOf(path),
      path,
      async get() { await whenLoaded(); return docSnap(path); },
      async set(data) {
        const body = JSON.parse(JSON.stringify(data));
        apply(path, body, new Date().toISOString());
        notify(path, true);
        const { error } = await supabase.from("docs").upsert(
          { room, path, collection: collectionOf(path), data: body },
          { onConflict: "room,path" }
        );
        if (error) throw { code: "unavailable", message: error.message };
      },
      async update(data) {
        const cur = cache.get(path);
        if (!cur) throw { code: "invalid_argument", message: "Document does not exist" };
        return this.set({ ...cur.data, ...data });
      },
      async delete() {
        if (apply(path, null)) notify(path, true);
        const { error } = await supabase.from("docs").delete().eq("room", room).eq("path", path);
        if (error) throw { code: "unavailable", message: error.message };
      },
      async acquire({ holder, ttlMs = 30000 }) {
        const { data, error } = await supabase.rpc("acquire_lease", { p_room: room, p_path: path, p_holder: holder, p_ttl_ms: ttlMs });
        if (error) throw { code: "unavailable", message: error.message };
        return { acquired: !!data, holder: data ? holder : undefined };
      },
      onSnapshot(next) {
        if (!docListeners.has(path)) docListeners.set(path, new Set());
        docListeners.get(path).add(next);
        whenLoaded().then(() => docListeners.get(path)?.has(next) && safe(next, docSnap(path)));
        return () => docListeners.get(path)?.delete(next);
      },
      collection(sub) { return collection(path + "/" + sub); },
    };
  }

  function collection(col) {
    return {
      path: col,
      doc: (id) => doc(col + "/" + (id || Math.random().toString(36).slice(2, 12))),
      async get() { await whenLoaded(); return colSnap(col); },
      onSnapshot(next) {
        if (!colListeners.has(col)) colListeners.set(col, new Set());
        colListeners.get(col).add(next);
        whenLoaded().then(() => colListeners.get(col)?.has(next) && safe(next, colSnap(col)));
        return () => colListeners.get(col)?.delete(next);
      },
    };
  }

  return { ready, db: { doc, collection }, peek: (path) => cache.get(path)?.data, status: () => realtime };
}
