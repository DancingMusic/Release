# DancingMusic Release

Public version-management repository for packages built from
`DancingMusic/DancingMusic`.

This repository owns public update manifests and the matching GitHub/Gitee
release packages. Private source maps, symbols, signing logs and credentials do
not belong here.

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
- `GITEE_RELEASE_TOKEN`: Gitee personal access token with release and repository
  write access to `dancingmusic/Release`;
- `RELEASE_META_TOKEN`: GitHub token for the private diagnostics repository.

`publish-mirrors.mjs` accepts only installable public packages and the Web
bundle. Source maps, symbols and signing/notarization diagnostics must be sent
directly to the private metadata repository; they are never intermediary
artifacts in a public repository.

Never store plaintext signing private keys or passwords. Use repository secrets
and keep private diagnostics in the restricted metadata repository.
