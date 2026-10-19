import * as clippingModule from '../vendor/polygon-clipping.umd.min.js';
const polygonClipping = clippingModule.default ?? globalThis.polygonClipping;
async function digest(value) {
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
import {roflEnvelope,decodeROFL} from './decoders/dgisRofl.js';

export const DGIS_RECIPE_VERSION='2gis-public-vector-a-protobuf-xyz-v1';
export const DGIS_DECODER_VERSION='rofl-v4-height-union-v2';
const MAX_TILES=160, ZOOM=15;
const BUILDING_LAYERS=new Set(['Dwelling_house','Administrative_house','Technical_house','Private_house','School_house','Preschool_house','Floor_plan_house','Kiosk','Momrah_building']);
const text=new TextDecoder('utf-8',{fatal:true});
function tilesFor(bbox){
 if(!bbox||!['west','east','south','north'].every(k=>Number.isFinite(bbox[k]))||bbox.west>=bbox.east||bbox.south>=bbox.north||bbox.west< -180||bbox.east>180||bbox.south<=-85||bbox.north>=85)return null;
 const n=2**ZOOM,x=lon=>(lon+180)/360*n,y=lat=>(.5+Math.asinh(Math.tan(lat*Math.PI/180))/(2*Math.PI))*n;
 const x0=Math.floor(x(bbox.west)+1e-9),x1=Math.ceil(x(bbox.east)-1e-9)-1,y0=Math.floor(y(bbox.south)+1e-9),y1=Math.ceil(y(bbox.north)-1e-9)-1;
 if((x1-x0+1)*(y1-y0+1)>MAX_TILES)return null;
 const result=[];for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++)result.push([tx,ty,ZOOM]);return result;
}
function requestAt(xyz,key){
 const values=[];const append=value=>{do{const b=value%128;value=Math.floor(value/128);values.push(b|(value?128:0));}while(value);};
 xyz.forEach((value,i)=>{append((i+1)*8);append(value);});
 const url=new URL('https://tile0.maps.2gis.com/vt');
 for(const [name,value] of Object.entries({r:btoa(String.fromCharCode(10,values.length,...values)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),ts:'vector_a',key,appId:'empty',lang:'ru',default_lang:'ru'}))url.searchParams.set(name,value);
 // An empty dt is rejected by the provider; absence requests its static dataset.
 return url;
}
async function buildingPart(record,bbox){
 if(record.type!=='polygon'||!BUILDING_LAYERS.has(record.layer)||record.coordinates.length<3)return null;
 const ring=record.coordinates.map(p=>[p[0],p[1]]);
 if(ring.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))return null;
 const west=Math.min(...ring.map(p=>p[0])),east=Math.max(...ring.map(p=>p[0])),south=Math.min(...ring.map(p=>p[1])),north=Math.max(...ring.map(p=>p[1]));
 if(east<bbox.west||west>bbox.east||north<bbox.south||south>bbox.north)return null;
 if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])ring.push([...ring[0]]);
 const raw=record.attrs.db_height;
 const rawHeight=raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;
 const latitude=(south+north)/2;
 const meters=rawHeight===null?null:rawHeight*2*Math.PI*6378137/2**32*Math.cos(latitude*Math.PI/180);
 const height=meters>0&&meters<=1000?meters:null;
 const sourceFeatureId=record.attrs.db_id===undefined||record.attrs.db_id===null?`${record.sourceTile.join('/')}:${record.sourceDataset}:${record.id}`:String(record.id),geometry={type:'Polygon',coordinates:[ring]};
 const sourcePartId=(await digest(JSON.stringify([sourceFeatureId,record.layer,rawHeight]))).slice(0,24);
 return {id:`2gis:${sourceFeatureId}:${sourcePartId}`,source:'2gis',sourceFeatureId,sourcePartId,geometry,heightMeters:height,heightDerived:false,floors:null,floorsDerived:false,rawHeight,rawHeightField:'db_height'};
}

// ROFL contains fragmented strips. Union only equal source IDs/layers/raw heights:
// roofs at different source elevations must remain distinct selectable parts.
export async function mergeDgisBuildingParts(parts,unionPolygons=polygonClipping.union,signal){
 const groups=new Map(),records=[];let failed=false;
 for(const part of parts){if(!groups.has(part.id))groups.set(part.id,[]);groups.get(part.id).push(part);}
 for(const fragments of groups.values()){
  signal?.throwIfAborted();
  const first=fragments[0];
  try{
   const polygons=unionPolygons(...fragments.map(part=>part.geometry.coordinates));
   if(!polygons.length)throw Error('Empty union');
   const geometry=polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons};
   const ys=polygons.flat(2).map(p=>p[1]);
   const latitude=(Math.min(...ys)+Math.max(...ys))/2;
   const meters=first.rawHeight===null?null:first.rawHeight*2*Math.PI*6378137/2**32*Math.cos(latitude*Math.PI/180);
   records.push({...first,geometry,heightMeters:meters>0&&meters<=1000?meters:null});
  }catch{
   signal?.throwIfAborted();
   failed=true;
   for(const part of fragments){const fragmentId=(await digest(JSON.stringify(part.geometry))).slice(0,24);records.push({...part,id:`${part.id}:fragment:${fragmentId}`,sourcePartId:`${part.sourcePartId}:fragment:${fragmentId}`});}
  }
 }
 return {records,failed};
}
export function createDgisAdapter({fetchResource,getPublicConfig}){
 if(typeof fetchResource!=='function'||typeof getPublicConfig!=='function')throw new TypeError('fetchResource and getPublicConfig required');
 return async function load({bbox:bounds,signal}){
  const bbox=Array.isArray(bounds)&&bounds.length===4?{west:bounds[0],south:bounds[1],east:bounds[2],north:bounds[3]}:null;
  const tiles=tilesFor(bbox),warnings=new Set(),records=new Map();
  const result={records:[],coverage:{status:'unavailable',expectedTiles:tiles?.length||0,loadedTiles:0,decodedTiles:0},warnings:[],recipeVersion:DGIS_RECIPE_VERSION,decoderVersion:DGIS_DECODER_VERSION,fetchedAt:new Date().toISOString()};
  const finish=async()=>{const merged=await mergeDgisBuildingParts([...records.values()],undefined,signal);result.records=merged.records;if(merged.failed)warnings.add('2gis_geometry_union_incomplete');result.warnings=[...warnings];result.coverage.status=result.coverage.decodedTiles===result.coverage.expectedTiles&&result.coverage.expectedTiles>0&&!merged.failed?'complete':result.coverage.decodedTiles>0||records.size>0?'partial':'unavailable';return result;};
  if(!tiles?.length){warnings.add('2gis_area_exceeds_limit_or_invalid');return finish();}
  const get=async(url,maxBytes)=>{if(signal?.aborted)throw signal.reason||Error('Aborted');return fetchResource(String(url),{signal,maxBytes,timeoutMs:15000});};
  const invalidate=url=>fetchResource.invalidate?.(String(url));
  let key;
  try{key=(await getPublicConfig({signal})).vectorKey;if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw Error('Invalid public config');}catch{if(signal?.aborted)throw signal.reason||Error('Aborted');warnings.add('2gis_bootstrap_unavailable');return finish();}
  const metas=new Map();
  const metaUrl=hash=>`https://tile0.maps.2gis.com/metafiles/${encodeURIComponent(hash)}/metatile.json?ts=vector_a`;
  const metadata=hash=>{
   if(!/^[A-Za-z0-9+/=]{1,128}$/.test(hash))throw Error('Invalid metatile hash');
   if(!metas.has(hash)){const url=metaUrl(hash);metas.set(hash,get(url,2*1024*1024).then(r=>{const m=JSON.parse(text.decode(r.bytes));if(!Array.isArray(m.tileProps)||!Array.isArray(m.vertexProps))throw Error('Invalid metadata schema');return m;}).catch(error=>{invalidate(url);throw error;}));}return metas.get(hash);
  };
  let next=0;
  const worker=async()=>{while(next<tiles.length){const xyz=tiles[next++],tileUrl=requestAt(xyz,key);try{
   const response=await get(tileUrl,16*1024*1024);result.coverage.loadedTiles++;
   const groups=roflEnvelope(response.bytes);if(!groups.length)throw Error('Empty tile envelope');
   let datasets=0,failed=false;const seen=new Set();
   for(const group of groups){if(group.xyz.join(',')!==xyz.join(','))throw Error('Unexpected tile coordinates');for(const dataset of group.datasets){
    const datasetKey=`${group.xyz}/${dataset.region}/${dataset.meta}/${dataset.detail}/${dataset.name}`;if(seen.has(datasetKey))continue;seen.add(datasetKey);
    try{const meta=await metadata(dataset.meta);const decoded=decodeROFL(dataset.data,meta,group.xyz,`${dataset.region}:${dataset.name}:${dataset.detail}`);datasets++;for(const record of decoded.records){signal?.throwIfAborted();const part=await buildingPart(record,bbox);if(part){const fragmentId=await digest(JSON.stringify(part.geometry));records.set(`${part.id}:${fragmentId}`,part);}}}catch{signal?.throwIfAborted();failed=true;invalidate(tileUrl);if(/^[A-Za-z0-9+/=]{1,128}$/.test(dataset.meta))invalidate(metaUrl(dataset.meta));warnings.add('2gis_dataset_decode_failed');}
   }}
   if(datasets&&!failed)result.coverage.decodedTiles++;else warnings.add('2gis_tile_decode_incomplete');
  }catch{if(signal?.aborted)throw signal.reason||Error('Aborted');invalidate(tileUrl);warnings.add('2gis_tile_unavailable');}}};
  await Promise.all([worker(),worker()]);return finish();
 };
}
