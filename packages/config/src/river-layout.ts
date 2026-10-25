import { riverSettings, settings } from './index.js';
import type { CourseBox, WorldSection } from './index.js';

export const riverRulesVersion = 1 as const;
// Actual Rapier drift includes wet velocity feedback, bed friction and cable load.
// These external accelerations are independent of player-controlled speed.
export const riverCurrentSettings = { normalAcceleration: 5, fastAcceleration: 10 } as const;
export const riverRockSizes = {
  small: { halfX: .35, halfZ: .305, height: .3 },
  medium: { halfX: .7, halfZ: .59, height: .46 },
} as const;
export type RiverRock = { id: string; size: keyof typeof riverRockSizes; x: number; z: number };
export type RiverLayout = { version: typeof riverRulesVersion; direction: -1 | 1; strength: 'normal' | 'fast'; acceleration: number; rocks: RiverRock[]; fallback: boolean };
// Independent counter streams; do not consume terrain/traffic RNG or depend on load order.
function random(seed: number, index: number, stream: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b9) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  return ((x ^ x >>> 16) >>> 0) / 4294967296;
}
/** Deliberately preserves a 3.6m straight group corridor, not universal snag solvability.
 * Rocks stay on the original flat bed (two metres along Z), clear of both slopes.
 * Side strata spread props across the river; positions/size order vary within them. */
export function riverLayout(s: Pick<WorldSection, 'id' | 'index' | 'start' | 'length' | 'halfWidth'>): RiverLayout {
  if(s.length<8)throw new Error(`River rocks cannot fit ${s.id}: length=${s.length}`);
  const seed = Number(s.id.split(':')[1]), center = s.start + s.length / 2;
  const direction = random(seed,s.index,7100) < .5 ? -1 : 1;
  const strength = random(seed,s.index,7101) < .15 ? 'fast' : 'normal';
  const count = random(seed,s.index,7102) < .5 ? 5 : 6;
  const large = random(seed,s.index,7103) < .5 ? 1 : 2;
  const sizes: RiverRock['size'][] = Array.from({length:count},(_,i)=>i<large?'medium':'small');
  // Fisher-Yates, independent of direction/strength.
  for(let i=count-1;i>0;i--){const j=Math.floor(random(seed,s.index,7200+i)*(i+1));[sizes[i],sizes[j]]=[sizes[j]!,sizes[i]!];}
  const make=(attempt:number,fallback=false):RiverRock[]=>sizes.map((size,i)=>{
    const dim=riverRockSizes[size],side=i%2===0?-1:1,slot=Math.floor(i/2);
    // Three cells on each side, with a central corridor and wall clearance.
    const lo=2.7+slot*2,hi=Math.min(lo+1.2,s.halfWidth-.8-dim.halfX);
    if(hi<lo)throw new Error(`River rocks cannot fit ${s.id}: halfWidth=${s.halfWidth}`);
    return {id:`${s.id}/river-v1/rock-${i}`,size,x:side*(lo+(hi-lo)*(fallback ? .5 : random(seed,s.index,7300+attempt*32+i*2))),
      z:center+(fallback?0:(random(seed,s.index,7301+attempt*32+i*2)*2-1)*(1-dim.halfZ-.08))};
  });
  for(let attempt=0;attempt<8;attempt++){
    const rocks=make(attempt);if(validateRiverRocks(rocks,s).length===0)return {version:riverRulesVersion,direction,strength,acceleration:strength==='fast'?riverCurrentSettings.fastAcceleration:riverCurrentSettings.normalAcceleration,rocks,fallback:false};
  }
  const rocks=make(0,true),errors=validateRiverRocks(rocks,s);
  if(errors.length)throw new Error(`No safe river rock fallback ${s.id}: ${errors.join(',')}`);
  return {version:riverRulesVersion,direction,strength,acceleration:strength==='fast'?riverCurrentSettings.fastAcceleration:riverCurrentSettings.normalAcceleration,rocks,fallback:true};
}
export function validateRiverRocks(rocks: readonly RiverRock[],s: Pick<WorldSection,'start'|'length'|'halfWidth'>): string[] {
  const errors:string[]=[],center=s.start+s.length/2;
  if(rocks.length<5||rocks.length>6)errors.push('count');
  const large=rocks.filter(r=>r.size==='medium').length;if(large<1||large>2)errors.push('medium-count');
  for(const [i,r] of rocks.entries()){
    const d=riverRockSizes[r.size];
    if(Math.abs(r.x)+d.halfX>s.halfWidth-.6||Math.abs(r.z-center)+d.halfZ>1-.05)errors.push('bank-clearance');
    if(Math.abs(r.x)-d.halfX<1.8)errors.push('group-corridor');
    for(const other of rocks.slice(0,i)){
      const b=riverRockSizes[other.size];
      if(Math.abs(r.x-other.x)<d.halfX+b.halfX+.25&&Math.abs(r.z-other.z)<d.halfZ+b.halfZ+.25)errors.push('overlap');
    }
  }
  // Conservative no-steering crossing + acceleration/bank/recovery allowance.
  const crossing=5.7/(riverSettings.speed/(1+riverSettings.drag*settings.player.responseSeconds))+2;
  const drift=riverCurrentSettings.fastAcceleration*settings.player.responseSeconds/(1+riverSettings.drag*settings.player.responseSeconds)*crossing;
  if(crossing>=riverSettings.exposureSeconds||drift+1.8+settings.player.radius>=s.halfWidth-.3)errors.push('current-budget');
  return errors;
}
/** Tall fixed clearance prisms intentionally prevent climbing/overpassing these low props.
 * They extend from below the bed to 1.1m; they are never valid support ground. */
export function riverRockBoxes(layout: RiverLayout): CourseBox[] {
  return layout.rocks.map(r=>({id:r.id,kind:'obstacle',center:{x:r.x,y:.39,z:r.z},halfSize:{x:riverRockSizes[r.size].halfX,y:.71,z:riverRockSizes[r.size].halfZ}}));
}
