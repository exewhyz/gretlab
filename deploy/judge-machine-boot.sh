#!/usr/bin/env bash
# First boot of a judge machine started from the dashboard (Dashboard › Judges). The launch
# template `gretlab-judge` runs this as the machine's user data, once, as root.
#
# It reads who it is from its own tags (instance metadata), the database address from SSM
# Parameter Store (/gretlab/judge/database-url, readable only by the machine's role), records
# each stage in judge_machines so the dashboard can show it, and then sets the machine up exactly
# as deploy/runner-setup.sh sets up any judge. Nothing secret is in the template or this script.
set -euo pipefail
exec > >(tee -a /var/log/gretlab-judge-boot.log) 2>&1

REGION=ap-southeast-2
TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 3600")
meta() { curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
MACHINE=$(meta instance-id)
# The organization whose own judge this is (its address), or empty for a shared judge.
POOL=$(meta tags/instance/gretlab-pool 2>/dev/null || true)
case "$POOL" in *[!a-z0-9-]*) echo "bad pool tag" >&2; exit 1 ;; esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql-client >/dev/null
snap install aws-cli --classic >/dev/null
DATABASE_URL=$(aws ssm get-parameter --region "$REGION" --name /gretlab/judge/database-url \
  --with-decryption --query Parameter.Value --output text)

# Each stage goes to the database (the dashboard reads it); the address stays in this process.
stage() {
  PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -v machine="$MACHINE" -v stage="$1" -v note="${2:-}" <<'SQL' || true
update judge_machines set stage = :'stage', note = :'note', stage_at = now()
where instance_id = :'machine';
SQL
}
# On failure, the dashboard gets the line and the end of this log, with any database address
# (or anything else that looks like a connection string or password) taken out.
failed() {
  local tail
  tail=$(tail -n 25 /var/log/gretlab-judge-boot.log 2>/dev/null \
    | sed -E 's#[a-z]+://[^[:space:]]+#<address removed>#g; s#(password|secret|token)[=:][^[:space:]]+#\1=<removed>#gI' \
    | tail -c 1500)
  stage failed "Setting up stopped at line $1.
$tail"
}
trap 'failed $LINENO' ERR

stage installing
curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/runner-setup.sh -o /tmp/runner-setup.sh
DATABASE_URL="$DATABASE_URL" RUNNER_POOL="$POOL" RUNNER_MACHINE="$MACHINE" SEED=0 \
  bash /tmp/runner-setup.sh
stage ready
