import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_VISIBILITY_RETRY_DELAYS_MS, fetchPublishedAsset } from './published-asset-download.mjs';

test('retries a newly uploaded asset until its public URL becomes available', async () => {
  const statuses = [404, 404, 200];
  const sleeps = [];
  const response = await fetchPublishedAsset('https://example.test/package.aab', {
    fetchImpl: async () => new Response('package', { status: statuses.shift() }),
    sleep: async delay => { sleeps.push(delay); },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test('does not retry a permanent download failure', async () => {
  let calls = 0;
  const response = await fetchPublishedAsset('https://example.test/package.aab', {
    fetchImpl: async () => {
      calls += 1;
      return new Response('forbidden', { status: 403 });
    },
    sleep: async () => assert.fail('permanent failures must not sleep'),
  });

  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});

test('keeps a bounded ten-minute visibility window for a promoted draft release', async () => {
  const sleeps = [];
  await fetchPublishedAsset('https://example.test/package.aab', {
    fetchImpl: async () => new Response('not ready', { status: 404 }),
    sleep: async delay => { sleeps.push(delay); },
  });

  assert.deepEqual(sleeps, ASSET_VISIBILITY_RETRY_DELAYS_MS);
  assert.ok(sleeps.reduce((total, delay) => total + delay, 0) >= 10 * 60 * 1_000);
});
