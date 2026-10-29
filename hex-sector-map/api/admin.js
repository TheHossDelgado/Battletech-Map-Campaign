// Vercel serverless function for admin-only actions: New map / Reset lances / Load seed,
// and Victory Point and XP changes.
// It checks the caller is an admin, then writes the map with the Supabase service key,
// because the database refuses map changes from ordinary players.
import { timingSafeEqual } from "node:crypto";

const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

async function isAdmin({ code, access_token }) {
  const adminCode = process.env.ADMIN_CODE;
  if (adminCode && code && sameText(code, adminCode)) return true;
  const ids = String(process.env.VITE_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length && access_token) {
    const r = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
    if (r.ok) { const u = await r.json(); return ids.includes(String(u.id)); }
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const body = req.body || {};
  if (!(await isAdmin(body))) return res.status(403).json({ error: "That admin code isn't right, or you aren't an admin." });
  if (body.action === "check") return res.status(200).json({ ok: true });
  const { room } = body;
  if (typeof room !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(room)) return res.status(400).json({ error: "Bad room" });

  let path, collection, data;
  if (body.action === "setGame") {
    const { seed, epoch } = body;
    if (!Number.isInteger(seed) || seed < 0 || seed > 1e9) return res.status(400).json({ error: "Bad seed" });
    if (typeof epoch !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(epoch)) return res.status(400).json({ error: "Bad epoch" });
    path = "game/state"; collection = "game"; data = { seed, epoch };
  } else if (body.action === "setScore") {
    // Victory Points and XP for one seat: { vp, xp: { Alpha: [4], Beta: [4], Gamma: [4] } }
    if (typeof body.path !== "string" || !/^scores\/p[1-6]$/.test(body.path)) return res.status(400).json({ error: "Bad score path" });
    const d = body.data || {};
    const n = (v) => Number.isInteger(v) && v >= 0 && v <= 999;
    if (!n(d.vp)) return res.status(400).json({ error: "Bad Victory Points" });
    const xp = {};
    for (const lance of ["Alpha", "Beta", "Gamma"]) {
      const arr = d.xp && d.xp[lance];
      if (!Array.isArray(arr) || arr.length !== 4 || !arr.every(n)) return res.status(400).json({ error: "Bad XP" });
      xp[lance] = arr;
    }
    path = body.path; collection = "scores"; data = { vp: d.vp, xp };
  } else {
    return res.status(400).json({ error: "Unknown action" });
  }

  const url = new URL(process.env.VITE_SUPABASE_URL).origin;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set in Vercel." });
  const r = await fetch(`${url}/rest/v1/docs?on_conflict=room,path`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ room, path, collection, data }),
  });
  if (!r.ok) return res.status(502).json({ error: "Couldn't save that change: " + (await r.text()).slice(0, 200) });
  return res.status(200).json({ ok: true });
}
