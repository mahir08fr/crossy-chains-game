import { riverLayout } from './river-layout.js';
import type { RiverLayout } from './river-layout.js';
import { difficultyTiers } from './endless.js';
import { riverScenario, riverSettings, railwaySettings, settings } from './index.js';
import type { CourseBox, GroupSize, Scenario } from './index.js';

export const generatorVersion = 4 as const;
export const streamingSettings = { ahead: 80, behind: 48, contactMargin: 4, stride: 8, maxSections: 24 } as const;
// Phase 1.1: the previous medium base (3.5) × 1.5; immutable lane profiles.
export const trafficBaseSpeed = 3.5;
export const trafficMovementScale = 1.5;
export const trafficCrossingSpeed = 6; // conservative below measured dry solo speed
export const trafficProfiles = [
  { name: 'Yellow', color: 0xd6a347, multiplier: 1 },
  { name: 'Purple', color: 0xa478bf, multiplier: 1.2 },
  { name: 'Red', color: 0xc95345, multiplier: 4/3 },
  { name: 'Blue', color: 0x428dbb, multiplier: 1.6 },
  { name: 'Copper', color: 0xb87333, multiplier: 1.6 },
] as const;
export const generatedSettings = { rowDepth: 1.6, lanePitch: 1.6, carScale: .8, grassColor: 0x64998b,
  laneSpeeds: trafficProfiles.map(p => trafficBaseSpeed * trafficMovementScale * p.multiplier), rearDistance: 7, rearClearance: 1, rearSpeed: 6,
  colors: trafficProfiles.map(p => p.color) } as const;
// Three-cell modules total 24 m: two broad crossings and a compact crossing.
// Every eighth module ends in a shorter 3.2m regroup (190.4m per 24 cells).
// Index-only integer geometry keeps random access and compact snapshots bounded.
export function sectionLength(index: number): number { return index <= 0 ? 14 : index%24===0 ? 3.2 : index%3===0 ? 4.8 : 9.6; }
export function sectionStart(index: number): number {
  if(index<=0)return index*14-7;
  const n=index-1;return (70+Math.floor(n/3)*240+(n%3)*96-Math.floor(n/24)*16)/10;
}
export function sectionCenter(s: WorldSection): number { return s.start+s.length/2; }
export function sectionIndex(z: number): number {
  if(z<7)return Math.min(0,Math.floor((z+7)/14));
  let i=Math.floor((z-7)*15/119)+1;
  while(sectionStart(i)>z)i--;while(sectionStart(i+1)<=z)i++;return i;
}
/** Exact selection weights (percent), applied to counter-hash buckets. Geometry
 * constrains short cells to two lanes/rail; broad cells retain original rivers. */
export const terrainWeights = [
  {broadRoad:78,broadRiver:22,compactRailway:70,compactRoad:30},
  {broadRoad:76,broadRiver:24,compactRailway:75,compactRoad:25},
  {broadRoad:74,broadRiver:26,compactRailway:80,compactRoad:20},
  {broadRoad:72,broadRiver:28,compactRailway:80,compactRoad:20},
] as const;
export const generationDiagnostics = { attempts:0, rejections:0, fallbacks:0, reasons:{} as Record<string,number> };
export function resetGenerationDiagnostics(): void {
  generationDiagnostics.attempts=0;generationDiagnostics.rejections=0;generationDiagnostics.fallbacks=0;
  generationDiagnostics.reasons={};
}
/** Shared modulo used by authority and lossless compact slot reconstruction. */
export function wrapTrafficX(x: number, period: number): number {
  return ((x+period/2)%period+period)%period-period/2;
}
/** Fixed for the entire lane lifetime, independent of time/slot/recycle. */
export function vehicleColor(s: WorldSection, lane: number, _time = 0, _slot = 0): number {
  return (random(Number(s.id.split(':')[1]),s.index,901)+lane)%trafficProfiles.length;
}
export type SectionType = 'grass' | 'road' | 'river' | 'railway';
export type WorldSection = {
  id: string; index: number; type: SectionType; start: number; length: number; halfWidth: number;
  speed: number; direction: number; offset: number; safeSeconds: number; difficultyTier: number; river?: RiverLayout;
};
export type WorldLayout = { version: typeof generatorVersion; seed: number; sections: WorldSection[] };
/** Counter-based integer PRNG: no growing history/cache, no uncontrolled randomness. */
function random(seed: number, index: number, attempt: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b9) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  return (x ^ x >>> 16) >>> 0;
}
export function groupEnvelope(capacity: GroupSize): number {
  return (capacity - 1) * settings.chain.length + 2 * settings.player.radius;
}
/** Necessary conservative envelope/timing rules, not a proof of physical reachability. */
export function validateSection(s: WorldSection, capacity: GroupSize): string[] {
  const errors: string[] = [], envelope = groupEnvelope(capacity);
  if (!Number.isInteger(s.difficultyTier) || s.difficultyTier < 0 || s.difficultyTier >= difficultyTiers.length) return ['difficulty'];
  if (!Number.isSafeInteger(s.index) || !Number.isFinite(s.start) || s.start !== sectionStart(s.index) || s.length !== sectionLength(s.index)) errors.push('section-grid');
  if (s.halfWidth !== 10 || s.halfWidth * 2 - 0.6 < envelope) errors.push('group-clearance');
  if (!['grass','road','river','railway'].includes(s.type)) errors.push('type');
  if(s.type==='river'&&s.length<8.0 || s.type==='railway'&&s.length>6)errors.push('hazard-cell-fit');
  if ((s.index <= 0 || s.index % 24 === 0) && s.type !== 'grass') errors.push('regrouping-required');
  if (![s.speed,s.direction,s.offset,s.safeSeconds].every(Number.isFinite) || ![-1,1].includes(s.direction) || s.speed<0 || s.speed>railwaySettings.speed || Math.abs(s.offset)>18 || (s.type==='railway' ? s.safeSeconds!==railwaySettings.safeSeconds : s.safeSeconds<20 || s.safeSeconds>22)) errors.push('parameters');
  // Lateral full-stretch envelope retained. Faster dry drive is validated at
  // 6 m/s with 0.5 s acceleration/stop allowance; geometry stays unchanged.
  const laneDuration=.5+(generatedSettings.lanePitch+2*settings.player.radius)/trafficCrossingSpeed;
  if (s.type === 'road' && errors.length === 0 && roadLanes(s).some(l => l.period/2 - 1.77*l.scale <= 10 || l.maxHeadway-(envelope+2.832)/l.speed < laneDuration+.75-1e-8)) errors.push('road-window');
  if (s.type === 'road' && (s.speed < 2.5 || s.speed > 4.5)) errors.push('road-window');
  if (s.type === 'river' && (5 / (riverSettings.speed / (1 + riverSettings.drag * settings.player.responseSeconds)) + 2 >= riverSettings.exposureSeconds)) errors.push('river-budget');
  // Actual full-consist corridor occupancy, not offscreen transit, bounds the
  // crossing opportunity. A conservative longitudinal full-group bound fits.
  const front=Math.max(...railwaySettings.modules.map(m=>m.offset+m.length/2));
  const tail=Math.min(...railwaySettings.modules.map(m=>m.offset-m.length/2));
  const occupancy=(2*(railwaySettings.halfWidth+settings.player.radius)+front-tail)/railwaySettings.speed;
  if (s.type === 'railway' && (s.speed !== railwaySettings.speed || s.safeSeconds !== railwaySettings.safeSeconds || railwaySettings.cycleSeconds-occupancy < (envelope+3)/trafficCrossingSpeed+.5)) errors.push('railway-window');
  return errors;
}
/** Includes river slopes; surface occupancy surveys count water separately. */
export function hazardHalfDepth(s: WorldSection): number { return s.type==='road'?roadLanes(s).length*generatedSettings.lanePitch/2:s.type==='river'?4:s.type==='railway'?1.5:0; }
/** Explicit pair rules: all mixed pairs have level waiting/recovery support.
 * Independent adjacent tracks are withheld: a short road/regroup must intervene. */
export function transitionMinimum(a: WorldSection, b: WorldSection): number {
  if(a.type==='grass'||b.type==='grass')return 0;
  if(a.type==='railway'&&b.type==='railway')return Infinity;
  return 1.6; // one compact row, fits 0.7m capsule + 0.6m stagger + margins
}
export function validateArrangement(sections: WorldSection[], capacity: GroupSize): string[] {
  return sections.flatMap((s,i) => {
    const previous=sections[i-1];
    const dry=previous?sectionCenter(s)-hazardHalfDepth(s)-sectionCenter(previous)-hazardHalfDepth(previous):Infinity;
    return [ ...validateSection(s, capacity).map(e => `${s.id}:${e}`),
      ...(previous && Math.abs(previous.start+previous.length-s.start)>1e-8 ? [`${s.id}:gap-or-overlap`] : []),
      ...(previous && dry<transitionMinimum(previous,s)-1e-8 ? [`${s.id}:transition-waiting`] : []),
      ...(s.type === 'road' && roadLanes(s).some(l => Math.abs(l.z-sectionCenter(s))+.688>hazardHalfDepth(s)+1e-8) ? [`${s.id}:lane-band`] : []),
    ];
  });
}
export function generateSection(seed: number, index: number, capacity: GroupSize = 4,
  candidate?: (s: WorldSection, attempt: number) => WorldSection, difficultyTier = 0): WorldSection {
  if (!Number.isInteger(difficultyTier) || difficultyTier < 0 || difficultyTier >= difficultyTiers.length) throw new Error('Invalid difficulty');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(index)) throw new Error('Invalid world seed/index');
  const base: WorldSection = { id: `v4:${seed}:${index}`, index, type: 'grass', start: sectionStart(index), length: sectionLength(index), halfWidth: 10, speed: 0, direction: 1, offset: 0, safeSeconds: 20, difficultyTier };
  let safeCandidate:WorldSection|undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    generationDiagnostics.attempts++;
    const r = random(seed,index,attempt), weights=terrainWeights[difficultyTier]!;
    const type:SectionType=index<=0||index%24===0?'grass':
      index%3===0?(r%100<weights.compactRailway?'railway':'road'):
      (r%100<weights.broadRoad?'road':'river');
    const s:WorldSection={...base,type,direction:r&8?1:-1,speed:2.5+(r%6)/10,offset:(r%360)/10-18,safeSeconds:20+r%3};
    if(type==='railway'){s.speed=railwaySettings.speed;s.safeSeconds=railwaySettings.safeSeconds;}
    if(!safeCandidate&&validateSection(s,capacity).length===0)safeCandidate=s;
    const chosen=candidate?candidate(s,attempt):s;
    const errors=validateSection(chosen,capacity);
    if(chosen.id!==base.id||chosen.index!==index||chosen.difficultyTier!==difficultyTier)errors.push('identity');
    if(errors.length===0)return chosen.type==='river'?{...chosen,river:riverLayout(chosen)}:chosen;
    generationDiagnostics.rejections++;
    for(const reason of errors)generationDiagnostics.reasons[reason]=(generationDiagnostics.reasons[reason]??0)+1;
  }
  generationDiagnostics.fallbacks++;
  // Rejected custom recipes reuse a validated compact recipe, never a chain of
  // empty grass cells. Stop loudly if the built-in feasibility rules conflict.
  if(safeCandidate)return safeCandidate.type==='river'?{...safeCandidate,river:riverLayout(safeCandidate)}:safeCandidate;
  throw new Error(`No feasible compact section: ${base.id}`);
}
/** Three-to-five offscreen-recycled slots per lane, near-regular bounded headways and seeded
 * lane phases. Pure counter-based construction: loading order never changes traffic. */
export const generatedCarsPerLane = 5; // maximum; each recipe owns 3–5 slots
type GeneratedLane = {z:number;speed:number;direction:number;offset:number;period:number;scale:number;positions:number[];minHeadway:number;maxHeadway:number;cycle:number;phaseTrials:number;balanced:boolean};
const laneCache = new Map<string, GeneratedLane[]>();
/** Exact interval intersection for a conservative full-envelope straight crossing.
 * This validates an opportunity, not arbitrary tangled formations or human timing. */
function hasCrossingWindow(lanes: GeneratedLane[]): boolean {
  let windows: [number,number][]=[[0,45]];
  for(const l of lanes){
    const shift=(l.z-lanes[0]!.z)/trafficCrossingSpeed, duration=.5+(1.6+2*settings.player.radius)/trafficCrossingSpeed;
    const half=groupEnvelope(4)/2+1.77*l.scale, velocity=l.speed*l.direction;
    for(const position of l.positions){
      const origin=l.offset+position+velocity*shift;
      const travel=velocity*duration;
      const low=-half-Math.max(0,travel), high=half-Math.min(0,travel);
      const range=[origin,origin+velocity*45];
      const first=Math.ceil((Math.min(...range)-high)/l.period),last=Math.floor((Math.max(...range)-low)/l.period);
      for(let pass=first;pass<=last;pass++){
        const a=(low+pass*l.period-origin)/velocity,b=(high+pass*l.period-origin)/velocity;
        const start=Math.min(a,b),end=Math.max(a,b);
        // Preserve subtraction/order exactly, without allocating arrays for
        // every unaffected interval on every car/pass/phase trial.
        const next: [number,number][] = [];
        for (const interval of windows) {
          const [lo,hi] = interval;
          if (end<=lo || start>=hi) next.push(interval);
          else { if(start>lo)next.push([lo,start]);if(end<hi)next.push([end,hi]); }
        }
        windows=next;
        if(!windows.some(([lo,hi])=>hi-lo>=.75))return false;
      }
    }
  }
  return windows.some(([lo,hi])=>hi-lo>=.75);
}
/** Union all car-presence intervals: whole-cluster empty time is the complement. */
function clusterEmptyScore(lanes: GeneratedLane[]): number {
  const occupied:[number,number][]=[];
  const horizon=2*lanes[0]!.cycle;
  for(const l of lanes)for(const position of l.positions){
    const v=l.speed*l.direction,half=10+1.77*l.scale,origin=l.offset+position;
    const first=Math.ceil((Math.min(origin,origin+v*horizon)-half)/l.period);
    const last=Math.floor((Math.max(origin,origin+v*horizon)+half)/l.period);
    for(let pass=first;pass<=last;pass++){
      const a=(-half+pass*l.period-origin)/v,b=(half+pass*l.period-origin)/v;
      occupied.push([Math.max(0,Math.min(a,b)),Math.min(horizon,Math.max(a,b))]);
    }
  }
  occupied.sort((a,b)=>a[0]-b[0]);
  let end=0,total=0,longest=0;
  for(const [lo,hi] of occupied){if(hi<lo)continue;const gap=Math.max(0,lo-end);total+=gap;longest=Math.max(longest,gap);end=Math.max(end,hi);}
  total+=horizon-end;longest=Math.max(longest,horizon-end);
  return Math.max(longest/3.5,total/(horizon*.1));
}
export function roadLanes(s: WorldSection): GeneratedLane[] {
  const key=`${s.id}/${s.offset}/${s.direction}/${s.difficultyTier}/${s.start}/${s.length}`;
  const cached=laneCache.get(key);if(cached)return cached;
  const n=Math.round(s.offset*10)+180, seed=Number(s.id.split(':')[1]);
  const count=s.length<6?2:n%32===0?3:n%8===0?4:5;
  const lanes=Array.from({length:count},(_,i)=>{
    const z=sectionCenter(s)+(i-(count-1)/2)*generatedSettings.lanePitch;
    const direction=i%2?-s.direction:s.direction, difficulty=difficultyTiers[s.difficultyTier]!;
    const speed=generatedSettings.laneSpeeds[vehicleColor(s,i)]!*difficulty.roadSpeedScale;
    const unit=(salt:number)=>random(seed,s.index,i*17+salt)/0xffffffff;
    // Bound the reusable pool by transit speed, not a one-off initial wave.
    // Preserve one conservative full-group gap per cycle; remaining headways
    // stay close to it instead of leaving a 16–23 s residual silence.
    const profile=vehicleColor(s,i);
    const slots=profile===0?3:profile===1?4:profile===2?4:5;
    const cycle=(19.2+random(seed,s.index,777)/0xffffffff*.5)*difficulty.headwayScale;
    const duration=.5+(generatedSettings.lanePitch+2*settings.player.radius)/trafficCrossingSpeed;
    const crossingGap=(groupEnvelope(4)+3.54*generatedSettings.carScale)/speed+duration+.75+.12;
    const finalGap=Math.max(cycle/slots,crossingGap);
    const regular=(cycle-finalGap)/(slots-1);
    const intervals=Array.from({length:slots},(_,j)=>regular+(unit(j+1)-.5)*.04*difficulty.headwayScale);
    intervals[slots-1]=cycle-intervals.slice(0,-1).reduce((n,h)=>n+h,0);
    const period=speed*cycle;
    const positions=intervals.map((_,slot)=>intervals.slice(0,slot).reduce((n,h)=>n+h,0)*speed*direction);
    return {z,speed,direction,offset:0,period,scale:generatedSettings.carScale,
      positions,minHeadway:Math.min(...intervals),maxHeadway:Math.max(...intervals),cycle,phaseTrials:0,balanced:false};
  });
  // Reject phases that offer no conservative four-seat crossing candidate in a
  // bounded 45-s window. Headways/speeds/topology stay fixed; lane spawn phases remain independent.
  let accepted=false,bestScore=Infinity,best:number[]=[];
  for(let attempt=0;attempt<128;attempt++){
    // Start from feasible gap centres rather than almost always rejecting
    // uniformly random dense phases. Each lane independently picks a viable
    // gap and bounded jitter; all retain the common ≥.75-s launch interval.
    const launch=5+random(seed,s.index,10000+attempt)/0xffffffff*20;
    lanes.forEach((l,i)=>{
      const duration=.5+(generatedSettings.lanePitch+2*settings.player.radius)/trafficCrossingSpeed;
      const times=l.positions.map(x=>Math.abs(x/l.speed));
      const intervals=times.map((t,j)=>(times[j+1]??l.cycle)-t);
      const required=(groupEnvelope(4)+3.54*l.scale)/l.speed+duration+.75;
      const choices=intervals.map((gap,j)=>({gap,j})).filter(c=>c.gap>=required);
      const chosen=choices[random(seed,s.index,20000+i*67+attempt)%choices.length]!;
      const jitter=(random(seed,s.index,30000+i*67+attempt)/0xffffffff-.5)*Math.min(.8,chosen.gap-required);
      const midpoint=l.positions[chosen.j]!+l.speed*l.direction*chosen.gap/2;
      const raw=-midpoint-l.speed*l.direction*(launch+(l.z-lanes[0]!.z)/trafficCrossingSpeed+duration/2+jitter);
      l.phaseTrials=attempt+1;l.offset=wrapTrafficX(raw,l.period);
    });
    if(!hasCrossingWindow(lanes))continue;
    const score=clusterEmptyScore(lanes);
    if(score<bestScore){bestScore=score;best=lanes.map(l=>l.offset);}
    if(score<=1){lanes.forEach(l=>{l.balanced=true;});accepted=true;break;}
  }
  if(!accepted && best.length){lanes.forEach((l,i)=>{l.offset=best[i]!;});accepted=true;}
  if(!accepted){
    // Bounded fail-safe: centre each long gap on a time-shifted group crossing.
    // Near-regular headways recur unchanged; never change terrain as fallback.
    lanes.forEach(l=>{
      const midpoint=(l.positions.at(-1)!+l.speed*l.direction*(l.cycle-Math.abs(l.positions.at(-1)!/l.speed))/2);
      const raw=-midpoint-l.speed*l.direction*(5+random(seed,s.index,9999)/0xffffffff*20+(l.z-lanes[0]!.z)/trafficCrossingSpeed);
      l.offset=((raw+l.period/2)%l.period+l.period)%l.period-l.period/2;
    });
  }
  // Bounded recipe cache only; unloading keeps no vehicle bodies/timers/resources.
  if(laneCache.size>=128)laneCache.delete(laneCache.keys().next().value!);
  lanes.forEach(l=>{Object.freeze(l.positions);Object.freeze(l);});Object.freeze(lanes);
  laneCache.set(key,lanes);return lanes;
}
/** Stable contiguous IDs, regardless of lane pool size; slot zero is its anchor. */
export function generatedVehicleSlots(s: WorldSection): { id:number; lane:number; slot:number }[] {
  let id=0;
  return roadLanes(s).flatMap((l,lane)=>l.positions.map((_,slot)=>({id:id++,lane,slot})));
}
export function sectionReason(s: WorldSection): 'spawn'|'prestart'|'regroup'|'fallback'|'hazard' {
  return s.index===0?'spawn':s.index<0?'prestart':s.type!=='grass'?'hazard':s.index%24===0?'regroup':'fallback';
}
export function sectionBoxes(s: WorldSection): CourseBox[] {
  const center = s.start + s.length / 2;
  const boxes: CourseBox[] = s.type === 'river'
    ? riverScenario.boxes.filter(b => b.kind === 'ground').map(b => ({ ...b, center: { ...b.center, z: b.center.z + center - 4.5 }, halfSize: { ...b.halfSize } }))
    : [{ id: 'ground', kind: 'ground', center: { x: 0, y: -.25, z: center }, halfSize: { x: 10, y: .25, z: s.length/2 } }];
  if (s.type === 'river') {
    // Replace finite test-course banks with exact section entry/exit extents.
    const near = boxes.find(b => b.id === 'near-bank')!, far = boxes.find(b => b.id === 'far-bank')!;
    near.center.z = (s.start + center - 2.5) / 2; near.halfSize.z = (center - 2.5 - s.start) / 2;
    far.center.z = (center + 2.5 + s.start + s.length) / 2; far.halfSize.z = (s.start + s.length - center - 2.5) / 2;
  }
  if(s.index===0)boxes.push({id:'spawn-rear',kind:'boundary',center:{x:0,y:.4,z:s.start},halfSize:{x:10,y:1.1,z:.3}});
  for (const side of [-1,1]) boxes.push({ id: `wall-${side}`, kind: 'boundary', center: { x: side * 10, y: .4, z: center }, halfSize: { x: .3, y: 1.1, z: s.length/2 } });
  return boxes.map(b => ({ ...b, id: `${s.id}/${b.id}` }));
}
export const generatedScenario: Scenario = { id: 'generated', label: 'Generated World', chain: true, boxes: [], players: [
  { id: 'p1', color: 0xf4bd62, spawn: { x: 2, y: .8, z: 0 } },
  { id: 'p2', color: 0x78bde8, spawn: { x: -2, y: .8, z: 0 } },
] };
