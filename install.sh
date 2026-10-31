#!/usr/bin/env bash
set -euo pipefail

MIN_NODE_MAJOR=24

fail() {
    echo "Error: $*" >&2
    exit 1
}

node_is_supported() {
    local command_name="${1:-node}"
    local version major

    command -v "${command_name}" >/dev/null 2>&1 || return 1
    version="$("${command_name}" --version 2>/dev/null || true)"
    version="${version#v}"
    major="${version%%.*}"
    [[ "${major}" =~ ^[0-9]+$ ]] || return 1
    (( major >= MIN_NODE_MAJOR ))
}

run_privileged() {
    if (( EUID == 0 )); then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        fail "administrator privileges are required to install system packages; run as root or install Node.js >= ${MIN_NODE_MAJOR} manually."
    fi
}

require_debian_apt() {
    if [[ ! -r /etc/os-release || ! -r /etc/debian_version ]] || ! command -v apt-get >/dev/null 2>&1; then
        fail "automatic Node.js installation is supported on Debian/Ubuntu systems with apt-get. Install Node.js >= ${MIN_NODE_MAJOR} manually, then re-run this installer."
    fi

    . /etc/os-release
    case " ${ID:-} ${ID_LIKE:-} " in
        *" debian "*|*" ubuntu "*) ;;
        *) fail "automatic Node.js installation is only enabled for Debian/Ubuntu. Install Node.js >= ${MIN_NODE_MAJOR} manually, then re-run this installer." ;;
    esac

    if (( EUID != 0 )) && ! command -v sudo >/dev/null 2>&1; then
        fail "sudo is required to install Node.js automatically. Re-run as root, install Node.js >= ${MIN_NODE_MAJOR} manually, or install sudo first."
    fi
}

install_apt_prerequisites() {
    run_privileged apt-get update
    run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y \
        apt-transport-https ca-certificates curl gnupg gzip tar
}

install_node_24_from_nodesource() {
    local arch keyring repo_file

    require_debian_apt
    arch="$(dpkg --print-architecture)"
    case "${arch}" in
        amd64|arm64) ;;
        *) fail "NodeSource Node.js 24 packages are not configured here for architecture '${arch}'. Install Node.js >= ${MIN_NODE_MAJOR} manually, then re-run this installer." ;;
    esac

    echo "Node.js >= ${MIN_NODE_MAJOR} was not found. Installing it from the signed NodeSource APT repository..."
    install_apt_prerequisites

    keyring="/usr/share/keyrings/nodesource.gpg"
    repo_file="/etc/apt/sources.list.d/nodesource.sources"
    run_privileged install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | run_privileged gpg --dearmor --batch --yes -o "${keyring}"
    run_privileged chmod 0644 "${keyring}"

    run_privileged rm -f \
        /etc/apt/sources.list.d/nodesource.list \
        /etc/apt/sources.list.d/nodesource.sources
    run_privileged tee "${repo_file}" >/dev/null <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_24.x
Suites: nodistro
Components: main
Architectures: ${arch}
Signed-By: ${keyring}
EOF
    run_privileged tee /etc/apt/preferences.d/nodejs >/dev/null <<'EOF'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF

    run_privileged apt-get update
    if ! run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs; then
        fail "Node.js installation failed. Check your APT sources and network, then re-run this installer."
    fi
    hash -r

    if ! node_is_supported node && node_is_supported /usr/bin/node; then
        PATH="/usr/bin:${PATH}"
        export PATH
        hash -r
    fi
    node_is_supported node || fail "Node.js installation completed, but Node >= ${MIN_NODE_MAJOR} is still not the active version. Check your PATH and re-run this installer."
    TINY_CROW_NODE_BIN="$(command -v node)"
    export TINY_CROW_NODE_BIN
}

ensure_runtime_dependencies() {
    local missing_tools=0 tool

    for tool in curl tar gzip; do
        if ! command -v "${tool}" >/dev/null 2>&1; then
            missing_tools=1
        fi
    done

    if ! node_is_supported node; then
        require_debian_apt
        install_node_24_from_nodesource
    elif (( missing_tools )); then
        require_debian_apt
        install_apt_prerequisites
    fi

    for tool in curl tar gzip; do
        command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is required but could not be installed automatically."
    done

    if ! node_is_supported node; then
        local version
        version="$(node --version 2>/dev/null || echo 'not found')"
        fail "Node >= ${MIN_NODE_MAJOR} is required, found ${version}. Install a supported Node.js release, then re-run this installer."
    fi
}

show_crow_animation() {
    if [[ ! -t 1 || "${TERM:-dumb}" == "dumb" ]]; then
        printf 'CROW | Tiny Crow installer\n'
        return
    fi

    local step filled width=36 index row
    printf '\n'
    while IFS= read -r row; do
        printf '  \033[38;2;120;190;255m%s\033[0m\n' "$row"
    done <<'CROW_BIRD'
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⡟⠋⢻⣷⣄⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⣾⣿⣷⣿⣿⣿⣿⣿⣶⣾⣿⣿⠿⠿⠿⠶⠄⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠉⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⠟⠻⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⣿⣿⣆⣤⠿⢶⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢰⣿⣿⣿⣿⣿⣿⣿⣿⡀⠀⠀⠀⠑⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠸⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠙⠛⠋⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
CROW_BIRD

    local -a crow_lines=(
        '  ██████  ██████  ██████  ███   █'
        '█ ███▄ ██ ███▄ █████▄████████████'
        '█ ████▄██ ███████████████████████'
        '█ ████▀██ ███████████████████████'
        '█ ███████ ███ ███ ███████  ██████'
        '█▄▄▄▄▄▄██▄▄▄█▄▄██▄▄▄▄▄▄███▄▄▄▄▄▄█'
        '█████████████████████████████████'
    )
    local crow_colors=(97 96 96 96 93 95 95)
    for index in "${!crow_lines[@]}"; do
        printf '  \033[1;%sm%s\033[0m\n' "${crow_colors[index]}" "${crow_lines[index]}"
    done
    printf '  Tiny Crow setup\n\n\033[?25l'

    for ((step = 1; step <= 100; step++)); do
        filled=$((step * width / 100))
        printf '\r  \033[1;36m['
        for ((index = 0; index < filled; index++)); do printf '#'; done
        for ((index = filled; index < width; index++)); do printf ' '; done
        printf ']\033[0m %3d%%' "$step"
        sleep 0.012
    done

    printf '\n\033[?25h\n'
}

show_crow_animation
ensure_runtime_dependencies

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "${SCRIPT_PATH}" ] && [ -f "${SCRIPT_PATH}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
    if [ -f "${SCRIPT_DIR}/scripts/install.ts" ]; then
        exec node "${SCRIPT_DIR}/scripts/install.ts" "$@"
    fi
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
    fail "no tiny-crow checkout found in the downloaded archive."
fi

mkdir -p "$(dirname "${INSTALL_ROOT}")"
rm -rf "${INSTALL_ROOT}"
mv "${CHECKOUT}" "${INSTALL_ROOT}"
rm -rf "${TMP_DIR}"
trap - EXIT

exec node "${INSTALL_ROOT}/scripts/install.ts" "$@"
