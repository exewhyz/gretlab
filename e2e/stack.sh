#!/bin/zsh
# Each rig stores images in its own volume, so always remove rigs with -v, or disk fills fast.
# Brings up the production shape locally, for load testing: load balancer, web replicas,
# PgBouncer, and runners on real gVisor inside their own Docker daemons, the way separate
# machines would be. On one laptop they share its CPU, so treat results as a lower bound.
#   e2e/stack.sh up [runners=1] [slots=8] [web=3]  |  e2e/stack.sh runners N [slots]  |  e2e/stack.sh down
ROOT=${0:a:h:h}
export SITE_ADDRESS=:8080 HTTP_PORT=8080 DB_HOST=postgres DB_PASSWORD=gretlab_dev_only DB_NAME=gretlab_test
export NEXTAUTH_URL=http://localhost:8080 NEXTAUTH_SECRET=e2e-only-secret METRICS_TOKEN=e2e-metrics
COMPOSE=(docker compose -f $ROOT/docker-compose.yml -f $ROOT/docker-compose.prod.yml)
DB_URL=postgres://gretlab:gretlab_dev_only@postgres:5432/gretlab_test

start_runner() { # n slots
  local name=gretlab-rig-$1
  docker rm -f -v $name >/dev/null 2>&1
  docker run -d --name $name --hostname runner-$1 --privileged --network gretlab_default -e DOCKER_TLS_CERTDIR= gretlab-gvisor-rig --tls=false >/dev/null
  for i in {1..45}; do docker exec $name docker version --format ok >/dev/null 2>&1 && break; sleep 1; done
  docker save gretlab/sandbox-python:1 gretlab/runner:local | docker exec -i $name docker load >/dev/null
  docker exec $name docker run -d --name runner --hostname runner-$1 --restart no --network host --stop-timeout 300 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e DATABASE_URL=$DB_URL -e SANDBOX_RUNTIME=runsc -e RUNNER_CONCURRENCY=$2 -e DATABASE_POOL=4 -e RUNNER_LEASE_MS=${LEASE_MS:-30000} \
    gretlab/runner:local >/dev/null
}

case $1 in
  up)
    docker build -q -t gretlab-gvisor-rig $ROOT/docker/gvisor-rig >/dev/null
    docker compose -f $ROOT/docker-compose.yml up -d --wait postgres >/dev/null 2>&1
    docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -qc "drop database if exists gretlab_test with (force)" -c "create database gretlab_test" >/dev/null
    DATABASE_URL=postgres://gretlab:gretlab_dev_only@127.0.0.1:5433/gretlab_test zsh -c "cd $ROOT/packages/db && pnpm exec tsx src/migrate.ts && pnpm exec tsx src/seed.ts" | tail -1
    WEB_REPLICAS=${4:-3} $COMPOSE up -d --no-build pgbouncer web caddy 2>&1 | tail -1
    for i in {1..40}; do curl -sf -o /dev/null localhost:8080/api/health && break; sleep 1; done
    for n in {1..${2:-1}}; do start_runner $n ${3:-8}; done
    sleep 4
    curl -s -H "Authorization: Bearer e2e-metrics" localhost:8080/api/metrics | grep -E '^gretlab_(runners_online|runner_slots) '
    ;;
  runners)
    for n in {1..$2}; do docker inspect gretlab-rig-$n >/dev/null 2>&1 || start_runner $n ${3:-8}; done
    ;;
  down)
    for r in $(docker ps -aq --filter name=gretlab-rig-); do docker rm -f -v $r >/dev/null; done
    $COMPOSE rm -sf pgbouncer web caddy >/dev/null 2>&1
    docker compose -f $ROOT/docker-compose.yml exec -T postgres psql -U gretlab -d gretlab -qc "drop database if exists gretlab_test with (force)" >/dev/null
    ;;
esac
