/* Polygon identities and observations shared by the source merge path. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/polygon-clipping.umd.min.js'));
  else root.BuildingHeightSources = factory(root.polygonClipping);
})(typeof globalThis === 'object' ? globalThis : this, function(clipping) {
  'use strict';
  function recordKey(record) {
    return JSON.stringify([record.sourceId || '', String(record.sourceRecordId || record.id || record.sourceFeatureId || ''), String(record.sourceFeatureId || ''), String(record.sourcePartId || ''), String(record.rawHeight ?? '')]);
  }
  function geometry(record) {
    if (record.geometry?.type === 'Polygon') return [record.geometry.coordinates];
    if (record.geometry?.type === 'MultiPolygon') return record.geometry.coordinates;
    return record.footprint?.length ? [[record.footprint.map(([lat,lng]) => [lng,lat])]] : null;
  }
  function ringArea(ring) {
    // Translate before multiplication to avoid cancellation for tiny WGS84 footprints.
    const [x,y] = ring[0]; let area = 0;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) area += (ring[j][0]-x)*(ring[i][1]-y)-(ring[i][0]-x)*(ring[j][1]-y);
    return Math.abs(area)/2;
  }
  function area(multi) { return multi.reduce((sum,polygon)=>sum + Math.max(0,ringArea(polygon[0])-polygon.slice(1).reduce((a,r)=>a+ringArea(r),0)),0); }
  function extent(multi) {
    const points=multi.flat(2);
    return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  }
  function findMatch(buildings, record) {
    const key=recordKey(record);
    const identity=buildings.find(b=>b.sourceId && recordKey(b)===key || (b.sourceRecordKeys||[]).includes(key));
    if(identity) return identity;
    if(record.cadastralNumber) { const b=buildings.find(b=>b.cadastralNumber===record.cadastralNumber); if(b)return b; }
    if(record.osmId) { const b=buildings.find(b=>b.osmId===record.osmId); if(b)return b; }
    const incoming=geometry(record); if(!incoming)return null;
    const incomingArea=area(incoming); if(!incomingArea)return null;
    const box=extent(incoming); const matches=[];
    for(const b of buildings) {
      // Different parts from one provider remain separate objects, even when nested.
      if(b.sourceId===record.sourceId && ((b.sourcePartId && record.sourcePartId && b.sourcePartId!==record.sourcePartId) || (b.rawHeight != null && record.rawHeight != null && String(b.rawHeight)!==String(record.rawHeight))))continue;
      // An OSM object can hold one provider part; a second part keeps its own footprint.
      if((b.heightObservations||[]).some(o=>o.sourceId===record.sourceId && o.sourcePartId && record.sourcePartId && o.sourcePartId!==record.sourcePartId || o.sourceId===record.sourceId && o.rawHeight!=null && record.rawHeight!=null && String(o.rawHeight)!==String(record.rawHeight)))continue;
      const candidate=geometry(b); if(!candidate)continue;
      const other=extent(candidate);
      if(box[0]>=other[2]||box[2]<=other[0]||box[1]>=other[3]||box[3]<=other[1])continue;
      try {
        const intersection=area(clipping.intersection(incoming,candidate));
        const candidateArea=area(candidate);
        const iou=intersection/(incomingArea+candidateArea-intersection);
        // Most of BOTH footprints must overlap: a 60% height part cannot paint an entire OSM building.
        const mutualOverlap=intersection/Math.max(incomingArea,candidateArea);
        if(mutualOverlap>=0.85) matches.push({b,score:iou});
      } catch { /* Invalid contours stay separate rather than contaminating a neighbor. */ }
    }
    matches.sort((a,b)=>b.score-a.score);
    return matches.length && (matches.length===1 || matches[0].score-matches[1].score>=0.15) ? matches[0].b : null;
  }
  function observeHeight(building,record,source) {
    building.heightObservations ||= [];
    if(!building.heightObservations.length && Number.isFinite(building.heightMeters)) building.heightObservations.push({key:'original',sourceId:building.sourceId || 'osm',source:building.heightSource || 'OSM',heightMeters:building.heightMeters,heightDerived:building.heightDerived===true});
    if(Number.isFinite(record.heightMeters)) {
      const observation={key:recordKey({...record,sourceId:source.id}),sourceId:source.id,source:source.title,sourceRecordId:record.sourceRecordId || record.id,sourceFeatureId:record.sourceFeatureId,sourcePartId:record.sourcePartId,heightMeters:record.heightMeters,heightDerived:record.heightDerived===true,rawHeight:record.rawHeight};
      const index=building.heightObservations.findIndex(o=>o.key===observation.key);
      if(index<0)building.heightObservations.push(observation); else building.heightObservations[index]=observation;
    }
    building.heightConflicts=building.heightObservations.filter(o=>!o.heightDerived && Number.isFinite(building.heightMeters) && Math.abs(o.heightMeters-building.heightMeters)>1);
  }
  return {recordKey,findMatch,observeHeight};
});
