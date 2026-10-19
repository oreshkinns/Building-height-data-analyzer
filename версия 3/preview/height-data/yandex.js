import { decodeYandexTile, YANDEX_DECODER_VERSION } from './decoders/yandexPbf.js';
import * as clippingModule from '../vendor/polygon-clipping.umd.min.js';
const polygonClipping = clippingModule.default ?? globalThis.polygonClipping;

const TILE_URL = 'https://core-renderer-tiles.maps.yandex.com/vmap3/tiles';
const RECIPE_VERSION = 'current-vmap3-1';
const MAX_TILES = 96;
const ZOOM = 15;
const eccentricity = Math.sqrt(0.0066943799901413165);
export function yandexTileCoordinates(longitude, latitude, zoom = ZOOM) {
  const r = latitude * Math.PI / 180, n = 2 ** zoom;
  return [(longitude + 180) / 360 * n, (1 - Math.log(Math.tan(Math.PI / 4 + r / 2) * ((1 - eccentricity * Math.sin(r)) / (1 + eccentricity * Math.sin(r))) ** (eccentricity / 2)) / Math.PI) / 2 * n];
}
function tileGrid(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -85 || bbox[3] > 85) throw new Error('Invalid Yandex area bounds');
  const nw = yandexTileCoordinates(bbox[0], bbox[3]), se = yandexTileCoordinates(bbox[2], bbox[1]);
  const minX = Math.floor(nw[0]), minY = Math.floor(nw[1]), maxX = Math.ceil(se[0]) - 1, maxY = Math.ceil(se[1]) - 1;
  const count = (maxX - minX + 1) * (maxY - minY + 1);
  if (count < 1 || count > MAX_TILES) throw new Error('Yandex area exceeds 96 tile limit');
  const result = []; for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) result.push([x, y, ZOOM]); return result;
}
function points(geometry) { return geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2); }
function intersects(geometry, [w, s, e, n]) {
  const coordinates = points(geometry);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coordinates) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return minX <= e && maxX >= w && minY <= n && maxY >= s;
}
function sourceHeight(raw) { return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1000 ? raw : null; }
export function createYandexAdapter({ fetchResource }) {
  if (typeof fetchResource !== 'function') throw new TypeError('Yandex fetchResource is required');
  return async function load({ bbox, signal }) {
    signal?.throwIfAborted();
    const tiles = tileGrid(bbox);
    const fetchedAt = new Date().toISOString();
    // The renderer serves current tiles when v is omitted. Map HTML is not
    // required and may independently require an interactive CAPTCHA on servers.
    // Do not invent a map revision: only the decoder/recipe is locally versioned.
    const coverage = { status: 'unavailable', expectedTiles: tiles.length, loadedTiles: 0, decodedTiles: 0 };
    const warnings = [], tileResults = new Array(tiles.length);
    let cursor = 0;
    async function worker() {
      while (cursor < tiles.length) {
        signal?.throwIfAborted();
        const index = cursor++, xyz = tiles[index];
        const url = new URL(TILE_URL);
        for (const [key, value] of Object.entries({ x: xyz[0], y: xyz[1], z: xyz[2], lang: 'ru_RU', zmin: 15, zmax: 21, client_id: 'yandex-web-maps', ads: 'enabled' })) url.searchParams.set(key, value);
        try {
          const response = await fetchResource(url.href, { signal, maxBytes: 8 * 1024 * 1024, timeoutMs: 15000 });
          coverage.loadedTiles++;
          if (!/application\/(?:x-protobuf|protobuf|octet-stream)/i.test(response.contentType || '')) throw new Error('Unexpected tile content type');
          const decoded = decodeYandexTile(response.bytes, xyz);
          coverage.decodedTiles++; tileResults[index] = decoded;
        } catch {
          signal?.throwIfAborted();
          // A successful HTTP response can still be invalid data. Evict it so
          // the next user request can recover; never retry a challenge.
          fetchResource.invalidate?.(url.href);
          warnings.push(`yandex_tile_unavailable:${xyz.join('/')}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, tiles.length) }, worker));
    const records = [], partGroups = new Map();
    for (let index = 0; index < tiles.length; index++) for (const row of tileResults[index] || []) {
      if (!intersects(row.geometry, bbox)) continue;
      const sourceFeatureId = String(row.id), sourcePartId = String(row.attrs.feature_id ?? row.id);
      const rawHeight = row.attrs.height ?? null, heightMeters = sourceHeight(rawHeight);
      const partKey = `${sourceFeatureId}:${sourcePartId}:${JSON.stringify(rawHeight)}`;
      const id = `yandex:${partKey}`;
      const group = partGroups.get(partKey) || [];
      group.push({ record: { id, source: 'yandex', sourceFeatureId, sourcePartId, geometry: row.geometry, heightMeters, heightDerived: false, floors: null, floorsDerived: false, rawHeight, rawHeightField: 'height', fetchedAt, tileBoundaryFragment: false }, xyz: tiles[index] });
      partGroups.set(partKey, group);
    }
    let unresolvedBoundaries = false;
    for (const group of partGroups.values()) {
      if (group.length === 1) { records.push(group[0].record); continue; }
      try {
        // Native part identity and raw height define the union; different vertical
        // parts of one building remain separate. The vendor preserves interior rings.
        const merged = polygonClipping.union(...group.map(({ record }) => record.geometry.coordinates));
        if (!merged.length) throw new Error('Empty Yandex union');
        records.push({ ...group[0].record, geometry: merged.length === 1 ? { type: 'Polygon', coordinates: merged[0] } : { type: 'MultiPolygon', coordinates: merged } });
      } catch {
        unresolvedBoundaries = true;
        warnings.push(`yandex_boundary_fragments:${group[0].record.sourcePartId}`);
        group.forEach(({ record, xyz }, index) => records.push({ ...record, id: `${record.id}:fragment:${xyz.join('/')}:${index}`, tileBoundaryFragment: true }));
      }
    }
    coverage.status = coverage.decodedTiles === coverage.expectedTiles ? 'complete' : coverage.decodedTiles > 0 ? 'partial' : 'unavailable';
    if (unresolvedBoundaries && coverage.status === 'complete') coverage.status = 'partial';
    return { records, coverage, recipeVersion: RECIPE_VERSION, mapVersion: null, decoderVersion: YANDEX_DECODER_VERSION, fetchedAt, warnings: [...new Set(warnings)] };
  };
}
