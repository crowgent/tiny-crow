#!/bin/bash
set -eux

APP_DIR="${SRC_DIR}"
if [ ! -f "${APP_DIR}/src/main.ts" ]; then
    for d in "${SRC_DIR}"/*/; do
        if [ -f "${d}src/main.ts" ]; then
            APP_DIR="${d%/}"
            break
        fi
    done
fi
test -f "${APP_DIR}/src/main.ts"

mkdir -p "${PREFIX}/share/tiny-crow" "${PREFIX}/bin"
cp -r "${APP_DIR}/src" "${APP_DIR}/data" "${APP_DIR}/package.json" "${APP_DIR}/package-lock.json" "${APP_DIR}/README.md" "${APP_DIR}/LICENSE" "${PREFIX}/share/tiny-crow/"
if [ -d "${APP_DIR}/node_modules" ]; then
    cp -r "${APP_DIR}/node_modules" "${PREFIX}/share/tiny-crow/"
fi
cat > "${PREFIX}/bin/tiny-crow" <<'EOF'
#!/bin/sh
exec node "$(dirname "$0")/../share/tiny-crow/src/main.ts" "$@"
EOF
chmod +x "${PREFIX}/bin/tiny-crow"
