import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import { createClient } from "@supabase/supabase-js";
import { createStore } from "./store.js";
import { inDiscord, discordIdentity, guestIdentity } from "./identity.js";

// Accept the project URL with or without extra paths (e.g. ".../rest/v1/") and keep just
// "https://<project-ref>.supabase.co", which is what the Supabase client expects.
const RAW_SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
let SUPABASE_URL = "";
try { SUPABASE_URL = RAW_SUPABASE_URL ? new URL(RAW_SUPABASE_URL).origin : ""; } catch (e) { SUPABASE_URL = ""; }
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
// Discord users listed here are admins (New map, Reset lances, Load seed, freeing seats).
// Comma-separated Discord user ids. Anyone else can become an admin with the ADMIN_CODE.
// The server function api/admin.js checks both, so editing the page can't bypass it.
const ADMIN_IDS = String(import.meta.env.VITE_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const api = (name) => (inDiscord() ? "/.proxy/api/" : "/api/") + name;

async function callAdmin(body) {
  const res = await fetch(api("admin"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The admin request failed.");
  return data;
}

async function connect() {
  if (RAW_SUPABASE_URL && (!SUPABASE_URL || /(^|\.)supabase\.com$/.test(new URL(SUPABASE_URL).host))) {
    throw new Error("VITE_SUPABASE_URL isn't the project's API address. Use the Project URL from Supabase (Project Settings > API), like https://abcdefgh.supabase.co, then redeploy.");
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase isn't set up in this build. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.");
  }
  let me;
  if (inDiscord()) {
    me = await discordIdentity({ clientId: DISCORD_CLIENT_ID, supabaseHost: new URL(SUPABASE_URL).host });
  } else {
    await new Promise((r) => setTimeout(r, 300)); // let the map draw before asking for a name
    me = guestIdentity();
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const store = createStore(supabase, me.room);
  await store.ready;

  // Store this player's display name so other players see it on the seat list
  store.db.doc("players/" + me.id).set({ name: me.name }).catch(() => {});

  // Admin rights: a listed Discord user, or anyone holding the admin code
  const listedAdmin = !!(me.discordId && ADMIN_IDS.includes(me.discordId));
  let adminCode = null;
  try { adminCode = localStorage.getItem("hex.adminCode"); } catch (e) {}
  if (adminCode && !listedAdmin) {
    try { await callAdmin({ action: "check", code: adminCode }); }
    catch (e) { adminCode = null; try { localStorage.removeItem("hex.adminCode"); } catch (e2) {} }
  }
  let isAdmin = listedAdmin || !!adminCode;
  const creds = () => ({ code: adminCode || undefined, access_token: me.accessToken || undefined });

  window.__hexAdmin = ({ seed, epoch }) => {
    if (!isAdmin) return Promise.reject(new Error("Only an admin can change the map."));
    return callAdmin({ action: "setGame", room: me.room, seed, epoch, ...creds() });
  };
  window.__hexAdminDoc = (path, data) => {
    if (!isAdmin) return Promise.reject(new Error("Only an admin can change Victory Points and XP."));
    return callAdmin({ action: "setScore", room: me.room, path, data, ...creds() });
  };
  setupAdminButton({
    listedAdmin,
    isAdmin: () => isAdmin,
    signIn: async () => {
      const code = (window.prompt("Admin code:", "") || "").trim();
      if (!code) return;
      try {
        await callAdmin({ action: "check", code });
        adminCode = code; isAdmin = true;
        try { localStorage.setItem("hex.adminCode", code); } catch (e) {}
        window.__hexSetAdmin && window.__hexSetAdmin(true);
      } catch (e) { alert(e.message || "That admin code isn't right."); }
    },
    signOut: () => {
      adminCode = null; isAdmin = listedAdmin;
      try { localStorage.removeItem("hex.adminCode"); } catch (e) {}
      window.__hexSetAdmin && window.__hexSetAdmin(isAdmin);
    },
  });

  const user = {
    id: async () => me.id,
    isOwner: async () => isAdmin,
    canEdit: async () => isAdmin,
    can: async (name) => (name === "data.write" ? true : null),
    me: async () => ({ id: me.id, name: me.name, isOwner: isAdmin, canEdit: isAdmin }),
    profiles: async (ids) =>
      Object.fromEntries(ids.map((id) => [id, { id, name: (store.peek("players/" + id) || {}).name || "", isMe: id === me.id }])),
  };
  return { db: store.db, user, me };
}

window.__hexBackend = connect().catch((e) => {
  console.error(e);
  window.__hexBackendError = (e && e.message) || "Couldn't reach the game server.";
  return null;
});

// Load the game after the backend promise exists; the game renders a local map at once
// and switches to the live game when the promise resolves.
import("./game.js");

// A small "Admin" button beside the Live game tag: sign in with the admin code, or sign out.
function setupAdminButton({ listedAdmin, isAdmin, signIn, signOut }) {
  const tag = document.getElementById("livetag");
  if (!tag || listedAdmin) return; // listed Discord admins are always admins
  const btn = document.createElement("button");
  btn.className = "sbtn";
  btn.id = "adminbtn";
  const label = () => { btn.textContent = isAdmin() ? "Admin · sign out" : "Admin"; };
  btn.addEventListener("click", async () => { if (isAdmin()) signOut(); else await signIn(); label(); });
  label();
  tag.after(btn);
}
