import { createHeightTransport } from './transport.js';
import { createYandexAdapter } from './yandex.js';
import { createDgisAdapter } from './dgis.js';

const fetchResource = createHeightTransport();
const yandex = createYandexAdapter({ fetchResource });
const active = new Map();
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { active.get(data.id)?.abort(); return; }
  if (data.type !== 'load' || active.has(data.id)) return;
  const controller = new AbortController();
  active.set(data.id, controller);
  try {
    const load = data.source === 'yandex' ? yandex : data.source === '2gis'
      ? createDgisAdapter({ fetchResource, getPublicConfig: async () => data.config }) : null;
    if (!load) throw new Error('Unknown source');
    const result = await load({ bbox: data.bbox, signal: controller.signal });
    if (!controller.signal.aborted) self.postMessage({ id: data.id, result });
  } catch {
    // Never expose a provider URL or its public bootstrap key in error messages.
    if (!controller.signal.aborted) self.postMessage({ id: data.id, error: 'Источник недоступен из браузера. Проверьте соединение и обновите область.' });
  } finally { active.delete(data.id); }
};
