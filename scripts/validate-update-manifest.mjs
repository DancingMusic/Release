#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/validate-update-manifest.mjs update/stable.json');
const manifest = JSON.parse(await readFile(file, 'utf8'));
const allowedHosts = new Set(['github.com', 'gitee.com']);

if (manifest.schemaVersion !== 1 || !['stable', 'beta'].includes(manifest.channel)) throw new Error('Invalid schemaVersion/channel');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Invalid version');
if (!Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error('Invalid publishedAt');
if (!manifest.artifacts || typeof manifest.artifacts !== 'object' || !Object.keys(manifest.artifacts).length) throw new Error('No artifacts');

for (const [key, artifact] of Object.entries(manifest.artifacts)) {
  if (!artifact.file || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1) throw new Error(`Invalid artifact ${key}`);
  if (!Array.isArray(artifact.urls) || artifact.urls.length < 1) throw new Error(`No URLs for ${key}`);
  for (const raw of artifact.urls) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error(`Unofficial URL for ${key}: ${raw}`);
  }
}
console.log(`${file}: valid DancingMusic update manifest v1`);
