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

cd "${APP_DIR}"
npm install
npm run typecheck

mkdir -p "${PREFIX}/share/tiny-crow" "${PREFIX}/bin"
cp -r src data package.json package-lock.json node_modules README.md LICENSE "${PREFIX}/share/tiny-crow/"
cat > "${PREFIX}/bin/tiny-crow" <<'EOF'
#!/bin/sh
exec node "$(dirname "$0")/../share/tiny-crow/src/main.ts" "$@"
EOF
chmod +x "${PREFIX}/bin/tiny-crow"
