#!/usr/bin/env bash
set -euo pipefail

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
: "${REMOTE_PATH:?REMOTE_PATH is required}"
: "${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY is required}"

APP_NAME="${APP_NAME:-${1:-bounty-progress}}"
REMOTE_SUBDIR="${REMOTE_SUBDIR:-ingress-${APP_NAME}}"
APP_DIR="$APP_NAME"

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: $APP_DIR" >&2
  exit 1
fi

mkdir -p ~/.ssh
echo "$SSH_PRIVATE_KEY" > ~/.ssh/deploy_key
chmod 600 ~/.ssh/deploy_key
ssh-keyscan -p "${SSH_PORT:-22}" -H "$SSH_HOST" >> ~/.ssh/known_hosts

SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i ~/.ssh/deploy_key -p ${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_PATH%/}/${REMOTE_SUBDIR}"
VERSION=$(git rev-parse --short HEAD)
STAGE=$(mktemp -d)

cp -R "$APP_DIR"/. "$STAGE/"

find "$STAGE" -type d -exec chmod 755 {} \;
find "$STAGE" -type f -exec chmod 644 {} \;

$SSH "$SSH_USER@$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
tar -czf - -C "$STAGE" . \
  | $SSH "$SSH_USER@$SSH_HOST" "tar -xzf - -C '$REMOTE_DIR'"

rm -rf "$STAGE"
echo "Deployed $APP_NAME ($VERSION) to $SSH_HOST:$REMOTE_DIR"
