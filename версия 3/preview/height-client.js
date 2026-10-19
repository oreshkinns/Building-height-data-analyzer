(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const api = factory();
    const scriptUrl = new URL(document.currentScript.src);
    const version = scriptUrl.searchParams.get('v');
    const entry = version && /^[a-f0-9]{12}$/.test(version) ? `_release/${version}/height-data/worker.js` : 'height-data/worker.js';
    root.BuildingHeightClient = api.createHeightClient({ workerUrl: new URL(entry, scriptUrl) });
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function createHeightClient({ WorkerCtor = globalThis.Worker, workerUrl, fetchImpl = globalThis.fetch } = {}) {
    let worker, nextId = 0, config;
    const pending = new Map();
    const failAll = () => {
      const failed = worker; worker = null; failed?.terminate();
      for (const task of [...pending.values()]) task.finish(new Error('Не удалось запустить обработку высот в браузере.'));
    };
    function getWorker() {
      if (!worker) {
        if (typeof WorkerCtor !== 'function') throw new Error('Браузер не поддерживает обработку высот в worker.');
        worker = new WorkerCtor(workerUrl, { type: 'module', name: 'building-heights' });
        worker.onmessage = ({ data }) => {
          const task = pending.get(data?.id);
          if (task) task.finish(data.error ? new Error(data.error) : null, data.result);
        };
        worker.onerror = event => { event.preventDefault?.(); failAll(); };
        worker.onmessageerror = failAll;
      }
      return worker;
    }
    async function publicConfig(signal) {
      if (config?.expiresAt > Date.now()) return config;
      const response = await fetchImpl('/api/building-height-analyzer/2gis-config', { credentials: 'same-origin', signal });
      const payload = await response.json();
      if (!response.ok || payload.success !== true || typeof payload.vectorKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.vectorKey)) {
        throw new Error('2ГИС: не удалось получить публичную конфигурацию.');
      }
      config = { vectorKey: payload.vectorKey, expiresAt: Math.min(Number(payload.expiresAt) || 0, Date.now() + 3600000) };
      return config;
    }
    async function load(source, bbox, { signal } = {}) {
      signal?.throwIfAborted();
      if (!['yandex', '2gis'].includes(source)) throw new Error('Неизвестный источник высот.');
      const sourceConfig = source === '2gis' ? await publicConfig(signal) : undefined;
      signal?.throwIfAborted();
      const target = getWorker(), id = ++nextId;
      return new Promise((resolve, reject) => {
        const finish = (error, value) => {
          if (!pending.delete(id)) return;
          signal?.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => { target.postMessage({ type: 'cancel', id }); finish(signal.reason || new DOMException('Cancelled', 'AbortError')); };
        pending.set(id, { finish });
        signal?.addEventListener('abort', cancel, { once: true });
        try { target.postMessage({ type: 'load', id, source, bbox, config: sourceConfig }); }
        catch { finish(new Error('Не удалось передать область обработчику браузера.')); }
        if (signal?.aborted) cancel();
      });
    }
    return { load, dispose() { config = null; failAll(); } };
  }
  return { createHeightClient };
});
