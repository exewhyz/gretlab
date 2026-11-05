#!/bin/sh
# Builds every sandbox image, or just those named: docker/sandbox/build.sh python cpp
set -eu
cd "$(dirname "$0")"
[ "$#" -gt 0 ] || set -- python node cpp java
for language in "$@"; do
  docker build -t "gretlab/sandbox-$language:1" "$language"
done
