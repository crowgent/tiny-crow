---
description: "How a tiny-crow release is cut: the single version source, the health checks, and the annotated tag."
---

# Shipping a tagged release

A release of tiny-crow is a tagged commit, not a built package.
There is no build step to run first — Node.js 24 or newer runs
the TypeScript sources directly — so the work below is about
getting the version right, proving the tree is healthy, and
marking the commit.

## What this workflow deliberately leaves out

- No registry step: nothing here publishes to a package registry.
  If a publishing step is ever introduced, its exact command
  belongs in this document before anyone uses it.
- No artifact step: because there is no build, there is no built
  artifact to attach to the release. The tagged commit is the
  release.

## The version lives in exactly one file

The version is held in exactly one place: `package.json`
(`"version": "1.8.5"` at the time of writing). Do not bump it in
any other file, and do not keep a second copy of the number
anywhere. To see the current version at any moment, run:

```bash
npm run sync-version
```

## The release sequence, in order

1. Check that the working tree is clean, with no uncommitted
   changes hanging around.
2. Raise the version in `package.json` — patch, minor, or major,
   as the change warrants.
3. Prove the tree is healthy before any tag is created:

```bash
npm run typecheck
npm test
```

4. Commit the bump as `bump to vX.Y.Z` and push the current
   branch.
5. Make an annotated tag `vX.Y.Z` and push it:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```
