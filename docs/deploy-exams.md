# Lab exams on your deployment

## Limiting an exam to the lab's network

The app can only trust a visitor's address if something it trusts vouches for it (the rule and its tests: `packages/judge/src/client-ip.ts`).

### On Vercel: nothing to set up

Every request reaches a Vercel deployment through Vercel's edge, which overwrites the forwarded-for headers with the address it saw and doesn't pass on addresses a visitor sends. The app sees `VERCEL=1` (Vercel sets it) and reads `x-vercel-forwarded-for`, which no proxy in front of Vercel can replace. `PROXY_SECRET` isn't needed there and is ignored. `VERCEL=1` comes with Vercel's system environment variables (Settings › Environment Variables › "Automatically expose System Environment Variables", on by default); with it off, the app can't tell it's on Vercel and refuses network-limited exams rather than guess.

Don't put another proxy or CDN in front of a Vercel deployment for exams: every student would then appear to come from that proxy.

### On any other host: name the header it sets

Netlify, Cloudflare, Fly.io, Render, Railway and most other hosts put the visitor's address in a header of their own. Set `CLIENT_IP_HEADER` to that header's name and the app believes it. It takes priority over the other two ways.

| Host | `CLIENT_IP_HEADER` |
| --- | --- |
| Cloudflare (proxied DNS, or Workers and Pages) | `cf-connecting-ip` |
| Netlify | `x-nf-client-connection-ip` |
| Fly.io | `fly-client-ip` |
| A host that only appends to `X-Forwarded-For` | `x-forwarded-for` (the app takes the last entry, the one the host's edge added; earlier ones are whatever the visitor sent) |

Check your host's documentation, because you are vouching for two things:

1. The host sets this header on every request and **replaces** any value the visitor sent.
2. Visitors **can't reach the app around the host.** If the app is also reachable directly (a raw server address, another domain, a `*.vercel.app` address behind Cloudflare), a visitor can send the header themselves and appear to be in the lab.

Then check it: open any assignment's settings and turn on **Lab exam**. Under the networks box, "Your address right now" shows the address the server sees for you. It should match what a "what is my IP" search shows. If it shows an address of the host's own network instead, the header is the wrong one.

### Behind Caddy (docker-compose.prod.yml)

Caddy (`deploy/Caddyfile`) sets `X-Client-IP` to the address it saw and `X-Proxy-Secret` to a secret shared with the app, replacing anything the visitor sent. The app believes the address only when the secret matches (`apps/web/lib/api/client-ip.ts`), so reaching the app directly and sending your own headers doesn't work.

1. Make a secret: `openssl rand -hex 24`.
2. Set `PROXY_SECRET` to it in the environment of both `caddy` and `web` (`docker-compose.prod.yml` passes it to both from `.env`).
3. If a load balancer or CDN (Cloudflare, an AWS ALB) sits in front of Caddy, list its addresses under `trusted_proxies` in the Caddyfile's global block. Otherwise every student appears to come from the balancer.

With none of the three (`CLIENT_IP_HEADER`, Vercel, `PROXY_SECRET`), exams still work, but saving one with networks is refused with "This server can't confirm where students connect from".

Networks are IPv4 or IPv6 addresses or ranges (`10.20.0.0/16`, `2001:db8:42::/48`). A lab behind one NAT address is a single entry. For a dual-stack lab, list both its IPv4 range and its IPv6 prefix.

## When the runner fails

A submission the runner can't judge (a crashed sandbox, a runner restarting) is retried; if it still fails it's marked "System error". Runners then re-judge system errors by themselves a few minutes later (up to three rounds, for a week), and the result counts from when the student pressed Submit, so exam work isn't lost. After a longer outage, the gradebook's **Re-judge system errors** queues every one for that assignment again. **Give more time** remains for a student who lost time to the outage itself.
