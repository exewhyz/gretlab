#!/usr/bin/env bash
# Compares two Postgres databases table by table (row counts, plus the applied migrations), to
# check a copy before switching to it: the rehearsal and the cutover in deploy/move-to-mumbai.md.
# It only reads.
#
#   OLD_URL='postgres://…' NEW_URL='postgres://…' bash deploy/compare-databases.sh
#
# Needs only Docker: psql comes from the postgres:18 image. The addresses are passed as
# environment variables, never on a command line, so they don't show in `ps` or shell history
# beyond the line you type. Exit status 0 when every table matches, 1 otherwise.
set -euo pipefail

: "${OLD_URL:?Set OLD_URL to the database you are copying from}"
: "${NEW_URL:?Set NEW_URL to the database you are copying to}"

docker run --rm -i -e OLD_URL -e NEW_URL postgres:18 bash -s <<'EOF'
set -euo pipefail
export LC_ALL=C

# One query per database: every table's row count, as "schema.table count", sorted bytewise.
COUNTS="
  select table_schema || '.' || table_name,
         (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from %I.%I', table_schema, table_name),
            false, true, '')))[1]::text
  from information_schema.tables
  where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE'
  order by (table_schema || '.' || table_name) collate \"C\""
ABOUT="select current_setting('server_version') || ', ' || pg_size_pretty(pg_database_size(current_database()))"

echo "Old: $(psql "$OLD_URL" -Atc "$ABOUT")"
echo "New: $(psql "$NEW_URL" -Atc "$ABOUT")"
echo

psql "$OLD_URL" -At -F ' ' -c "$COUNTS" > /tmp/old
psql "$NEW_URL" -At -F ' ' -c "$COUNTS" > /tmp/new

printf '%-46s %12s %12s\n' "table" "old" "new"
join -a 1 -a 2 -e missing -o 0,1.2,2.2 /tmp/old /tmp/new | awk '
  { mark = ($2 == $3) ? "" : "   <- differs"; if (mark != "") bad++
    printf "%-46s %12s %12s%s\n", $1, $2, $3, mark }
  END { print ""
        if (bad) { printf "%d table(s) differ.\n", bad; exit 1 }
        print "Every table matches." }'
EOF
