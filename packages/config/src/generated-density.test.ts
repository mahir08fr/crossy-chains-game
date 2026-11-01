import { expect, it } from 'vitest';
import { generateSection, groupEnvelope, groupScenario, generatedScenario, sectionCenter, generatedSettings, vehicleColor, hazardHalfDepth, roadLanes, sectionBoxes, sectionReason, validateArrangement, generationDiagnostics, resetGenerationDiagnostics } from './index.js';
const seeds=[1,42,20261016,...Array.from({length:16},(_,i)=>Math.imul(i+37,2654435761)>>>0)];
// Seed enumeration is a correctness check; allow slower development machines.
it('one protected spawn supports the entire four-seat formation and never recurs in forward terrain',()=>{
 for(const seed of seeds){
  const sections=Array.from({length:1001},(_,i)=>generateSection(seed,i));
  expect(sections.filter(s=>sectionReason(s)==='spawn')).toHaveLength(1);
  const start=sections[0]!;expect(start).toMatchObject({type:'grass',start:-7,length:14,halfWidth:10});
  expect(sectionBoxes(start).some(b=>b.id.endsWith('/spawn-rear'))).toBe(true);
  for(const p of groupScenario(generatedScenario,4).players){expect(Math.abs(p.spawn.x)+.35).toBeLessThan(9.7);expect(p.spawn.z).toBeGreaterThan(start.start);expect(p.spawn.z).toBeLessThan(start.start+start.length);}
  expect(groupEnvelope(4)).toBeLessThan(19.4);
  for(const s of sections.slice(1)){expect(sectionBoxes(s).some(b=>b.id.endsWith('/spawn-rear'))).toBe(false);if(s.type!=='grass')expect(s.start+s.length/2-hazardHalfDepth(s)).toBeGreaterThan(start.start+start.length);}
 }
}, 15000);
it.each(([2,3,4] as const).flatMap(capacity=>seeds.map(seed=>[capacity,seed] as const)))('density %i seats seed %i: bounded lanes, dry strips and regroup reasons',(capacity,seed)=>{
  const sections=Array.from({length:1001},(_,i)=>generateSection(seed,i,capacity));expect(validateArrangement(sections,capacity)).toEqual([]);
  const body=sections.slice(1),roads=body.filter(s=>s.type==='road'),hazards=body.filter(s=>s.type!=='grass');
  expect(new Set(roads.map(s=>roadLanes(s).length))).toEqual(new Set([2,3,4,5]));
  const occupied=hazards.reduce((n,s)=>n+(s.type==='road'?roadLanes(s).length*1.6:s.type==='river'?5:3),0)/body.reduce((n,s)=>n+s.length,0);
  expect(occupied).toBeGreaterThan(.63);expect(occupied).toBeLessThan(.72);
  expect(body.filter(s=>sectionReason(s)==='fallback')).toHaveLength(0);
  expect(body.filter(s=>s.type==='grass').every(s=>s.index%24===0&&sectionReason(s)==='regroup')).toBe(true);
  for(let i=1;i<hazards.length;i++){
   const a=hazards[i-1]!,b=hazards[i]!;if(b.index===a.index+1)expect(a.type==='railway'&&b.type==='railway').toBe(false);
   const dry=sectionCenter(b)-hazardHalfDepth(b)-(sectionCenter(a)+hazardHalfDepth(a));expect(dry).toBeGreaterThanOrEqual(1.59);
   if(b.index===a.index+1&&a.type==='road'&&b.type==='road')expect(dry).toBeLessThanOrEqual(4.81);
   if(b.index===a.index+1)expect(dry).toBeLessThanOrEqual(5);
  }
});
it('lanes have independent seeded clocks and preserve collision clearance and opposing directions',()=>{
 for(const seed of seeds)for(let index=1;index<100;index++){
  const s=generateSection(seed,index);if(s.type!=='road')continue;
  const lanes=roadLanes(s);
  expect(new Set(lanes.map(l=>l.positions[1]!/l.speed)).size).toBe(lanes.length);
  expect(new Set(lanes.map(l=>l.offset/l.speed)).size).toBe(lanes.length);
  for(const l of lanes){expect([3,4,5]).toContain(l.positions.length);expect(Math.abs(l.z-sectionCenter(s))+.688).toBeLessThanOrEqual(hazardHalfDepth(s)+1e-8);}
  for(let i=1;i<lanes.length;i++){expect(lanes[i]!.z-lanes[i-1]!.z).toBeCloseTo(1.6,9);expect(lanes[i]!.direction).toBe(-lanes[i-1]!.direction);}
 }
});
it('injected generation rejection remains bounded and reuses a validated compact fallback',()=>{
 resetGenerationDiagnostics();let attempts=0;const s=generateSection(1,1,4,s=>{attempts++;return {...s,speed:100};});
 expect(attempts).toBe(4);expect(generationDiagnostics.fallbacks).toBe(1);expect(generationDiagnostics.rejections).toBe(4);expect(s.length).toBe(9.6);expect(s.type).not.toBe('grass');
});

it('seeded colors stay fixed within each lane over spawn cycles; speeds, directions, dimensions and offscreen wraps are shared',()=>{
 const colors=new Set<number>(),speeds=new Set<number>(),directions=new Set<number>();
 for(const seed of seeds)for(let i=1;i<60;i++){
  const s=generateSection(seed,i);if(s.type!=='road')continue;
  for(const [j,l] of roadLanes(s).entries()){
   speeds.add(l.speed);directions.add(l.direction);expect(l.scale).toBe(.8);
   expect(l.period/2-1.77*l.scale).toBeGreaterThan(10);
   const laneColors=new Set<number>();for(let cycle=0;cycle<12;cycle++){
    const c=vehicleColor(s,j,cycle*l.period/l.speed);colors.add(c);laneColors.add(c);
    expect(c).toBe(vehicleColor(structuredClone(s),j,cycle*l.period/l.speed));
   }expect(laneColors.size).toBe(1);
  }
 }
 expect(colors.size).toBe(generatedSettings.colors.length);expect(speeds).toEqual(new Set(generatedSettings.laneSpeeds));expect(directions).toEqual(new Set([-1,1]));
});
