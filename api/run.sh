#!/usr/bin/env bash
# Loads secrets from infra/.env and starts the API server.
# Usage: ./run.sh

set -e

ENV_FILE="$(dirname "$0")/../infra/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Create it with your secrets first."
  exit 1
fi

echo "Loading secrets from $ENV_FILE"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

exec go run .
