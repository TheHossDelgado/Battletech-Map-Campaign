// Works out who is playing and which game ("room") they're in.
// Inside Discord: signs in with the Embedded App SDK; the room is the voice/text channel,
//                 so each channel keeps its own game between sessions.
// In a normal browser: asks once for a player name (kept in localStorage); the room
//                 comes from ?room=name in the URL, defaulting to "main".
import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";

const cleanRoom = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "main";

export const inDiscord = () => new URLSearchParams(location.search).has("frame_id");

export async function discordIdentity({ clientId, supabaseHost }) {
  // Inside Discord every outside request must go through Discord's proxy.
  // This mapping must match the "/supabase" URL mapping in the Developer Portal.
  patchUrlMappings([{ prefix: "/supabase", target: supabaseHost }]);

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  // "/.proxy/" sends the request to this app's own server through Discord's proxy
  const res = await fetch("/.proxy/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Discord token exchange failed");
  const { access_token } = await res.json();
  const auth = await sdk.commands.authenticate({ access_token });
  if (!auth || !auth.user) throw new Error("Discord sign-in failed");
  const u = auth.user;
  return {
    id: "d_" + u.id,
    discordId: u.id,
    name: u.global_name || u.username || "Player",
    room: cleanRoom(sdk.channelId || sdk.instanceId),
    accessToken: access_token,
  };
}

export function guestIdentity() {
  let id = null, name = null;
  try { id = localStorage.getItem("hex.playerId"); name = localStorage.getItem("hex.playerName"); } catch (e) {}
  if (!id) id = "g_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  if (!name) {
    name = (window.prompt("Your player name for this game:", "") || "").trim().slice(0, 40) || "Player " + id.slice(2, 6);
  }
  try { localStorage.setItem("hex.playerId", id); localStorage.setItem("hex.playerName", name); } catch (e) {}
  return { id, name, room: cleanRoom(new URLSearchParams(location.search).get("room")) };
}
