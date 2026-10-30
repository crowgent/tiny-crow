#!/bin/bash
set -eux

# This recipe installs the application tree as supplied, without a
# build step. Accept either the tree itself or a single top-level
# directory holding it (the usual release-archive layout).
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

mkdir -p "${PREFIX}/share/zerostack-ts" "${PREFIX}/bin"
cp -r "${APP_DIR}/src" "${APP_DIR}/data" "${APP_DIR}/package.json" "${APP_DIR}/package-lock.json" "${APP_DIR}/README.md" "${APP_DIR}/LICENSE" "${PREFIX}/share/zerostack-ts/"
if [ -d "${APP_DIR}/node_modules" ]; then
    cp -r "${APP_DIR}/node_modules" "${PREFIX}/share/zerostack-ts/"
fi
cat > "${PREFIX}/bin/zerostack-ts" <<'EOF'
#!/bin/sh
exec node "$(dirname "$0")/../share/zerostack-ts/src/main.ts" "$@"
EOF
chmod +x "${PREFIX}/bin/zerostack-ts"
