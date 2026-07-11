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
  return null;
}

const artifacts = {};
for (const file of (await readdir(assetsDir)).sort()) {
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
}

if (!Object.keys(artifacts).length) throw new Error(`No supported desktop packages found in ${assetsDir}`);
const requiredPlatforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'];
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
