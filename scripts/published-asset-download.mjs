// GitHub can take several minutes to expose assets after a draft release is
// promoted. Keep this finite so a broken URL still fails the release, while
// covering the observed propagation window before the manifest is written.
export const ASSET_VISIBILITY_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000,
  45_000, 60_000, 90_000, 120_000, 120_000, 120_000,
];

function isRetryableStatus(status) {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));

/**
 * Release providers can acknowledge an uploaded asset before its public download
 * URL is reachable. Retry only transient visibility/network failures; callers
 * still receive permanent HTTP errors and integrity failures immediately.
 */
export async function fetchPublishedAsset(url, { fetchImpl = fetch, sleep = wait, onRetry } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= ASSET_VISIBILITY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (response.ok || !isRetryableStatus(response.status) || attempt === ASSET_VISIBILITY_RETRY_DELAYS_MS.length) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === ASSET_VISIBILITY_RETRY_DELAYS_MS.length) throw error;
    }

    const delay = ASSET_VISIBILITY_RETRY_DELAYS_MS[attempt];
    onRetry?.({ attempt: attempt + 1, delay, error: lastError });
    await sleep(delay);
  }

  throw lastError;
}
