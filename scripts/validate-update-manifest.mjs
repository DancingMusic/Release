#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/validate-update-manifest.mjs update/stable.json');
const manifest = JSON.parse(await readFile(file, 'utf8'));
const allowedHosts = new Set(['github.com', 'gitee.com']);

function validateDownload(value, label) {
  if (!value.file || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1) {
    throw new Error(`Invalid ${label}`);
  }
  if (!Array.isArray(value.urls) || value.urls.length < 1) throw new Error(`No URLs for ${label}`);
  for (const raw of value.urls) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error(`Unofficial URL for ${label}: ${raw}`);
  }
}

if (manifest.schemaVersion !== 1 || !['stable', 'beta'].includes(manifest.channel)) throw new Error('Invalid schemaVersion/channel');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Invalid version');
if (!Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error('Invalid publishedAt');
if (!manifest.artifacts || typeof manifest.artifacts !== 'object' || !Object.keys(manifest.artifacts).length) throw new Error('No artifacts');

for (const [key, artifact] of Object.entries(manifest.artifacts)) {
  validateDownload(artifact, `artifact ${key}`);
  if (artifact.signature !== undefined) {
    const signature = artifact.signature;
    if (!signature || signature.type !== 'openpgp-detached' || signature.file !== `${artifact.file}.asc` || !/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(signature.fingerprint ?? '')) {
      throw new Error(`Invalid OpenPGP signature for ${key}`);
    }
    validateDownload(signature, `signature ${key}`);
    if (!signature.publicKey) throw new Error(`OpenPGP public key missing for ${key}`);
    validateDownload(signature.publicKey, `OpenPGP public key ${key}`);
  }
}
console.log(`${file}: valid DancingMusic update manifest v1`);
