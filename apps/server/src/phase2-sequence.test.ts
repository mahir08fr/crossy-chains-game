import {beforeAll,expect,it} from 'vitest';
import {initializePhysics} from '@crossy/simulation';
import {packSnapshot,unpackSnapshot} from '@crossy/protocol';
import {traversalInput} from '../../../scripts/phase35-traversal.mjs';
import type {TraversalGate} from '../../../scripts/phase35-traversal.mjs';
import {AuthoritativeSession} from './authoritative-session.js';
beforeAll(initializePhysics);
it.each([2,3,4] as const)('%i chained seats traverse complete compact mixed sequences with ordinary inputs',capacity=>{
 const s=new AuthoritativeSession('generated',capacity,1);let gate:TraversalGate|undefined,wet=false,cleared=false,previousRear=-6.7;
 try{
  s.setPhase('running');
  for(let tick=0;tick<12000&&s.phase==='running';tick++){
   const snap=s.snapshot(0),c=traversalInput(snap,gate);gate=c.gate;
   for(const p of snap.players)s.input(p.id,c.byPlayerX[p.id]??0,c.byPlayer[p.id]??0,tick+1);
   s.advance(1/60);
   if(tick%30===0){
    const state=s.snapshot(0),w=state.world!;
    expect(unpackSnapshot(packSnapshot(state))).toEqual(state);
    expect(w.rearLimit).toBeGreaterThanOrEqual(previousRear);previousRear=w.rearLimit;
    expect(s.diagnostics().activeSections).toBeLessThanOrEqual(24);
    wet ||= w.water.players.some(p=>p.exposureSeconds>0);
    cleared ||= wet&&w.water.players.every(p=>p.exposureSeconds===0);
   }
   if(s.snapshot(0).run!.distance>120)break;
  }
  expect(s.simulation.fault).toBeUndefined();expect(s.phase).toBe('running');expect(s.snapshot(0).run!.distance).toBeGreaterThan(120);
  expect(wet).toBe(true);expect(cleared).toBe(true);
  expect(s.simulation.chainMetricsAll().every(m=>m.maxAnchorError<.02)).toBe(true);
 }finally{s.dispose();}
},60000);
