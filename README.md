# To Do

**Live site:** shown in Cloudflare after the first deploy (Workers and Pages, then todo-app, then Visit). It looks like https://todo-app.YOURNAME.workers.dev. Paste it here once you have it.

**Upload files:** https://github.com/Emaildougb/todo/upload/main

**Repo:** https://github.com/Emaildougb/todo

## What it is

A shared checklist for Doug and Roman. Each person signs in with their own PIN on their own phone and sees the same lists. It runs free on Cloudflare (a Worker plus a D1 database).

- Doug sees Personal, Work, Roman and Dad, and Roman.
- Roman sees only Roman and Dad, and Roman, plus his own chores. He can add items and check off anything he sees. He can only edit or delete items he added.
- Chores: Doug sets repeating chores for Roman (every day or chosen days). Roman checks them off on his phone. A chore he skipped shows red as missed until he checks it.
- Any item with a store shows up on the Shopping tab, grouped by store.

## Files

- `src/worker.js` the server: PIN login, lists, items, shopping.
- `src/config.js` the people, the lists, the starting items, the store names. Change names and starter items here.
- `public/` the app screens (index.html, app.js, styles.css, icons).
- `wrangler.jsonc` Cloudflare settings. The database is created on first deploy.
- `preview/` builds the sample data preview. Not needed to run the app.

## Setup (once)

1. Cloudflare dashboard, Workers and Pages, Create, Import a repository, pick the `todo` repo. Production branch `main`. Leave the build command empty. Deploy command `npx wrangler deploy`.
2. The first deploy creates the `todo-db` database by itself. If it complains about the database, create one named `todo-db` in Storage and databases, D1, and put its id under `database_name` in `wrangler.jsonc` as `"database_id"`.
3. In the Worker settings, Variables and secrets, add two secrets: `PIN_DOUG` and `PIN_ROMAN`. Type the PINs yourself. Nobody else needs to see them. Redeploy once after adding them.
4. Open the live site on each phone, sign in, then Share, Add to Home Screen.
5. In Settings on Doug's phone, paste the backup from the old app under Bring in my old list.

## Updating

Upload changed files with the Upload files link above and commit. Cloudflare deploys in about a minute. The app updates itself when opened, or tap Refresh at the top. Lists live in the database, so updates never touch your data.

## Not in this version

Reminders to your phone. They are planned for the next version.
