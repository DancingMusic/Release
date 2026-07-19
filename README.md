# DancingMusic Release

Public version-management repository for packages built from
`DancingMusic/DancingMusic`.

This repository owns public update manifests and the matching GitHub/Gitee
release packages. Private source maps, symbols, signing logs and credentials do
not belong here.

## Automation source

`Release` intentionally does not run its own package build workflow. The host
repository's `release-build.yml` builds the product and writes verified public
packages and channel manifests here.

- Every push to `DancingMusic/DancingMusic` `main` publishes a uniquely
  versioned beta package (for example, `0.2.0-dev.2.main.418.1`) so existing
  releases and assets remain immutable.
- CI stages each verified platform package in a hidden GitHub Release draft,
  rather than temporary GitHub Actions artifacts. The draft is made public only
  after all packages have passed remote integrity verification; failed builds
  remove the draft.
- `v*` tag pushes remain build verification only. A manually confirmed
  `workflow_dispatch` publication is used for stable releases.
- The public channel manifest remains the final write, after every configured
  mirror has uploaded and verified the referenced package bytes.

## Mirror rule

- GitHub: international source.
- Gitee (`dancingmusic/Release`): domestic source.
- Both sources use the same tag, package filename, SHA-256 and manifest.
- Publish `update/stable.json` or `update/beta.json` only after every package
  referenced by that manifest is available on that mirror.
- A mirror may lag; desktop clients validate and fall back to the other source.

The manifest contract is documented by `update/schema.json`. Generate a
candidate with `node scripts/generate-update-manifest.mjs` and validate it with
`node scripts/validate-update-manifest.mjs` before publishing. CI uses
`scripts/publish-mirrors.mjs`: it uploads public packages, downloads them back
to verify filename, byte size and SHA-256 on both providers, and only then commits the identical channel
manifest to both `main` branches.

Required secrets live in the host repository/environment, never in this repo:

- `RELEASE_REPO_TOKEN`: fine-grained GitHub token with Contents write access to
  `DancingMusic/Release`;
- `GITEE_RELEASE_TOKEN`: optional Gitee personal access token with release and
  repository write access to `dancingmusic/Release`;
- `RELEASE_META_TOKEN`: GitHub token for the private diagnostics repository.

`publish-mirrors.mjs` accepts desktop installers, Android APK/AAB, signed iOS
IPA packages and the Web bundle. Android R8 mapping, iOS dSYM, source maps,
symbols and signing/notarization diagnostics must be sent
directly to the private metadata repository; they are never intermediary
artifacts in a public repository.

GitHub is the required primary release provider. When the Gitee token is not
configured, publication continues on GitHub and the generated manifest contains
only verified GitHub URLs; Gitee's existing manifest is left unchanged and an
explicit warning is emitted. Once the token is configured, the same command
verifies both mirrors before publishing manifests that contain both URLs.

Never store plaintext signing private keys or passwords. Use repository secrets
and keep private diagnostics in the restricted metadata repository.
