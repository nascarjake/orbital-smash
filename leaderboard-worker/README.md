# Orbital Smash Leaderboard Proxy

GitHub Pages serves the game over HTTPS, but this Dreamlo leaderboard only exposes working JSON over HTTP. Browsers block that as mixed content, and public CORS proxy services can fail or block requests without warning. This Worker gives the game a first-party HTTPS endpoint and keeps the Dreamlo private key out of the browser bundle.

## Deploy

1. Deploy the Worker:

   ```sh
   npm run leaderboard:deploy
   ```

2. Add the Dreamlo private key as a Worker secret:

   ```sh
   npx wrangler secret put DREAMLO_PRIVATE_KEY --config leaderboard-worker/wrangler.jsonc
   ```

3. Point the site at the Worker.

   For a same-origin Cloudflare route, route the Worker to:

   ```txt
   orbitalsmash.com/api/leaderboard*
   ```

   For a `workers.dev` URL, set the GitHub Actions repository variable `VITE_LEADERBOARD_API_URL` to the Worker URL, for example:

   ```txt
   https://orbital-smash-leaderboard.<your-subdomain>.workers.dev
   ```

The app defaults to `/api/leaderboard`, which is ideal when the domain is behind Cloudflare and the Worker is mounted at that route.
