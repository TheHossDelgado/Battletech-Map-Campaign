// Vercel serverless function: swaps the one-time code from Discord for an access token.
// It runs on the server so the Discord client secret never reaches players' browsers.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const code = req.body && req.body.code;
  if (!code || typeof code !== "string") return res.status(400).json({ error: "Missing code" });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    return res.status(400).json({ error: "Discord rejected the code" });
  }
  return res.status(200).json({ access_token: data.access_token });
}
