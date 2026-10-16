# Hexagon Sector Map: standalone version

The same game as the Claude artifact, running on your own hosting. Players don't need Claude
accounts. It works two ways:

- **As a Discord Activity:** players launch it from a voice channel and are signed in with
  Discord. Each channel keeps its own game between sessions.
- **In a normal browser:** players open the link, type a name once, and play. Add `?room=anything`
  to the URL to run separate games (default room is `main`).

Everything from the artifact carries over: the 6-player hexagon map, seats, lances and actions,
movement rules, rosters and subtitles, salvage documents, and destroyed sites and highways.
Game data from the Claude artifact does not transfer; games start fresh.

## What's in here

| Path | What it does |
| --- | --- |
| `index.html` | Page layout and styles |
| `src/game.js` | The game itself (ported unchanged apart from how it connects) |
| `src/store.js` | Shared, live game data on Supabase |
| `src/identity.js` | Discord sign-in, or a guest name in a browser |
| `src/main.js` | Wires the pieces together |
| `api/token.js` | Small server function that completes Discord sign-in |
| `supabase/schema.sql` | Database setup |

## 1. Set up the database (Supabase)

1. Create a project at supabase.com (the free plan is enough).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and run it.
3. From **Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Deploy the site (Vercel)

1. Put this folder in a GitHub repository and import it in Vercel (framework: **Vite**).
   Vercel serves the site and turns `api/token.js` into a server function automatically.
2. In **Project → Settings → Environment Variables**, add the values from `.env.example`:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` from step 1
   - `VITE_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` from step 3 (you can add these after)
   - `ADMIN_CODE` and `SUPABASE_SERVICE_ROLE_KEY` for admin controls, plus optional
     `VITE_ADMIN_IDS` (see "Admin controls")
3. Deploy. You can already play in a browser at your Vercel address.

Redeploy after changing any `VITE_` variable; they're built into the page.

## 3. Register the Discord Activity

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**, then copy the **Application ID** (`VITE_DISCORD_CLIENT_ID`).
2. **OAuth2:** reset and copy the **Client Secret** (`DISCORD_CLIENT_SECRET`), and add a
   redirect URI (any valid URL such as `https://127.0.0.1`; Discord requires one).
3. **Activities → Getting Started:** turn on **Enable Activities**.
4. **Activities → URL Mappings:** add two mappings:

   | Prefix | Target |
   | --- | --- |
   | `/` | your Vercel domain, e.g. `hex-sector-map.vercel.app` |
   | `/supabase` | your Supabase host, e.g. `abcdefgh.supabase.co` |

   Discord only lets an Activity talk to mapped addresses, so both are required.
5. Add the client ID and secret to Vercel and redeploy.
6. Install the app to your server (**Installation**), join a voice channel, open the
   **Activities** (rocket) button, and pick your app.

While the app is unverified, only you and people you add as app testers in the portal
(**App Testers**) can launch it.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev                  # http://localhost:5173/?room=test
```

The Discord token function only runs on Vercel (or with `vercel dev`). To test inside
Discord before deploying, run `vercel dev`, expose it with a tunnel such as
`cloudflared tunnel --url http://localhost:3000`, and point the `/` URL mapping at the
tunnel address.

## Admin controls

Only admins can use **New map**, **Reset lances** and **Load seed**, or free another player's
seat. Everyone else doesn't see those buttons, and the database itself refuses map changes
from ordinary players, so the rule can't be bypassed by editing the page.

There are two ways to be an admin:

- **Admin code.** Set `ADMIN_CODE` in Vercel to a long secret phrase. Anyone can click the
  **Admin** button next to the Live game tag, enter the code, and become an admin on that
  device until they click **Admin · sign out**. Share the code only with your game masters.
- **Listed Discord users.** Put Discord user ids in `VITE_ADMIN_IDS` (comma-separated).
  They're admins automatically when they launch the Activity in Discord. To find an id:
  Discord Settings → Advanced → Developer Mode, then right-click the user → Copy User ID.

Admin actions run through `api/admin.js`, which needs `SUPABASE_SERVICE_ROLE_KEY` (Supabase:
Project Settings → API → service_role). Keep that key only in Vercel; never give it a
`VITE_` name, or it would be published inside the page.

After updating to this version, **run `supabase/schema.sql` again** so the database starts
refusing map changes from non-admins.

## Hardening before sharing widely

This first version trusts anyone who has the site's public key, which is fine for a private
game among friends. Anyone technically minded could still edit game data directly. Before
opening it to the public:

- Have `api/token.js` also issue a signed Supabase token (JWT) for the Discord user, and
  change the database policies to require it.
- Limit writes to a seat document to the player who owns that seat.
- Admin-only map changes are already enforced by the database; seat claims and lance moves
  are not yet.

## Troubleshooting: the board resets every time

The game saves to Supabase only when it's connected. The tag next to the map controls tells
you which mode you're in: **Live game** (saving), **Connecting…**, or **Local game · not
saved**. When it isn't saving, the Players panel says why. The usual causes:

1. **The Supabase settings aren't in the build.** In Vercel, check that `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY` are set for the **Production** environment, then
   **Redeploy**. `VITE_` settings are baked in when the site builds, so adding them without
   redeploying changes nothing.
2. **The database table is missing.** Run all of `supabase/schema.sql` in Supabase
   (SQL Editor → New query → Run). Afterwards, **Table Editor** should list `docs` and `leases`.
3. **A different room.** Each `?room=` value is a separate saved game, and a link without it
   uses `main`. Inside Discord, each channel has its own game.
4. **Wrong key.** Use the **anon / publishable** key from Project Settings → API, never the
   service-role / secret key.

To confirm saving works: make a move, then open Supabase → Table Editor → `docs`. You should
see rows such as `game/state` and `seats/p1` for your room. Reload the page and the board
should come back as you left it.

If live updates between players are slow (a few seconds) but saving works, Realtime isn't
switched on for the table; the game falls back to checking every 3 seconds. Re-running
`schema.sql` turns it on, or enable it under Database → Publications → `supabase_realtime`.
