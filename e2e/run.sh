#!/bin/zsh
# Fresh test database, production web build, a runner on real gVisor, then every check.
# Needs Docker, built sandbox images, and Playwright's Chromium. Run: pnpm test:e2e
set -u
ROOT=${0:a:h:h}; LOGS=${TMPDIR:-/tmp}/gretlab-e2e; mkdir -p $LOGS
RIG=gretlab-gvisor-rig
export DATABASE_URL=postgres://gretlab:gretlab_dev_only@127.0.0.1:5433/gretlab_test

docker build -q -t $RIG $ROOT/docker/gvisor-rig >/dev/null
docker rm -f -v $RIG >/dev/null 2>&1
docker run -d --name $RIG --privileged -p 127.0.0.1:23750:2375 -e DOCKER_TLS_CERTDIR= $RIG --tls=false >/dev/null
for i in {1..45}; do docker exec $RIG docker version --format ok >/dev/null 2>&1 && break; sleep 1; done
docker save gretlab/sandbox-python:1 gretlab/sandbox-node:1 gretlab/sandbox-cpp:1 gretlab/sandbox-java:1 | docker exec -i $RIG docker load >/dev/null

docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -c "drop database if exists gretlab_test with (force)" -c "create database gretlab_test" >/dev/null
(cd $ROOT/packages/db && pnpm exec tsx src/migrate.ts && pnpm exec tsx src/seed.ts)

pnpm --dir $ROOT --filter runner test:queue || exit 1

cd $ROOT/apps/web && pnpm exec next build >/dev/null || exit 1
NEXTAUTH_URL=http://localhost:3100 NEXTAUTH_SECRET=e2e-only-secret GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake ADMIN_EMAILS=admin@example.com PROXY_SECRET=e2e-proxy-secret-0123456789 GITHUB_LOOKUP=off LTI_ALLOW_HTTP=true RESEND_API_KEY=e2e RESEND_API_URL=http://127.0.0.1:3198 MAIL_FROM='Gretlab <no-reply@example.com>' CRON_SECRET=e2e-cron-secret-0123456789 pnpm exec next start -p 3100 > $LOGS/web.log 2>&1 &
for i in {1..20}; do curl -s -o /dev/null localhost:3100/privacy && break; sleep 1; done
cd $ROOT/apps/runner
DOCKER_HOST=tcp://127.0.0.1:23750 SANDBOX_RUNTIME=runsc NODE_ENV=production $ROOT/apps/runner/node_modules/.bin/tsx src/main.ts > $LOGS/runner.log 2>&1 &
RUNNER=$!
sleep 3

cd $ROOT
DOCKER_HOST=tcp://127.0.0.1:23750 SANDBOX_RUNTIME=runsc pnpm --filter runner test:sandbox; CODE=$?
node e2e/full.mjs all; [ $? -eq 0 ] || CODE=1
node e2e/flows.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/features.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/assignments.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/orgs.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/platform.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/library.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/courses.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/templates.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/warnings.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/discussions.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/peer.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/calendar.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/certificates.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/projects.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/lti.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/notifications.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/permissions.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/org-types.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1
node e2e/attendance.mjs http://localhost:3100; [ $? -eq 0 ] || CODE=1

kill $RUNNER 2>/dev/null
lsof -ti:3100 | xargs kill 2>/dev/null
wait $RUNNER 2>/dev/null
docker rm -f -v $RIG >/dev/null
docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -c "drop database if exists gretlab_test with (force)" >/dev/null
exit $CODE
