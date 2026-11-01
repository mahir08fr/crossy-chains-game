import { expect, it } from 'vitest';
import { difficultyAt, difficultyTiers, generateSection, roadLanes, sectionStart, validateArrangement, validateSection, railwaySettings } from './index.js';
it('distance thresholds are bounded and change only at their documented positions',()=>{
  expect([-100,0,99.99,100,249.99,250,499.99,500,1e9].map(difficultyAt)).toEqual([0,0,0,1,1,2,2,3,3]);
  expect(difficultyTiers.map(t=>t.roadSpeedScale)).toEqual([1,1.05,1.05,1.1]);
  expect(railwaySettings.warningSeconds).toBe(3);
});
it('versioned section difficulty is deterministic, bounded and feasible for every capacity across tiers and seeded arrangements',()=>{
  for(const capacity of [2,3,4] as const)for(const seed of [1,42,20261016,0xffffffff]){
    const sections=Array.from({length:1001},(_,i)=>generateSection(seed,i,capacity,undefined,difficultyAt(sectionStart(i))));
    expect(validateArrangement(sections,capacity)).toEqual([]);
    expect(sections.filter(s=>s.type==='grass'&&s.index%24!==0)).toHaveLength(0);
    for(const s of sections){
      expect(s).toEqual(generateSection(seed,s.index,capacity,undefined,difficultyAt(s.start)));
      expect(s.difficultyTier).toBe(difficultyAt(s.start));
      for(const l of s.type==='road'?roadLanes(s):[]){expect(l.speed).toBeLessThanOrEqual(9.24+1e-9);expect(l.period/l.speed).toBeGreaterThanOrEqual(16);}
      if(s.type==='river')expect(s.length).toBe(9.6);
      if(s.type==='railway'){expect(s.speed).toBe(35);expect(s.safeSeconds).toBe(railwaySettings.safeSeconds);}
    }
  }
  for(const tier of [-1,4,1.5,NaN])expect(()=>generateSection(42,1,4,undefined,tier)).toThrow();
  const fallback=generateSection(42,50,4,s=>({...s,speed:100}),3);expect(fallback.type).not.toBe('grass');expect(fallback.difficultyTier).toBe(3);expect(validateSection(fallback,4)).toEqual([]);
});
