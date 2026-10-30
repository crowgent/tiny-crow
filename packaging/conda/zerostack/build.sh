#!/bin/bash
set -eux

# Source tree layout: conda-build copies the recipe's source path into
# SRC_DIR. Accept either the tree itself or a single top-level directory
# holding it (the usual release-archive layout).
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

mkdir -p "${PREFIX}/share/zerostack-ts" "${PREFIX}/bin"
cp -r src data package.json package-lock.json node_modules README.md LICENSE "${PREFIX}/share/zerostack-ts/"
cat > "${PREFIX}/bin/zerostack-ts" <<'EOF'
#!/bin/sh
exec node "$(dirname "$0")/../share/zerostack-ts/src/main.ts" "$@"
EOF
chmod +x "${PREFIX}/bin/zerostack-ts"
