#!/usr/bin/env bash
# Install tiny-crow (thin wrapper around scripts/install.ts).
#
# Usage:
#   bash install.sh [--dir <path>]
#   bash install.sh --tarball <path-or-url> [--sha256 <hex>] [--dir <path>]
#
# This wrapper only checks that Node >= 24 is available, then hands off to
# the real installer (scripts/install.ts) with all arguments unchanged.
# Run `node scripts/install.ts --help` for the full option list.
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
