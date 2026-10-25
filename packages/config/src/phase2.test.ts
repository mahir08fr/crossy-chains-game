import {expect,it} from 'vitest';
import {generateSection,sectionStart,sectionIndex,sectionLength,sectionCenter,sectionBoxes,hazardHalfDepth,transitionMinimum,terrainWeights,validateArrangement,validateSection,roadLanes,resetGenerationDiagnostics,generationDiagnostics,settings,railwaySettings,riverSettings} from './index.js';
it('v4 compact random-access grid is exact at large and negative coordinates',()=>{
 for(const i of [-5,-1,0,1,2,3,24,999,1000000]){
  expect(sectionIndex(sectionStart(i)+.001)).toBe(i);
  expect(sectionStart(i)+sectionLength(i)).toBeCloseTo(sectionStart(i+1),7);
 }
});
it('tier weights are explicit, bounded and increase water/rail selection without changing speeds',()=>{
 expect(terrainWeights.map(w=>w.broadRoad+w.broadRiver)).toEqual([100,100,100,100]);
 expect(terrainWeights.map(w=>w.compactRailway+w.compactRoad)).toEqual([100,100,100,100]);
 expect(settings.player.speed).toBe(7.5*.85);expect(railwaySettings.speed).toBe(35);expect(railwaySettings.cycleSeconds).toBe(7);expect(railwaySettings.warningSeconds).toBe(3);
 expect(riverSettings.exposureSeconds).toBe(8);expect(riverSettings.recoverySeconds).toBe(1);
 for(let tier=0;tier<4;tier++){
  const s=Array.from({length:1000},(_,i)=>generateSection(20261016,i+1,4,undefined,tier));
  const n=(type:string)=>s.filter(x=>x.type===type).length;
  expect(n('river')).toBeGreaterThan(110);expect(n('railway')).toBeGreaterThan(180);expect(n('road')).toBeGreaterThan(350);
  expect(n('grass')).toBe(41);expect(validateArrangement(s,4)).toEqual([]);
 }
});
it('mixed sequence transitions preserve level strips, river geometry and independent road lanes',()=>{
 const pairs=new Set<string>();
 for(const seed of [1,42,20261016]){
  const s=Array.from({length:200},(_,i)=>generateSection(seed,i));
  for(let i=1;i<s.length;i++){
   const a=s[i-1]!,b=s[i]!;if(a.type==='grass'||b.type==='grass')continue;
   pairs.add(`${a.type}->${b.type}`);
   const gap=sectionCenter(b)-hazardHalfDepth(b)-sectionCenter(a)-hazardHalfDepth(a);
   expect(gap+1e-8).toBeGreaterThanOrEqual(transitionMinimum(a,b));
   expect(gap).toBeLessThan(5);
   for(const section of [a,b])for(const box of sectionBoxes(section))expect(box.halfSize.z).toBeGreaterThan(0);
   if(a.type==='road'&&b.type==='road')expect(roadLanes(b)[0]!.z-roadLanes(a).at(-1)!.z).toBeGreaterThan(1.6);
  }
 }
 for(const pair of ['road->road','road->river','river->road','road->railway','railway->road','river->railway','railway->river','river->river'])expect(pairs.has(pair),pair).toBe(true);
 const rail=Array.from({length:100},(_,i)=>generateSection(42,i)).find(s=>s.type==='railway')!;
 expect(transitionMinimum(rail,rail)).toBe(Infinity);
 expect(validateSection({...rail,type:'river'},4)).toContain('hazard-cell-fit');
});
it('bounded rejection records reasons and compact fallback never produces repeated grass',()=>{
 resetGenerationDiagnostics();let calls=0;
 const s=Array.from({length:23},(_,i)=>generateSection(42,i+1,4,x=>{calls++;return {...x,halfWidth:1};}));
 expect(calls).toBe(92);expect(generationDiagnostics.fallbacks).toBe(23);expect(generationDiagnostics.rejections).toBe(92);
 expect(generationDiagnostics.reasons['group-clearance']).toBe(92);
 expect(s.every(x=>x.type!=='grass')).toBe(true);expect(validateArrangement(s,4)).toEqual([]);
});
