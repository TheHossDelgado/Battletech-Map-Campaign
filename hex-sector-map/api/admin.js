// Vercel serverless function for admin-only actions (New map, Reset lances, Load seed).
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
  if (body.action !== "setGame") return res.status(400).json({ error: "Unknown action" });

  const { room, seed, epoch } = body;
  if (typeof room !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(room)) return res.status(400).json({ error: "Bad room" });
  if (!Number.isInteger(seed) || seed < 0 || seed > 1e9) return res.status(400).json({ error: "Bad seed" });
  if (typeof epoch !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(epoch)) return res.status(400).json({ error: "Bad epoch" });

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
    body: JSON.stringify({ room, path: "game/state", collection: "game", data: { seed, epoch } }),
  });
  if (!r.ok) return res.status(502).json({ error: "Couldn't save the new map: " + (await r.text()).slice(0, 200) });
  return res.status(200).json({ ok: true });
}
