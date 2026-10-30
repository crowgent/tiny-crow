---
description: "How tiny-crow releases are versioned: package.json is the single source of truth, and releases are tagged from main."
---

# Publishing Releases

This guide covers the release workflow for tiny-crow: bumping the
version, verifying the tree, tagging, and pushing.

## One source of truth for the version

The version lives in `package.json` (`"version": "1.8.5"` at the time of
writing). Nothing else carries the version — do not bump it anywhere
else. Confirm the current version at any time with:

```bash
npm run sync-version
```

## Steps for a release

1. Verify the working tree is clean.
2. Bump the version in `package.json` (patch, minor, or major).
3. Verify the tree before tagging:

```bash
npm run typecheck
npm test
```

4. Commit as `bump to vX.Y.Z` and push the current branch.
5. Create and push an annotated tag `vX.Y.Z`:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

## Notes

- There is no build step: Node.js 24 or newer runs the TypeScript
  sources directly, so a release is a tagged commit, not a built
  artifact.
- There is no registry-publishing step in this workflow. If a
  publishing step is added later, document its exact command here
  before using it.
