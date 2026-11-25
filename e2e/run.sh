#!/bin/zsh
# Fresh test database, production web build, a runner on real gVisor, then every check.
# Needs Docker, built sandbox images, and Playwright's Chromium. Run: pnpm test:e2e
# Only some suites, with the same setup (while fixing; the full run is for before merging):
#   E2E_ONLY=assignments,topics pnpm test:e2e     (add "sandbox" for the attack tests)
set -u
ROOT=${0:a:h:h}; LOGS=${TMPDIR:-/tmp}/gretlab-e2e; mkdir -p $LOGS
RIG=gretlab-gvisor-rig
S3=gretlab-e2e-s3
RUNNER=""
# Stop what this run started however it ends (finished, failed or interrupted), so no
# test judge or server is left to take the next run's jobs or hold port 3100.
cleanup() {
  [[ -n "$RUNNER" ]] && kill $RUNNER 2>/dev/null && wait $RUNNER 2>/dev/null
  lsof -ti:3100 | xargs kill 2>/dev/null
  docker rm -f -v $RIG >/dev/null 2>&1
  docker rm -f -v $S3 >/dev/null 2>&1
  docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -c "drop database if exists gretlab_test with (force)" >/dev/null 2>&1
}
trap cleanup EXIT
trap 'exit 130' INT TERM
export DATABASE_URL=postgres://gretlab:gretlab_dev_only@127.0.0.1:5433/gretlab_test

docker build -q -t $RIG $ROOT/docker/gvisor-rig >/dev/null
docker rm -f -v $RIG >/dev/null 2>&1
docker run -d --name $RIG --privileged -p 127.0.0.1:23750:2375 -e DOCKER_TLS_CERTDIR= $RIG --tls=false >/dev/null
for i in {1..45}; do docker exec $RIG docker version --format ok >/dev/null 2>&1 && break; sleep 1; done
docker save gretlab/sandbox-python:1 gretlab/sandbox-node:1 gretlab/sandbox-cpp:1 gretlab/sandbox-java:1 | docker exec -i $RIG docker load >/dev/null

# File storage: S3Mock stands in for Cloudflare R2 (both buckets; it doesn't check access, so
# R2's own refusals are checked on the real thing, README › File storage). No R2_PUBLIC_URL, as on
# the live site: images are reached through signed links.
docker rm -f -v $S3 >/dev/null 2>&1
docker run -d --name $S3 -p 127.0.0.1:9190:9090 -e initialBuckets=gretlab-public,gretlab-private adobe/s3mock:4.1.1 >/dev/null
for i in {1..60}; do curl -sf -o /dev/null http://127.0.0.1:9190/ && break; sleep 1; done
export STORAGE_ENDPOINT=http://127.0.0.1:9190 R2_ACCESS_KEY_ID=e2e R2_SECRET_ACCESS_KEY=e2e-secret R2_PUBLIC_BUCKET=gretlab-public R2_PRIVATE_BUCKET=gretlab-private

docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -c "drop database if exists gretlab_test with (force)" -c "create database gretlab_test" >/dev/null
(cd $ROOT/packages/db && pnpm exec tsx src/migrate.ts && pnpm exec tsx src/seed.ts)

pnpm --dir $ROOT --filter runner test:queue || exit 1
pnpm --dir $ROOT --filter @workspace/db test:lists || exit 1
pnpm --dir $ROOT --filter @workspace/db test:pipelining || exit 1

cd $ROOT/apps/web && pnpm exec next build >/dev/null || exit 1
NEXTAUTH_URL=http://localhost:3100 NEXTAUTH_SECRET=e2e-only-secret GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake ADMIN_EMAILS=admin@example.com PROXY_SECRET=e2e-proxy-secret-0123456789 GITHUB_LOOKUP=off LTI_ALLOW_HTTP=true RESEND_API_KEY=e2e RESEND_API_URL=http://127.0.0.1:3198 MAIL_FROM='Gretlab <no-reply@example.com>' CRON_SECRET=e2e-cron-secret-0123456789 WEBHOOKS_ALLOW_LOCAL=true JUDGES_PROVIDER=fake JUDGES_LATEST_VERSION=e2e-latest RAZORPAY_KEY_ID=rzp_test_e2e RAZORPAY_KEY_SECRET=e2e-razorpay-secret RAZORPAY_WEBHOOK_SECRET=e2e-razorpay-webhook RAZORPAY_API_URL=http://127.0.0.1:3197 pnpm exec next start -p 3100 > $LOGS/web.log 2>&1 &
for i in {1..20}; do curl -s -o /dev/null localhost:3100/privacy && break; sleep 1; done
cd $ROOT/apps/runner
# The judge logs in as its own limited role (migration 0081), as on production, so every suite
# proves judging needs nothing more.
DATABASE_URL="$DATABASE_URL?options=-c%20role%3Dgretlab_judge" DOCKER_HOST=tcp://127.0.0.1:23750 SANDBOX_RUNTIME=runsc NODE_ENV=production $ROOT/apps/runner/node_modules/.bin/tsx src/main.ts > $LOGS/runner.log 2>&1 &
RUNNER=$!
sleep 3

cd $ROOT
CODE=0
# One suite by name, unless E2E_ONLY names others.
suite() {
  local name=$1; shift
  [[ -n "${E2E_ONLY:-}" && ",${E2E_ONLY:-}," != *",$name,"* ]] && return
  node e2e/$name.mjs "$@"; [ $? -eq 0 ] || CODE=1
}
if [[ -z "${E2E_ONLY:-}" || ",${E2E_ONLY:-}," == *",sandbox,"* ]]; then
  DOCKER_HOST=tcp://127.0.0.1:23750 SANDBOX_RUNTIME=runsc pnpm --filter runner test:sandbox || CODE=1
fi
suite full all
suite flows http://localhost:3100
suite features http://localhost:3100
suite topics http://localhost:3100
suite landing http://localhost:3100
suite assignments http://localhost:3100
suite assignment-topics http://localhost:3100
suite org-study-plans http://localhost:3100
suite orgs http://localhost:3100
suite platform http://localhost:3100
suite library http://localhost:3100
suite courses http://localhost:3100
suite course-checkpoints http://localhost:3100
suite templates http://localhost:3100
suite warnings http://localhost:3100
suite discussions http://localhost:3100
suite peer http://localhost:3100
suite calendar http://localhost:3100
suite certificates http://localhost:3100
suite projects http://localhost:3100
suite lti http://localhost:3100
suite notifications http://localhost:3100
suite permissions http://localhost:3100
suite org-types http://localhost:3100
suite attendance http://localhost:3100
suite subjects http://localhost:3100
suite timetable http://localhost:3100
suite parents http://localhost:3100
suite books http://localhost:3100
suite transport http://localhost:3100
suite hostel http://localhost:3100
suite audit http://localhost:3100
suite two-factor http://localhost:3100
suite step-up http://localhost:3100
suite home http://localhost:3100
suite records http://localhost:3100
suite promotion http://localhost:3100
suite exams http://localhost:3100
suite leave http://localhost:3100
suite staff-attendance http://localhost:3100
suite admissions http://localhost:3100
suite signup http://localhost:3100
suite pdfs http://localhost:3100
suite member-home http://localhost:3100
suite trips http://localhost:3100
suite large-org http://localhost:3100
suite judges http://localhost:3100
suite monitoring http://localhost:3100
suite jobs http://localhost:3100
suite storage http://localhost:3100
suite billing http://localhost:3100
suite rate-limits http://localhost:3100
suite csp http://localhost:3100
suite links http://localhost:3100
suite org-kinds http://localhost:3100
suite college http://localhost:3100
suite cohort http://localhost:3100
suite training http://localhost:3100
suite community http://localhost:3100
suite password-auth http://localhost:3100
suite emails http://localhost:3100
suite roles http://localhost:3100
suite teach-mode http://localhost:3100
suite platform-reach http://localhost:3100
suite access-links http://localhost:3100
suite data-screens http://localhost:3100
suite integrations http://localhost:3100
suite execution-profiles http://localhost:3100 /tmp/gretlab-e2e/execution-profiles/

exit $CODE
