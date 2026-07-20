#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const assetsDir = path.resolve(arg('assets', 'assets'));
const version = arg('version');
const tag = arg('tag', version ? `v${version}` : undefined);
const channel = arg('channel', version?.includes('-') ? 'beta' : 'stable');
const output = path.resolve(arg('output', `update/${channel}.json`));
const providers = new Set(arg('providers', 'github,gitee').split(',').filter(Boolean));
const linuxGpgFingerprint = (arg('linux-gpg-fingerprint', '') ?? '').replace(/\s/g, '').toUpperCase();
const linuxSigningKeyFile = 'DancingMusic-release-signing-key.asc';

if (!version || !tag || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/generate-update-manifest.mjs --assets=DIR --version=X.Y.Z --tag=vX.Y.Z');
}
if (!['stable', 'beta'].includes(channel)) throw new Error('channel must be stable or beta');
if (providers.size === 0 || [...providers].some(provider => !['github', 'gitee'].includes(provider))) {
  throw new Error('providers must contain github and/or gitee');
}

function artifactKey(file) {
  if (/arm64\.(?:dmg|zip)$/i.test(file)) return 'darwin-arm64';
  if (/x64\.(?:dmg|zip)$/i.test(file)) return 'darwin-x64';
  if (/Setup-.*\.exe$/i.test(file)) return 'win32-x64';
  if (/(?:x64|x86_64)\.AppImage$/i.test(file)) return 'linux-x64';
  if (/-android\.apk$/i.test(file)) return 'android-apk';
  if (/-android\.aab$/i.test(file)) return 'android-aab';
  if (/-ios\.ipa$/i.test(file)) return 'ios';
  return null;
}

const artifacts = {};
const assetNames = (await readdir(assetsDir)).sort();
const publicKeyPath = path.join(assetsDir, linuxSigningKeyFile);
const hasLinuxSigningKey = assetNames.includes(linuxSigningKeyFile);
for (const file of assetNames) {
  const key = artifactKey(file);
  if (!key) continue;
  // Prefer the native installer when both macOS dmg and zip are present.
  if (artifacts[key] && !file.endsWith('.dmg')) continue;
  const filePath = path.join(assetsDir, file);
  const bytes = await readFile(filePath);
  const size = (await stat(filePath)).size;
  artifacts[key] = {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size,
    urls: [
      ...(providers.has('github') ? [`https://github.com/DancingMusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`] : []),
      ...(providers.has('gitee') ? [`https://gitee.com/dancingmusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`] : []),
    ],
  };
  if (key === 'linux-x64' && assetNames.includes(`${file}.asc`)) {
    if (!/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(linuxGpgFingerprint) || !hasLinuxSigningKey) {
      throw new Error('A signed Linux AppImage requires --linux-gpg-fingerprint and DancingMusic-release-signing-key.asc');
    }
    const signatureFile = `${file}.asc`;
    const signaturePath = path.join(assetsDir, signatureFile);
    const signatureBytes = await readFile(signaturePath);
    const publicKeyBytes = await readFile(publicKeyPath);
    artifacts[key].signature = {
      type: 'openpgp-detached',
      file: signatureFile,
      sha256: createHash('sha256').update(signatureBytes).digest('hex'),
      size: (await stat(signaturePath)).size,
      urls: [
        ...(providers.has('github') ? [`https://github.com/DancingMusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(signatureFile)}`] : []),
        ...(providers.has('gitee') ? [`https://gitee.com/dancingmusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(signatureFile)}`] : []),
      ],
      fingerprint: linuxGpgFingerprint,
      publicKey: {
        file: linuxSigningKeyFile,
        sha256: createHash('sha256').update(publicKeyBytes).digest('hex'),
        size: (await stat(publicKeyPath)).size,
        urls: [
          ...(providers.has('github') ? [`https://github.com/DancingMusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(linuxSigningKeyFile)}`] : []),
          ...(providers.has('gitee') ? [`https://gitee.com/dancingmusic/Release/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(linuxSigningKeyFile)}`] : []),
        ],
      },
    };
  }
}

if (!Object.keys(artifacts).length) throw new Error(`No supported packages found in ${assetsDir}`);
// A public beta may omit a desktop platform whose native signing gate did not
// pass. Stable releases still require every desktop installer.
const requiredPlatforms = channel === 'stable'
  ? ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']
  : [];
for (const platform of requiredPlatforms) {
  if (!artifacts[platform]) throw new Error(`Missing required desktop package for ${platform}`);
}

const manifest = {
  schemaVersion: 1,
  channel,
  version,
  publishedAt: new Date().toISOString(),
  releaseNotesUrl: `https://github.com/DancingMusic/Release/releases/tag/${encodeURIComponent(tag)}`,
  artifacts,
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${output} with ${Object.keys(artifacts).length} platform artifacts.`);
