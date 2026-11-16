# DLockPazzle Multiplayer Worker

This folder contains the separate Cloudflare Worker + Durable Objects service for online two-player score matches.

## Important

- This service is separate from the existing static game page.
- Deploying this Worker does **not** update the existing game site.
- The game page asks for this Worker's URL in the two-player dialog.
- A room is identified by a six-digit code and supports two connected players.
- This first version synchronizes match start and score/line/level/game-over state. It does not send block attacks.

## Deploy when ready

From this directory:

```sh
npx wrangler deploy
```

After deployment, copy the Worker URL (for example, `https://<worker-name>.<account>.workers.dev`) into the game's **二人対戦** dialog. The page automatically uses its `/ws` WebSocket endpoint.

The first deployment creates the SQLite-backed Durable Object namespace using the migration in `wrangler.jsonc`. Do not deploy until the Cloudflare account, Worker name, and intended environment have been reviewed.

## Local development

```sh
npx wrangler dev
```

Use the local Worker WebSocket URL shown by Wrangler in the game's endpoint field. Open two separate browser sessions and create/join the same six-digit room.

## Current limitations

- No reconnect/resume after a socket disconnect.
- Room membership exists only while the room's WebSocket sessions are connected.
- Room codes are six digits; share them only with the intended opponent.
- Two-browser end-to-end testing is still required before release.
