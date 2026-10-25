import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
beforeAll(initializePhysics);
import { AuthoritativeSession } from './authoritative-session.js';
import { isSnapshotMessage } from '@crossy/protocol';
it.each([2,3,4] as const)('river %i: server snapshot, pause/disconnect freeze, resume and complete reset',capacity=>{
 const s=new AuthoritativeSession('river',capacity);
 try {
  s.setPhase('running');
  for(const id of ['p1','p2','p3','p4'].slice(0,capacity))s.input(id as 'p1',0,1,1);
  for(let i=0;i<100;i++)s.advance(1/60);
  const before=s.snapshot(1);expect(isSnapshotMessage(before)).toBe(true);expect(before.river!.players.some(p=>p.exposureSeconds>0)).toBe(true);
  s.clearInputs();s.setPhase('paused');for(let i=0;i<600;i++)s.advance(1/60);
  const paused=s.snapshot(2);expect(paused.players).toEqual(before.players);expect(paused.chain).toEqual(before.chain);expect(paused.river).toEqual(before.river);expect(paused.tick).toBe(before.tick);
  s.setPhase('running');s.advance(1/60);expect(s.snapshot(3).river!.players[0]!.exposureSeconds).toBeGreaterThan(before.river!.players[0]!.exposureSeconds);
  for(let i=0;i<1000 && s.phase==='running';i++){for(const id of s.simulation.states().map(p=>p.id))s.input(id,0,1,i+2);s.advance(1/60);}
  expect(s.phase).toBe('ended');expect(s.snapshot(3.5).river!.outcome).toBe('cleared');expect(isSnapshotMessage(s.snapshot(3.5))).toBe(true);
  s.reset();const reset=s.snapshot(4);expect(isSnapshotMessage(reset)).toBe(true);expect(reset.runGeneration).toBe(1);expect(reset.tick).toBe(0);expect(reset.river!.players.every(p=>p.phase==='safe'&&p.exposureSeconds===0)).toBe(true);
 }finally{s.dispose();}
});
