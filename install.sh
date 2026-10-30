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

# Checkout mode: this script lives inside a tiny-crow checkout, so the
# TypeScript installer sits right next to it.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "${SCRIPT_PATH}" ] && [ -f "${SCRIPT_PATH}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
    if [ -f "${SCRIPT_DIR}/scripts/install.ts" ]; then
        exec node "${SCRIPT_DIR}/scripts/install.ts" "$@"
    fi
fi

# Piped mode (curl ... | bash): there is no checkout next to this script,
# so fetch one to a persistent home first, then install from it. The
# sources stay there, because the installed launcher runs them directly.
if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl not found. Install curl, or clone the repo and run ./install.sh instead." >&2
    exit 1
fi

INSTALL_ROOT="${TINY_CROW_HOME:-${HOME}/.local/share/tiny-crow}"
TARBALL_URL="${TINY_CROW_TARBALL_URL:-https://codeload.github.com/crowgent/tiny-crow/tar.gz/refs/heads/main}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Downloading tiny-crow sources..."
curl -fsSL "${TARBALL_URL}" -o "${TMP_DIR}/tiny-crow.tar.gz"
mkdir -p "${TMP_DIR}/extracted"
tar xzf "${TMP_DIR}/tiny-crow.tar.gz" -C "${TMP_DIR}/extracted"

CHECKOUT=""
for candidate in "${TMP_DIR}/extracted"/*/; do
    if [ -f "${candidate}src/main.ts" ] && [ -f "${candidate}package.json" ]; then
        CHECKOUT="${candidate%/}"
        break
    fi
done
if [ -z "${CHECKOUT}" ]; then
    echo "Error: no tiny-crow checkout found in the downloaded archive." >&2
    exit 1
fi

mkdir -p "$(dirname "${INSTALL_ROOT}")"
rm -rf "${INSTALL_ROOT}"
mv "${CHECKOUT}" "${INSTALL_ROOT}"
rm -rf "${TMP_DIR}"
trap - EXIT

exec node "${INSTALL_ROOT}/scripts/install.ts" "$@"
