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
`node scripts/validate-update-manifest.mjs` before publishing.

Never store plaintext signing private keys or passwords. Use repository secrets
and keep private diagnostics in the restricted metadata repository.
