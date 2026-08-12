# 💬 Ephemeral Chat

🌐 [Español](./README.md) · **English** · [Português](./README.pt.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MauricioPerera/wrangler-ephemeral-chat)

🌐 **[Landing page](https://mauricioperera.github.io/wrangler-ephemeral-chat/)** — visual presentation of the project, available in español / English / português.

A real-time chat that deploys in seconds on a **Cloudflare temporary account**, no login required, and **self-destructs** when that account expires (~1 hour).

Built on [Durable Objects](https://developers.cloudflare.com/durable-objects/) (WebSockets + SQLite) and the [`wrangler deploy --temporary`](https://developers.cloudflare.com/workers/platform/claim-deployments/) flag.

Sibling of [wrangler-ephemeral-whiteboard](https://github.com/MauricioPerera/wrangler-ephemeral-whiteboard) ([landing page](https://mauricioperera.github.io/wrangler-ephemeral-whiteboard/)) — same pattern, but for drawing instead of chatting.

## How it works

- `wrangler deploy --temporary` creates a temporary Cloudflare account (no login), deploys the Worker, and gives you a public URL on `workers.dev`.
- That account — and everything in it: the Worker, the chat, the messages — lives for **~60 minutes**. If nobody claims it (by opening the claim URL wrangler prints and completing the login), Cloudflare deletes it automatically. Nothing to clean up.
- The chat itself runs on a single Durable Object with SQLite state: messages, room config, and invites.

## Requirements

- Node.js
- Wrangler **4.102.0 or later**
- **Not logged in** to Wrangler (`wrangler logout` if you already have a session) — `--temporary` only works without existing credentials

## Deploy

```bash
git clone https://github.com/MauricioPerera/wrangler-ephemeral-chat.git
cd wrangler-ephemeral-chat
npm install
npx wrangler deploy --temporary
```

The output gives you the chat URL and a **claim URL**. Share the chat URL with whoever you want to invite. If you want to keep the Worker permanently, open the claim URL and complete the Cloudflare login before the hour is up — if you do nothing, everything deletes itself.

### Permanent deploy (optional)

If you'd rather it didn't expire, run `wrangler login` and `npx wrangler deploy` instead of `--temporary`.

You can also use the **Deploy to Cloudflare** button above: it clones the repo into your GitHub/GitLab account, provisions the needed resources (the Durable Object), and deploys it to your Cloudflare account, with CI/CD (Workers Builds) for future pushes. Unlike `--temporary`, this path requires logging into Cloudflare and the Worker **does not expire** — it's the way to keep the chat permanently without touching the CLI. More info: [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

## Features

- **Real-time chat** via WebSockets (Durable Objects hibernation API)
- **Persistent history** (last 50 messages per room, in the Durable Object's own SQLite)
- **Per-message identity**: name + color per user
- **Open / closed mode**: anyone with the link (open) vs. invitees only (closed)
- **Admin**: whoever connects first with `?admin=1` becomes admin; gets a link with a token to reconnect as admin later
- **Single-use invites**: the admin generates `?invite=<token>` links that get consumed on first use
- **Countdown banner**: shows how much time is left (approximate) before the temporary account expires
- **Mobile-friendly UI**: full-screen on phones, chat bubbles, HTML escaping (no XSS)

## Usage

1. Open the deploy URL → login screen, enter a name.
2. To become admin of the room: add `?admin=1` to the URL the first time you enter. Save the link with your admin token shown in the panel — you'll need it to reconnect as admin.
3. From the admin panel: toggle between open/closed room, and generate invites (one link per person, single-use).

## Structure

```
src/index.js       — Worker + Durable Object (ChatRoom) + embedded UI
wrangler.jsonc      — Worker config and Durable Object binding
```

The entire frontend lives embedded as HTML/CSS/JS inside the Worker itself — no build step, no external assets.

## Limitations (inherited from Cloudflare temporary accounts)

- Durable Objects, KV, D1, Hyperdrive, Queues, and mTLS certificates are supported on temporary accounts — **R2 and Vectorize are not**.
- The 60-minute timer is fixed from account creation, it does not extend with activity.
- Temporary account tokens don't have every permission a real account has.

More info: [Claim deployments · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)

## Are you an AI agent?

See [AGENTS.md](./AGENTS.md) for autonomous deployment instructions with `wrangler --temporary`: requirements, exact commands, real-world gotchas (cached credentials, unsupported subcommands, post-deploy verification), and what to report back to the user.
