#!/usr/bin/env bash
set -euo pipefail

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${REMOTE_PATH:?REMOTE_PATH is required}"

SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_PATH%/}/ingress-bounty-progress"

mkdir -p .tmp-deploy/bounty-progress
cp -R bounty-progress/. .tmp-deploy/bounty-progress/

rsync -av --delete -e "ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no" .tmp-deploy/bounty-progress/ "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

rm -rf .tmp-deploy
