#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const assetsDir = path.resolve(value('assets') ?? 'assets');
const version = value('version');
const tag = value('tag') ?? (version ? `v${version}` : '');
const channel = value('channel') ?? (version?.includes('-') ? 'beta' : 'stable');
const linuxGpgFingerprint = value('linux-gpg-fingerprint') ?? '';
const githubToken = process.env.RELEASE_REPO_TOKEN;
const giteeToken = process.env.GITEE_RELEASE_TOKEN;

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !tag) {
  throw new Error('Usage: publish-mirrors.mjs --assets=DIR --version=X.Y.Z --tag=vX.Y.Z');
}
if (!githubToken) throw new Error('RELEASE_REPO_TOKEN is required');
if (!['stable', 'beta'].includes(channel)) throw new Error('channel must be stable or beta');

const privateName = /(?:\.map|\.pdb|\.sym|\.dSYM(?:\.zip)?|symbols\.zip|builder-debug\.yml|codesign-|notarization-)/i;
const publicName = /^(?:DancingMusic-.+-(?:arm64|x64)\.(?:dmg|zip)|DancingMusic-Setup-.+\.exe|DancingMusic-.+-(?:x86_64|x64)\.AppImage(?:\.asc)?|DancingMusic-release-signing-key\.asc|DancingMusic-.+-android\.(?:apk|aab)|DancingMusic-.+-ios\.ipa|dancingmusic-dist\.tar\.gz)$/i;
const mobilePackageName = /\.(?:apk|aab|ipa)$/i;
const files = [];
const assetNames = (await readdir(assetsDir)).sort();
for (const name of assetNames) {
  const filePath = path.join(assetsDir, name);
  if (!(await stat(filePath)).isFile()) continue;
  if (mobilePackageName.test(name) && !publicName.test(name)) {
    throw new Error(`Unsupported mobile package filename: ${name}`);
  }
  if (!publicName.test(name)) continue;
  if (privateName.test(name)) throw new Error(`Private diagnostic matched public package list: ${name}`);
  const bytes = await readFile(filePath);
  files.push({ name, filePath, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (!files.length) throw new Error(`No public packages found in ${assetsDir}`);
for (const name of assetNames.filter(name => name.endsWith('.AppImage.asc'))) {
  if (!assetNames.includes(name.slice(0, -4)) || !assetNames.includes('DancingMusic-release-signing-key.asc')) {
    throw new Error(`OpenPGP sidecar requires its AppImage and DancingMusic-release-signing-key.asc: ${name}`);
  }
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(linuxGpgFingerprint.replace(/\s/g, ''))) {
    throw new Error('A signed Linux AppImage requires --linux-gpg-fingerprint');
  }
}

async function request(url, options = {}, token = githubToken) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function githubRelease() {
  const base = 'https://api.github.com/repos/DancingMusic/Release';
  let release;
  const existing = await fetch(`${base}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}` },
  });
  if (existing.ok) release = await existing.json();
  else if (existing.status === 404) {
    // GitHub does not expose draft releases through /releases/tags/:tag.
    // Find the staged draft explicitly so the finalizer promotes it instead of
    // creating a second public release for the same package version.
    const releases = await request(`${base}/releases?per_page=100`);
    release = releases.find(candidate => candidate.tag_name === tag);
    if (!release) {
      release = await request(`${base}/releases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: tag, prerelease: channel === 'beta' }),
      });
    }
  } else throw new Error(`GitHub release lookup failed: ${existing.status} ${await existing.text()}`);

  const current = new Map(release.assets.map(asset => [asset.name, asset]));
  for (const file of files) {
    if (current.has(file.name)) await request(`${base}/releases/assets/${current.get(file.name).id}`, { method: 'DELETE' });
    const bytes = await readFile(file.filePath);
    await request(`${release.upload_url.replace('{?name,label}', '')}?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
    });
  }
  const verified = await request(`${base}/releases/${release.id}/assets?per_page=100`);
  await verifyAssets('GitHub', verified.map(asset => ({ name: asset.name, size: asset.size, url: asset.url })), githubToken);
  return { id: release.id, urls: new Map(verified.map(asset => [asset.name, asset.browser_download_url])) };
}

async function giteeRelease() {
  const base = 'https://gitee.com/api/v5/repos/dancingmusic/Release';
  const auth = url => `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(giteeToken)}`;
  let release;
  const list = await request(auth(`${base}/releases?per_page=100`), {}, null);
  release = list.find(item => item.tag_name === tag);
  if (!release) {
    release = await request(auth(`${base}/releases`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: tag, body: `DancingMusic ${tag}`, prerelease: channel === 'beta' }),
    }, null);
  }
  const oldAssets = new Map((release.assets ?? []).map(asset => [asset.name, asset]));
  for (const file of files) {
    const old = oldAssets.get(file.name);
    if (old?.id) await request(auth(`${base}/releases/${release.id}/attach_files/${old.id}`), { method: 'DELETE' }, null);
    const form = new FormData();
    form.append('file', new Blob([await readFile(file.filePath)]), file.name);
    await request(auth(`${base}/releases/${release.id}/attach_files`), { method: 'POST', body: form }, null);
  }
  const refreshed = await request(auth(`${base}/releases/${release.id}`), {}, null);
  await verifyAssets('Gitee', (refreshed.assets ?? []).map(asset => ({ name: asset.name, size: asset.size, url: asset.browser_download_url })));
  return new Map((refreshed.assets ?? []).map(asset => [asset.name, asset.browser_download_url]));
}

async function verifyAssets(label, remote, token) {
  const byName = new Map(remote.map(item => [item.name, item]));
  for (const file of files) {
    const asset = byName.get(file.name);
    if (!asset || Number(asset.size) !== file.size || !asset.url) throw new Error(`${label} package missing or size mismatch: ${file.name}`);
    const response = await fetch(asset.url, {
      redirect: 'follow',
      headers: token ? {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      } : undefined,
    });
    if (!response.ok) throw new Error(`${label} package download failed: ${file.name} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== file.size || sha256 !== file.sha256) throw new Error(`${label} package integrity mismatch: ${file.name}`);
  }
}

async function publishGithubRelease(releaseId) {
  await request(`https://api.github.com/repos/DancingMusic/Release/releases/${releaseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, prerelease: channel === 'beta' }),
  });
}

async function putManifest(provider, content) {
  const target = `update/${channel}.json`;
  const message = `release: publish ${channel} manifest for ${tag}`;
  if (provider === 'github') {
    const base = `https://api.github.com/repos/DancingMusic/Release/contents/${target}`;
    const old = await fetch(base, { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' } });
    const sha = old.ok ? (await old.json()).sha : undefined;
    await request(base, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
    });
    return;
  }
  const base = `https://gitee.com/api/v5/repos/dancingmusic/Release/contents/${target}`;
  const auth = url => `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(giteeToken)}`;
  const old = await fetch(auth(`${base}?ref=main`));
  const sha = old.ok ? (await old.json()).sha : undefined;
  await request(auth(base), {
    method: sha ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
  }, null);
}

const manifestPath = path.join(root, 'update', `${channel}.json`);
const providers = ['github', ...(giteeToken ? ['gitee'] : [])];
const manifestCommand = [path.join(root, 'scripts/generate-update-manifest.mjs'), `--assets=${assetsDir}`, `--version=${version}`, `--tag=${tag}`, `--channel=${channel}`, `--providers=${providers.join(',')}`, `--linux-gpg-fingerprint=${linuxGpgFingerprint}`, `--output=${manifestPath}`];

// Validate filenames and the complete candidate manifest before mutating either provider.
execFileSync(process.execPath, manifestCommand, { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'scripts/validate-update-manifest.mjs'), manifestPath], { stdio: 'inherit' });

const githubReleaseResult = await githubRelease();
const giteeUrls = giteeToken ? await giteeRelease() : null;
if (!giteeToken) console.warn('GITEE_RELEASE_TOKEN is not configured; publishing the verified GitHub mirror only.');

const manifestValue = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const artifact of Object.values(manifestValue.artifacts)) {
  const githubUrl = githubReleaseResult.urls.get(artifact.file);
  const giteeUrl = giteeUrls?.get(artifact.file);
  if (!githubUrl || (giteeToken && !giteeUrl)) throw new Error(`Mirror URL missing after upload: ${artifact.file}`);
  artifact.urls = [githubUrl, ...(giteeUrl ? [giteeUrl] : [])];
  if (artifact.signature) {
    const signatureGithubUrl = githubReleaseResult.urls.get(artifact.signature.file);
    const signatureGiteeUrl = giteeUrls?.get(artifact.signature.file);
    if (!signatureGithubUrl || (giteeToken && !signatureGiteeUrl)) throw new Error(`Mirror URL missing after upload: ${artifact.signature.file}`);
    artifact.signature.urls = [signatureGithubUrl, ...(signatureGiteeUrl ? [signatureGiteeUrl] : [])];

    const publicKeyGithubUrl = githubReleaseResult.urls.get(artifact.signature.publicKey.file);
    const publicKeyGiteeUrl = giteeUrls?.get(artifact.signature.publicKey.file);
    if (!publicKeyGithubUrl || (giteeToken && !publicKeyGiteeUrl)) throw new Error(`Mirror URL missing after upload: ${artifact.signature.publicKey.file}`);
    artifact.signature.publicKey.urls = [publicKeyGithubUrl, ...(publicKeyGiteeUrl ? [publicKeyGiteeUrl] : [])];
  }
}
const manifest = `${JSON.stringify(manifestValue, null, 2)}\n`;
await writeFile(manifestPath, manifest, 'utf8');
execFileSync(process.execPath, [path.join(root, 'scripts/validate-update-manifest.mjs'), manifestPath], { stdio: 'inherit' });

// Make the staged GitHub assets public before the final manifest points at them.
await publishGithubRelease(githubReleaseResult.id);

// The manifest is intentionally the last write, after every configured provider passed size verification.
await putManifest('github', manifest);
if (giteeToken) await putManifest('gitee', manifest);
console.log(`Published ${tag} packages and ${channel} manifest to ${providers.join(' and ')}.`);
