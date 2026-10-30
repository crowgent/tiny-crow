# Justfile for the zerostack-ts port (Node 24, no build step).
# https://github.com/casey/just
#
# Every recipe below runs node, npm, git, or plain shell only. This port
# ships as TypeScript sources run directly under Node type stripping, so
# there is no compile step and no platform binary packaging: `build`
# verifies the tree with the typechecker, and `install` writes a launcher
# that runs src/main.ts. The original platform packaging recipes (archive
# checksums, installer metadata) have no counterpart here because there
# are no platform archives or packaging manifests in this port, and are
# intentionally absent rather than faked.
#
# Recipes kept from the original, adapted: default, build, build-all, run,
# fmt, check, test, install-hook, remove-hook, add-tag, remove-tag,
# sync-version, release, pre-release, post-release. Plus the script
# recipes gen-models-catalog, setup-neovim, and install.

[private]
default:
    @just --list

# ---- Run ----

# Typecheck the tree (this port has no emit/build step).
build:
    npm run typecheck

# Same as build: this port has no feature flags to vary.
build-all: build

run *args:
    node src/main.ts {{ args }}

# ---- Quality ----

# No formatter dependency is installed in this port, so fmt verifies
# syntax and types instead of reformatting files.
fmt:
    npm run typecheck

check:
    npm run typecheck

test:
    npm test

# ---- Scripts ----

# Regenerate data/models.json + data/opencode-transports.json.
gen-models-catalog:
    node scripts/gen-models-catalog.ts

# Configure Neovim with CodeCompanion.nvim + zerostack-ts ACP.
setup-neovim:
    node scripts/setup-neovim.ts

# Sync version literals in src/ from package.json.
sync-version:
    node scripts/sync-version.ts

# Install a `zerostack-ts` launcher onto PATH (see scripts/install.ts).
install:
    node scripts/install.ts

# ---- Git hooks ----

install-hook:
    #!/usr/bin/env bash
    cat > .git/hooks/pre-commit << 'EOF'
    #!/bin/sh
    set -e
    echo "Running pre-commit quality checks..."
    npm run check
    EOF
    chmod +x .git/hooks/pre-commit
    echo "Pre-commit hook installation confirmed."

remove-hook:
    rm .git/hooks/pre-commit
    echo "Pre-commit hook uninstallation confirmed."

# ---- Tags ----

add-tag:
    #!/usr/bin/env bash
    set -euo pipefail
    git push origin HEAD
    VERSION=$(node -p "require('./package.json').version")
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    git push origin "v${VERSION}"
    echo "Created and pushed tag v${VERSION}"

remove-tag VERSION="":
    #!/usr/bin/env bash
    set -e
    tag="{{ VERSION }}"
    if [ -z "$tag" ]; then
        echo "Error: pass a tag, e.g. just remove-tag v1.8.5" >&2
        exit 1
    fi
    git tag -d "$tag" || {
        echo "Local tag not found"
        exit 1
    }
    git push --delete origin "$tag"
    echo "Removed tag $tag"

# ---- Release ----

# Full release: bump version, sync, commit, push, tag, and publish to npm.
# BUMP must be one of: major, minor, patch.
release BUMP:
    #!/usr/bin/env bash
    set -euo pipefail

    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "Error: working tree is dirty. Commit or stash changes first." >&2
        exit 1
    fi

    VERSION=$(node -p "require('./package.json').version")
    NEW_VERSION=$(node -e "
      const v = process.argv[1].split('.').map(Number);
      const bump = process.argv[2];
      if (bump === 'major') { v[0] += 1; v[1] = 0; v[2] = 0; }
      else if (bump === 'minor') { v[1] += 1; v[2] = 0; }
      else if (bump === 'patch') { v[2] += 1; }
      else { console.error('Error: BUMP must be one of: major, minor, patch'); process.exit(1); }
      console.log(v.join('.'));
    " "$VERSION" "{{ BUMP }}")

    echo "Bumping version: ${VERSION} -> ${NEW_VERSION}"
    node -e "
      const fs = require('node:fs');
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      pkg.version = process.argv[1];
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    " "$NEW_VERSION"

    just pre-release

    git commit -am "bump to v${NEW_VERSION}"
    git push origin HEAD

    git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
    git push origin "v${NEW_VERSION}"
    echo "Tag v${NEW_VERSION} pushed."

    npm publish
    echo ""
    echo "=== release v${NEW_VERSION} done ==="
    echo "Next: run: just post-release"

# Run after bumping the package.json version (syncs version literals).
pre-release: sync-version
    @echo "=== pre-release done: version synced across version literals ==="
    @echo "Next: just add-tag, wait for the release, then: just post-release"

# Run after the release has been published (verifies version literals).
post-release:
    node scripts/sync-version.ts --check
    @echo "=== post-release done: version literals in sync ==="
    @echo "This port has no platform archives, so there are no checksums to update."
