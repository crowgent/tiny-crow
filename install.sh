#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
    echo "Error: node not found. Install Node >= 24, then re-run this installer." >&2
    exit 1
fi

NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [ "${NODE_MAJOR}" -lt 24 ]; then
    echo "Error: Node >= 24 is required, found ${NODE_VERSION}." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/scripts/install.ts" "$@"
