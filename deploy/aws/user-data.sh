#!/usr/bin/env bash
# GretLab judge machine: fetch and run the reviewed boot script (deploy/judge-machine-boot.sh).
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/exewhyz/gretlab/main/deploy/judge-machine-boot.sh -o /root/judge-machine-boot.sh
bash /root/judge-machine-boot.sh
