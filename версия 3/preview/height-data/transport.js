// Public cartographic resources only. Never accept a target URL from the API client.
function validateHeightUrl(raw, resourceKind = 'tiles') {
  const url = new URL(raw);
  const yandexTile = /^core-renderer-tiles\.maps\.yandex\.(?:ru|net|com)$/.test(url.hostname) && url.pathname === '/vmap3/tiles';
  // The public landing page redirects to an AOI-specific region slug (e.g. /gatchina).
  const dgisLanding = url.hostname === '2gis.ru' && /^(?:\/|\/[a-z0-9][a-z0-9_-]{0,63}\/?)$/.test(url.pathname);
  const metaPath = url.pathname.match(/^\/metafiles\/([^/]+)\/metatile\.json$/);
  let validMeta = false;
  try { validMeta = Boolean(metaPath && /^[A-Za-z0-9+/=]{1,128}$/.test(decodeURIComponent(metaPath[1]))); } catch { /* Invalid escaped path is not a resource. */ }
  const dgisTile = /^tile\d*\.maps\.2gis\.com$/.test(url.hostname) && (url.pathname === '/vt' || validMeta);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(resourceKind === 'bootstrap' ? dgisLanding : yandexTile || dgisTile)) throw new Error('Map resource is not allowed');
  return url;
}

function createHeightTransport({ fetchImpl = fetch, concurrency = 4, maxCacheBytes = 64 * 1024 * 1024,
  ttlMs = 24 * 60 * 60 * 1000, now = Date.now, resourceKind = 'tiles' } = {}) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0, cacheBytes = 0;
  const abortError = () => new DOMException('Map request cancelled', 'AbortError');

  function pump() {
    while (active < concurrency && queue.length) {
      const task = queue.shift();
      if (task.signal.aborted) { task.reject(task.signal.reason || abortError()); continue; }
      task.signal.removeEventListener('abort', task.abort);
      active++;
      task.resolve(() => { active--; pump(); });
    }
  }
  function acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason || abortError());
      const task = { signal, resolve, reject };
      task.abort = () => {
        const index = queue.indexOf(task);
        if (index !== -1) queue.splice(index, 1);
        reject(signal.reason || abortError());
      };
      signal.addEventListener('abort', task.abort, { once: true });
      queue.push(task);
      pump();
    });
  }
  function remember(key, value) {
    if (value.bytes.length > maxCacheBytes) return;
    if (cache.has(key)) { cacheBytes -= cache.get(key).value.bytes.length; cache.delete(key); }
    while (cache.size && cacheBytes + value.bytes.length > maxCacheBytes) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).value.bytes.length;
      cache.delete(oldest);
    }
    // Unversioned renderer URLs select the provider's current map revision.
    // They cannot use the same day-long freshness window as immutable tiles.
    const url = new URL(key);
    const lifetime = url.pathname === '/vmap3/tiles' && !url.searchParams.has('v')
      ? Math.min(ttlMs, 15 * 60 * 1000) : ttlMs;
    cache.set(key, { value, expires: now() + lifetime });
    cacheBytes += value.bytes.length;
  }
  async function download(raw, signal, maxBytes) {
    const release = await acquire(signal);
    try {
      let url = validateHeightUrl(raw, resourceKind);
      let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await fetchImpl(url.href, { signal, redirect: resourceKind === 'bootstrap' ? 'manual' : 'error',
          mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: '*/*' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('Map redirect limit');
        url = validateHeightUrl(new URL(location, url).href, resourceKind);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Map upstream HTTP ${response.status}`);
      }
      const length = Number(response.headers.get('content-length'));
      if (length > maxBytes) { await response.body?.cancel(); throw new Error('Map response size limit'); }
      if (!response.body) throw new Error('Empty map response');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new Error('Map response size limit'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (!size) throw new Error('Empty map response');
      const bytes = new Uint8Array(size);
      let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { bytes, contentType: response.headers.get('content-type') || '' };
    } finally { release(); }
  }
  const fetchResource = async function (raw, { signal, maxBytes = 20 * 1024 * 1024, timeoutMs = 10000 } = {}) {
    if (signal?.aborted) throw signal.reason || abortError();
    const url = validateHeightUrl(raw, resourceKind).href;
    const cached = cache.get(url);
    if (cached && cached.expires > now()) {
      if (cached.value.bytes.length > maxBytes) throw new Error('Map response size limit');
      cache.delete(url); cache.set(url, cached);
      return cached.value;
    }
    if (cached) { cacheBytes -= cached.value.bytes.length; cache.delete(url); }
    // Different byte/time budgets cannot borrow a less restrictive admission.
    const key = `${maxBytes}|${timeoutMs}|${url}`;
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const upstreamSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      entry = { controller, consumers: 0 };
      entry.promise = download(url, upstreamSignal, maxBytes).then(value => {
        if (!upstreamSignal.aborted) remember(url, value);
        return value;
      }).finally(() => { if (pending.get(key) === entry) pending.delete(key); });
      pending.set(key, entry);
    }
    entry.consumers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', cancelled);
        entry.consumers--;
        if (error) reject(error); else resolve(value);
      };
      const cancelled = () => {
        finish(signal.reason || abortError());
        if (!entry.consumers) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort(abortError());
        }
      };
      signal?.addEventListener('abort', cancelled, { once: true });
      entry.promise.then(value => finish(null, value), error => finish(error));
      if (signal?.aborted) cancelled();
    });
  };
  // HTTP 200 alone cannot establish semantic validity. Decoders evict challenge
  // pages, corrupt tiles or mismatched metadata rather than replaying them for a day.
  fetchResource.invalidate = raw => {
    const key = validateHeightUrl(raw, resourceKind).href;
    const entry = cache.get(key);
    if (entry) { cacheBytes -= entry.value.bytes.length; cache.delete(key); }
  };
  return fetchResource;
}

export { createHeightTransport, validateHeightUrl };
