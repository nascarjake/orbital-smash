# Orbital Smash Leaderboard Proxy

GitHub Pages serves the game over HTTPS, but this Dreamlo leaderboard only exposes working JSON over HTTP. Browsers block that as mixed content, and public CORS proxy services can fail or block requests without warning. This Worker gives the game a first-party HTTPS endpoint and keeps the Dreamlo private key out of the browser bundle.

The key in a read URL like `http://dreamlo.com/lb/69f664cb8f40bb1068bd441a/json` is the public key. It can fetch scores, but it cannot submit scores. `DREAMLO_PRIVATE_KEY` must be the separate Dreamlo private/write key, which was previously hardcoded in `src/App.jsx` as `DREAMLO_PRIVATE`.

## Deploy

1. Deploy the Worker:

   ```sh
   npm run leaderboard:deploy
   ```

2. Add the Dreamlo private key as a Worker secret:

   ```sh
   npx wrangler secret put DREAMLO_PRIVATE_KEY --config leaderboard-worker/wrangler.jsonc
   ```

   Paste only the private/write key when Wrangler prompts for the secret value. Do not use the public key from the `/json` URL here.

3. Point the site at the Worker.

   Because `orbitalsmash.com` is hosted on GitHub Pages and is not using Cloudflare DNS, the app defaults to the Worker's `workers.dev` URL:

   ```txt
   https://orbital-smash-leaderboard.nascarjake.workers.dev
   ```

   You can override that default by setting the GitHub Actions repository variable `VITE_LEADERBOARD_API_URL` to another Worker URL.
