// Yandex vmap3 schema adapted from draleksei1-cmyk/archscene-sketchup,
// dev/archscene_bureau/engine/core/pbf.js (2026-10-17).
// Metadata/models are intentionally skipped; all geometry paths must still be consumed.
export const YANDEX_DECODER_VERSION = 'vmap3-building-1';
const utf8 = new TextDecoder();
const MAX_ITEMS = 2_000_000;
function requireValid(ok, message = 'Invalid Yandex protobuf') { if (!ok) throw new Error(message); }
class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      requireValid(this.offset < this.bytes.length, 'Truncated Yandex protobuf');
      const byte = this.bytes[this.offset++];
      requireValid(i !== 9 || byte <= 1);
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (byte < 128) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    throw new Error('Invalid Yandex varint');
  }
  value(wire) {
    if (wire === 0) return this.varint();
    const length = wire === 1 ? 8 : wire === 5 ? 4 : wire === 2 ? this.varint() : -1;
    requireValid(Number.isSafeInteger(length) && length >= 0 && this.offset + length <= this.bytes.length);
    const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value;
  }
}
function fields(bytes, visit) {
  const reader = new Reader(bytes);
  while (reader.offset < bytes.length) {
    const tag = reader.varint(); requireValid(Number.isSafeInteger(tag) && tag > 7);
    visit(Math.floor(tag / 8), tag % 8, reader.value(tag % 8));
  }
}
const signed = value => typeof value === 'number' ? (value % 2 ? -(value + 1) / 2 : value / 2) : String((BigInt(value) >> 1n) ^ -(BigInt(value) & 1n));
function packed(bytes, zigzag = false) {
  const reader = new Reader(bytes), values = [];
  while (reader.offset < bytes.length) { requireValid(values.length < MAX_ITEMS); const value = reader.varint(); values.push(zigzag ? signed(value) : value); }
  return values;
}
function append(target, values) { requireValid(target.length + values.length <= MAX_ITEMS); for (const value of values) target.push(value); }
function keys(bytes) { const result = []; fields(bytes, (field, wire, value) => { if (field === 1 && wire === 2) result.push(utf8.decode(value)); }); return result; }
function attributeValue(bytes) {
  let result = null;
  fields(bytes, (field, wire, value) => {
    if (field === 1 && wire === 2) result = utf8.decode(value);
    else if (field === 2 && wire === 0) result = signed(value);
    else if ((field === 3 || field === 4) && wire === 0) result = value;
    else if (field === 5 && wire === 5) result = new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true);
    else if (field === 6 && wire === 0) result = Number(value) !== 0;
  }); return result;
}
function feature(bytes) {
  const result = { id: '0' };
  fields(bytes, (field, wire, value) => {
    if (field === 1) result.point = true;
    else if (field === 2 && wire === 2) { result.lines = 1; fields(value, (f, w, v) => { if (f === 1 && w === 0) result.lines = v; }); }
    else if (field === 3 && wire === 2) { result.rings = []; result.contours = 0; fields(value, (f, w, v) => { if (f === 1) append(result.rings, w === 2 ? packed(v) : [v]); else if (f === 2 && w === 0) result.contours = v; }); }
    else if (field === 5 && wire === 0) result.id = String(value);
    else if (field === 6 && wire === 2) { result.keysId = 0; result.valueIds = []; fields(value, (f, w, v) => { if (f === 1 && w === 0) result.keysId = v; else if (f === 2) append(result.valueIds, w === 2 ? packed(v) : [v]); }); }
  }); return result;
}
function layer(bytes) {
  const result = { name: '', features: [] };
  fields(bytes, (field, wire, value) => { if (field === 1 && wire === 2) result.name = utf8.decode(value); else if (field === 2 && wire === 2) { requireValid(result.features.length < 100_000); result.features.push(feature(value)); } }); return result;
}
function parse(bytes) {
  const result = { bitness: 8, geometry: [], sizes: [], keysets: [], values: [], layers: [] };
  fields(bytes, (field, wire, value) => {
    if (field === 1 && wire === 0) result.bitness = value;
    else if (field === 2 && wire === 2) append(result.geometry, packed(value, true));
    else if (field === 3 && wire === 2) append(result.sizes, packed(value));
    else if (field === 4 && wire === 2) result.keysets.push(keys(value));
    else if (field === 5 && wire === 2) result.values.push(attributeValue(value));
    else if (field === 6 && wire === 2) result.layers.push(layer(value));
  });
  requireValid(Number.isInteger(result.bitness) && result.bitness >= 2 && result.bitness <= 32 && result.layers.length > 0, 'Unknown Yandex protobuf schema');
  return result;
}
const eccentricity = Math.sqrt(0.0066943799901413165);
export function yandexWorldToLonLat(x, y) {
  const t = Math.exp(-Math.PI * y); let latitude = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 12; i++) latitude = Math.PI / 2 - 2 * Math.atan(t * ((1 - eccentricity * Math.sin(latitude)) / (1 + eccentricity * Math.sin(latitude))) ** (eccentricity / 2));
  return [x * 180, latitude * 180 / Math.PI];
}
export function decodeYandexTile(bytes, [tx, ty, zoom]) {
  const tile = parse(bytes), span = 2 / 2 ** zoom, cx = span * tx - 1 + span / 2, cy = 1 - span * ty - span / 2, ratio = span / (2 ** tile.bitness - 1);
  let geometryIndex = 0, offset = 0;
  function path() {
    requireValid(geometryIndex < tile.sizes.length);
    const length = tile.sizes[geometryIndex++];
    requireValid(Number.isSafeInteger(length) && length >= 0 && offset + 2 * length <= tile.geometry.length);
    let x = 0, y = 0; const points = [];
    for (let i = 0; i < length; i++) { const dx = tile.geometry[offset++], dy = tile.geometry[offset++]; requireValid(Number.isSafeInteger(dx) && Number.isSafeInteger(dy)); x += dx; y += dy; points.push(yandexWorldToLonLat(cx + x * ratio, cy - y * ratio)); }
    return points;
  }
  const records = [];
  for (const current of tile.layers) for (const item of current.features) {
    const polygons = [];
    if (item.point) path();
    else if (item.lines != null) { requireValid(Number.isSafeInteger(item.lines) && item.lines >= 0 && item.lines <= tile.sizes.length); for (let i = 0; i < item.lines; i++) path(); }
    else if (item.rings) {
      for (const count of item.rings) {
        requireValid(Number.isSafeInteger(count) && count >= 0 && count <= tile.sizes.length);
        const rings = [];
        for (let i = 0; i < count; i++) { const ring = path(); if (ring.length >= 3) { if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push([...ring[0]]); rings.push(ring); } }
        if (rings.length) polygons.push(rings);
      }
      requireValid(Number.isSafeInteger(item.contours) && item.contours >= 0 && item.contours <= tile.sizes.length);
      for (let i = 0; i < item.contours; i++) path();
    }
    if (current.name !== 'building' || !polygons.length) continue;
    const attrs = Object.create(null), attributeKeys = tile.keysets[item.keysId] || [];
    attributeKeys.forEach((key, i) => { attrs[key] = tile.values[item.valueIds?.[i]] ?? null; });
    records.push({ id: item.id, attrs, geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons } });
  }
  requireValid(geometryIndex === tile.sizes.length && offset === tile.geometry.length, 'Unconsumed Yandex geometry stream');
  return records;
}
