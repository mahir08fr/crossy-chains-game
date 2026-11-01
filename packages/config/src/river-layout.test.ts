import { expect, it } from 'vitest';
import { generateSection, riverLayout, validateRiverRocks, riverRockSizes, validateArrangement } from './index.js';
it('all ordinary rivers keep 5–6 nonoverlapping bed rocks, 1–2 medium, deterministic corridor and unchanged dense transitions',()=>{
 let rivers=0,fallbacks=0;
 for(let seed=0;seed<100;seed++){
  const sections=Array.from({length:80},(_,i)=>generateSection(seed,i));expect(validateArrangement(sections,4)).toEqual([]);
  for(const s of sections)if(s.river){
   rivers++;fallbacks+=Number(s.river.fallback);expect(s.river).toEqual(riverLayout(s));expect(validateRiverRocks(s.river.rocks,s)).toEqual([]);
   expect(s.river.rocks.length).toBeGreaterThanOrEqual(5);expect(s.river.rocks.length).toBeLessThanOrEqual(6);
   expect(new Set(s.river.rocks.map(r=>r.id)).size).toBe(s.river.rocks.length);
   expect(s.river.rocks.filter(r=>r.size==='medium').length).toBeGreaterThanOrEqual(1);expect(s.river.rocks.filter(r=>r.size==='medium').length).toBeLessThanOrEqual(2);
   for(const r of s.river.rocks)expect(Math.abs(r.x)-riverRockSizes[r.size].halfX).toBeGreaterThanOrEqual(1.8);
  }
 }
 expect(rivers).toBeGreaterThan(1000);expect(fallbacks).toBe(0);
});
it('independent deterministic direction/strength streams match the four requested probabilities over 20,000 seeds',()=>{
 const counts={normalLeft:0,normalRight:0,fastLeft:0,fastRight:0};
 for(let seed=0;seed<20000;seed++){
  const r=riverLayout({id:`v4:${seed}:1`,index:1,start:7,length:9.6,halfWidth:10});
  counts[`${r.strength}${r.direction===1?'Left':'Right'}`]++;
 }
 for(const [key,p] of Object.entries({normalLeft:.425,normalRight:.425,fastLeft:.075,fastRight:.075}))expect(counts[key as keyof typeof counts]/20000).toBeCloseTo(p,2);
});
it('incompatible geometry reports a conflict rather than dropping required rocks',()=>{
 expect(()=>riverLayout({id:'v4:42:1',index:1,start:7,length:9.6,halfWidth:3})).toThrow('cannot fit');
});
