#!/usr/bin/env bash
# Turns a fresh Ubuntu 22.04 or 24.04 server into a Gretlab code judge (a runner):
# Docker, gVisor, the sandbox images and the runner, then proves sandboxes run under gVisor
# with the 16 hostile-program tests. Safe to run again (it updates and restarts).
#
#   sudo DATABASE_URL='postgres://user:password@host:port/db' bash runner-setup.sh
# To update later (reuses the saved address; run a fresh download, not the copy in /opt/gretlab,
# which this script replaces as it runs, and not through a pipe, which docker would read):
#   curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh
#   sudo bash /tmp/runner-setup.sh
#
# DATABASE_URL is the DIRECT Postgres address (not a pooler): the runner keeps a LISTEN
# session open. Optional: RUNNER_CONCURRENCY (default: one per core, at most 8), REPO, BRANCH,
# DIR, SEED=0 to skip loading the starter problems.
#
# Give this machine nothing else to do. A runner controls Docker, which is root on the
# host, so it must hold no secrets beyond its database address (AGENTS.md, Sandbox rules).
set -euo pipefail

REPO="${REPO:-https://github.com/exewhyz/gretlab.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/gretlab}"
# On an update, reuse the address saved by the first run.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$DIR/.env" ]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$DIR/.env" | head -1)"
fi
: "${DATABASE_URL:?Set DATABASE_URL to the direct Postgres address, e.g. sudo DATABASE_URL='postgres://...' bash runner-setup.sh}"
SEED="${SEED:-1}"
CORES="$(nproc)"
RUNNER_CONCURRENCY="${RUNNER_CONCURRENCY:-$(( CORES < 8 ? CORES : 8 ))}"
COMPOSE=(docker compose -f docker-compose.runner.yml)

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "run it as root: sudo DATABASE_URL='...' bash $0"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu; this is ${PRETTY_NAME:-unknown}."
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) fail "DATABASE_URL must start with postgres:// or postgresql://" ;;
esac

step "Basics"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw >/dev/null

step "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

step "gVisor (runsc)"
if ! command -v runsc >/dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update -qq
  apt-get install -y -qq runsc >/dev/null
fi
# Registers runsc as a Docker runtime (in /etc/docker/daemon.json).
runsc install >/dev/null
systemctl restart docker
docker info --format '{{json .Runtimes}}' | grep -q '"runsc"' || fail "Docker doesn't list the runsc runtime"

step "Checking that a container really runs under gVisor"
if docker run --rm --runtime=runsc --network none busybox:1.36 dmesg 2>/dev/null | grep -qi gvisor; then
  echo "ok: the sandbox kernel is gVisor"
else
  fail "a runsc container didn't report the gVisor kernel"
fi

step "Firewall: SSH in, nothing else; everything out (the database)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

step "Code ($REPO, $BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

step "Sandbox images: Python, JavaScript, C and C++, Java (a few minutes the first time)"
docker/sandbox/build.sh

step "The runner's settings (readable by root only)"
umask 077
cat > .env <<EOF
DATABASE_URL=${DATABASE_URL}
RUNNER_CONCURRENCY=${RUNNER_CONCURRENCY}
EOF
echo "ok: $RUNNER_CONCURRENCY parallel jobs on $CORES cores"

step "Building the runner"
"${COMPOSE[@]}" build --quiet runner

step "Database tables (safe to repeat)"
"${COMPOSE[@]}" run --rm --no-deps -w /repo/packages/db runner pnpm exec tsx src/migrate.ts
if [ "$SEED" = 1 ]; then
  "${COMPOSE[@]}" run --rm --no-deps -w /repo/packages/db runner pnpm exec tsx src/seed.ts
fi

step "Attack tests: 16 hostile programs against the real sandbox"
"${COMPOSE[@]}" run --rm --no-deps runner node_modules/.bin/tsx --test --test-reporter=spec src/sandbox/attack.test.ts \
  || fail "the sandbox attack tests failed; the runner was not started"

step "Starting the runner"
"${COMPOSE[@]}" up -d runner
sleep 5
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail 20 runner

cat <<EOF

Done. This server now judges submissions from the queue in your database.
  Logs:     cd $DIR && docker compose -f docker-compose.runner.yml logs -f runner
  Update:   curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh
            sudo bash /tmp/runner-setup.sh   (pulls $BRANCH, migrates, retests, restarts)
  More capacity: run it on another server with the same DATABASE_URL.
EOF
