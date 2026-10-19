/** Experimental independent decoder of the ROFL v4 layout observed in supplied 2GIS tiles.
 * This module does not execute or redistribute the map renderer. Unsupported layouts fail closed. */
// Kept local: the height adapter needs no renderer, model assets, or full engine.
const dec = new TextDecoder('utf-8', {fatal:true});
function check(ok,message){if(!ok)throw new Error(message);}
function eachField(bytes,fn){
 let offset=0;const varint=()=>{let value=0n;for(let shift=0n;shift<70n;shift+=7n){check(offset<bytes.length,'Truncated protobuf');const b=bytes[offset++];value|=BigInt(b&127)<<shift;if(b<128)return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value.toString();}throw Error('Invalid protobuf varint');};
 while(offset<bytes.length){const tag=varint();check(Number.isSafeInteger(tag)&&tag>=8,'Invalid protobuf tag');const wire=tag&7;let value;if(wire===0)value=varint();else {const length=wire===1?8:wire===5?4:wire===2?varint():-1;check(Number.isSafeInteger(length)&&length>=0&&offset+length<=bytes.length,'Invalid protobuf length');value=bytes.subarray(offset,offset+length);offset+=length;}fn(tag>>3,wire,value);}
}
function fields(b){const a=[];eachField(b,(f,w,v)=>a.push([f,w,v]));return a}
const MAPSIZE=32768;
const ENUMS={Class:'db_class',DisputePosition:'db_dispute_position',ObjectClass:'db_object_class',ParkingType:'db_parking_type',Sublayer:'db_sublayer',Subsublayer:'db_subsublayer',Icon:'db_icon',GeometryType:'db_geometry_type',ModelType:'db_model_type',RoadSupportTypes:'tech_db_road_support_type',RoadMarkingColorType:'db_road_marking_color_type',PoiCategory:'L1_Poi_category',RoadPart:'db_road_part',TriangulationMethod:'db_triangulation_method',RequireAbsZFromReliefSurface:'db_require_abs_z_from_relief_surface',TouristRouteColor:'db_tourist_route_color',TouristRouteSportTrackType:'db_tourist_route_sport_track_type',TouristRouteType:'db_tourist_route_type'};
class Reader{
 constructor(bytes){this.b=bytes;this.v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);this.i=0}
 align(n){this.i=Math.ceil(this.i/n)*n;this.bound(0)}
 bound(n){check(this.i+n<=this.b.length,'ROFL: данные обрезаны')}
 scalar(type){const specs={u8:[1,'getUint8'],i8:[1,'getInt8'],u16:[2,'getUint16'],i16:[2,'getInt16'],u32:[4,'getUint32'],i32:[4,'getInt32'],f32:[4,'getFloat32']};const [size,fn]=specs[type];this.bound(size);const r=this.v[fn](this.i,true);this.i+=size;return r}
 bytes(n){check(n>=0&&Number.isInteger(n),'ROFL: неверная длина');this.bound(n);const a=this.b.slice(this.i,this.i+n);this.i+=n;return a}
 array(type,n,delta=false){check(n>=0&&n<=5e6,'ROFL: слишком большой поток');const sizes={u8:1,i8:1,u16:2,i16:2,u32:4,i32:4,f32:4};const bits=sizes[type]*8;this.align(sizes[type]);const out=[];let last=0;for(let i=0;i<n;i++){let v=this.scalar(type);if(delta){v+=last;if(type[0]==='u')v=bits===32?v>>>0:((v%2**bits)+2**bits)%2**bits;else if(type[0]==='i')v=bits===32?v|0:((v+2**(bits-1))%2**bits+2**bits)%2**bits-2**(bits-1);last=v}out.push(v)}return out}
 stream(type,n){
 const map={2:['u8',false],3:['u8',true],4:['u16',false],5:['u16',true],6:['u32',false],7:['u32',true],10:['u8',false],13:['i8',false],14:['i8',true],15:['i16',false],16:['i16',true],17:['i32',false],18:['i32',true],25:['u32',false]};
 if(map[type])return this.array(map[type][0],n,map[type][1]);
 if([8,9,19,20].includes(type)){this.align(8);const out=[];let last=0n;for(let i=0;i<n;i++){const lo=this.scalar('u32'),hi=this.scalar('u32');let v=BigInt(lo)+(BigInt(hi)<<32n);if(type===9||type===20){v=BigInt.asUintN(64,v+last);last=v}if(type===19||type===20)v=BigInt.asIntN(64,v);out.push(v.toString())}return out}
 if(type===11){const lens=this.array('u8',n),out=[];for(let l of lens){if(l===255)l=this.scalar('u8')+this.scalar('u8')*256+this.scalar('u8')*65536;out.push(this.bytes(l))}return out}
 if(type===12){const lens=this.array('u32',n),out=[];for(const l of lens){this.align(8);out.push(this.bytes(l))}return out}
 if([21,22,23,24].includes(type)){const signed=type>=23;return this.array(signed?'i32':'u32',n,type%2===0).map(x=>x/1000)}
 throw new Error(`ROFL: неподдерживаемый тип потока ${type}`)
 }
}
function hashName(b){return btoa(String.fromCharCode(...b))}
export function roflEnvelope(bytes){const groups=[];for(const [f,w,b] of fields(bytes)){if(f!==1||w!==2)continue;const q={xyz:[0,0,0],datasets:[]};for(const [ff,ww,v] of fields(b)){if(ff>=1&&ff<=3)q.xyz[ff-1]=Number(v);else if(ff===4){const d={};for(const [k,wire,val] of fields(v)){if(k===1)d.region=Number(val);else if(k===2)d.meta=hashName(val);else if(k===3)d.data=val;else if(k===4)d.detail=Number(val);else if(k===5)d.name=dec.decode(val)}q.datasets.push(d)}}groups.push(q)}return groups}
function prepareMeta(meta){const reverse={};for(const [name,vals] of Object.entries(meta.enumerationValues||{})){const key=ENUMS[name]||name;reverse[key]=Object.fromEntries(Object.entries(vals).map(([k,v])=>[String(v),k]))}return reverse}
function decodeAttribute(raw,key,rev){if(raw instanceof Uint8Array){if(key==='db_tiers'){check(raw.length%4===0,'ROFL db_tiers length');const dv=new DataView(raw.buffer,raw.byteOffset,raw.length);return Array.from({length:raw.length/4},(_,i)=>dv.getInt32(i*4,true))}try{return dec.decode(raw)}catch{return {binaryBytes:raw.length}}}return rev[key]?.[String(raw)]??raw}
export function tilePoint2gis(x,y,xyz){const [tx,ty,z]=xyz,n=2**z,wx=(tx+x/MAPSIZE)/n,wy=(ty+y/MAPSIZE)/n;return [wx*360-180,Math.atan(Math.sinh((wy-.5)*2*Math.PI))*180/Math.PI]}
export function decodeROFL(bytes,meta,xyz,source){
 const r=new Reader(bytes);check(r.scalar('u32')===1279676242,'Не ROFL');const version=r.scalar('u16');check(version===4,`ROFL v${version} пока не поддерживается`);r.scalar('u16');const ng=r.scalar('u32');check(ng<100000,'ROFL: много групп');const descriptors=[];
 for(let g=0;g<ng;g++){const attrs=[],verts=[];const na=r.scalar('u8');for(let j=0;j<na;j++)attrs.push([r.scalar('u8'),r.scalar('u8')]);const nv=r.scalar('u8');for(let j=0;j<nv;j++)verts.push([r.scalar('u8'),r.scalar('u8')]);descriptors.push({attrs,verts})}
 r.align(4);const ns=r.scalar('u32');check(ns<=256,'ROFL: много потоков');const types=r.array('u8',ns),lengths=r.array('u32',ns),streams=[];for(let i=0;i<ns;i++)streams.push(r.stream(types[i],lengths[i]));const cursor=Array(ns).fill(0),count=r.array('i32',ng),n=count.reduce((a,b)=>a+b,0);check(n>=0&&n<=200000,'ROFL: много объектов');const changes=r.array('u8',n,true),changeIds=r.array('u8',changes.reduce((a,b)=>a+b,0),true),clears=r.array('u8',n,true),clearIds=r.array('u8',clears.reduce((a,b)=>a+b,0),true),vertices=r.array('u16',n,true);
 const reverse=prepareMeta(meta),records=[];let feature=0,ch=0,clear=0;
 function take(s,count=1){check(s<streams.length,'ROFL: индекс потока');const i=cursor[s];check(i+count<=streams[s].length,'ROFL: переполнение потока');cursor[s]+=count;return count===1?streams[s][i]:streams[s].slice(i,i+count)}
 for(let group=0;group<ng;group++){const d=descriptors[group],a={};for(let row=0;row<count[group];row++,feature++){
   for(let j=0;j<changes[feature];j++){const idx=changeIds[ch++];check(idx<d.attrs.length,'ROFL: индекс атрибута');const [prop,stream]=d.attrs[idx],key=meta.tileProps[prop];check(key,'ROFL: метатайл не соответствует атрибутам');a[key]=decodeAttribute(take(stream),key,reverse)}
   for(let j=0;j<clears[feature];j++){const idx=clearIds[clear++];check(idx<d.attrs.length,'ROFL: индекс сброса');delete a[meta.tileProps[d.attrs[idx][0]]]}
   const countVertices=vertices[feature],v={};for(const [vi,s] of d.verts){const key=meta.vertexProps[vi];check(key,'ROFL: метатайл не соответствует каналам вершин');v[key]=countVertices===0?[]:countVertices===1?[take(s)]:take(s,countVertices)}
   if(!countVertices)continue;check(v.x?.length===countVertices&&v.y?.length===countVertices,'ROFL: нет XY');const gt=a.db_geometry_type;check(['point','polyline','polygon'].includes(gt),'ROFL: неизвестная геометрия');const pts=Array.from({length:countVertices},(_,i)=>tilePoint2gis(v.x[i],v.y[i],xyz));const out=gt==='polygon'?pts.map((_,i)=>pts[i===0?0:Math.min(2*i-1,2*(countVertices-i))]):pts;
   records.push({layer:a.db_sublayer||'unknown',id:String(a.db_id??`${group}-${row}`),attrs:{...a},type:gt,coordinates:out,vertexChannels:v,sourceTile:xyz,sourceDataset:source});
 }}
 const unconsumed=cursor.map((v,i)=>lengths[i]-v);check(unconsumed.every(x=>x===0),'ROFL: часть потоков не прочитана: '+unconsumed.filter(Boolean).join(','));check(r.i<=bytes.length&&bytes.length-r.i<4,'ROFL: хвост данных не разобран');return {records,stats:{version,groups:ng,streams:ns,features:n,renderable:records.length,bytes:bytes.length,tail:bytes.length-r.i}};
}
