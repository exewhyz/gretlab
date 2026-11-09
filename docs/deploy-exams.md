# Lab exams on your deployment

## Limiting an exam to the lab's network

The app can only trust a visitor's address if something it trusts vouches for it. In production that's Caddy (`deploy/Caddyfile`): it sets `X-Client-IP` to the address it saw and `X-Proxy-Secret` to a secret shared with the app, replacing anything the visitor sent. The app believes the address only when the secret matches (`apps/web/lib/api/client-ip.ts`), so reaching the app directly and sending your own headers doesn't work.

1. Make a secret: `openssl rand -hex 24`.
2. Set `PROXY_SECRET` to it in the environment of both `caddy` and `web` (`docker-compose.prod.yml` passes it to both from `.env`).
3. If a load balancer or CDN (Cloudflare, an AWS ALB) sits in front of Caddy, list its addresses under `trusted_proxies` in the Caddyfile's global block. Otherwise every student appears to come from the balancer.

Without `PROXY_SECRET`, exams still work, but saving one with networks is refused with "This server can't confirm where students connect from".

Networks are IPv4 or IPv6 addresses or ranges (`10.20.0.0/16`, `2001:db8:42::/48`). A lab behind one NAT address is a single entry. For a dual-stack lab, list both its IPv4 range and its IPv6 prefix.

## When the runner fails

A submission the runner can't judge (a crashed sandbox, a runner restarting) is retried; if it still fails it's marked "System error". Runners then re-judge system errors by themselves a few minutes later (up to three rounds, for a week), and the result counts from when the student pressed Submit, so exam work isn't lost. After a longer outage, the gradebook's **Re-judge system errors** queues every one for that assignment again. **Give more time** remains for a student who lost time to the outage itself.
