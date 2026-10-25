import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage, packSnapshot, unpackSnapshot, isPrivateRoomOptions, isCouchOptions, isControllerStatus } from '@crossy/protocol';
import type { SnapshotMessage } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';
beforeAll(initializePhysics);
it.each([2,3,4] as const)('%i authoritative railway seats: warning pause/reclaim state, resume, complete reset and strict packed snapshots',capacity=>{
 const s=new AuthoritativeSession('railway',capacity);
 try{
  s.setPhase('running');for(let i=0;i<180;i++)s.advance(1/60);
  const before=s.snapshot(1000);expect(isSnapshotMessage(before)).toBe(true);expect(before.railway!.signal).toBe('warning');
  expect(unpackSnapshot(packSnapshot(before))).toEqual(before);
  s.clearInputs();s.setPhase('paused');for(let i=0;i<2000;i++)s.advance(1/60);
  const paused=s.snapshot(2000);expect(paused.players).toEqual(before.players);expect(paused.chain).toEqual(before.chain);expect(paused.railway).toEqual(before.railway);
  s.setPhase('running');s.advance(1/60);expect(s.snapshot(2100).railway!.elapsedSeconds).toBeGreaterThan(before.railway!.elapsedSeconds);
  const copy=s.snapshot(2150);copy.railway!.dead.push('p1');expect(s.snapshot(2160).railway!.dead).toEqual([]);
  s.reset();expect(s.snapshot(2200).railway).toMatchObject({elapsedSeconds:0,x:-36,pass:0,dead:[],signal:'safe'});expect(s.runGeneration).toBe(1);
  s.setPhase('running');for(const p of s.simulation.states())s.input(p.id,0,1,1);for(let i=0;i<600&&s.phase==='running';i++)s.advance(1/60);
  const end=s.snapshot(3000);expect(end.railway!.outcome).toBe('cleared');expect(isSnapshotMessage(end)).toBe(true);
  s.reset();expect(s.phase).toBe('waiting');expect(s.snapshot(4000).tick).toBe(0);
 }finally{s.dispose();}
}, 30000);
it('rejects mixed/malformed/incomplete railway authority and client hazard controls',()=>{
 const s=new AuthoritativeSession('railway');
 try{
  const snap=s.snapshot(1000);expect(isPrivateRoomOptions({protocolVersion:1,course:'railway',capacity:4})).toBe(true);
  expect(isCouchOptions({protocolVersion:1,role:'display',displaySecret:'a'.repeat(32),course:'railway',capacity:4})).toBe(true);
  expect(isCouchOptions({protocolVersion:1,role:'controller',course:'railway'})).toBe(false);
  for(const mutate of [(v:SnapshotMessage)=>{v.railway!.x=NaN;},(v:SnapshotMessage)=>{v.railway!.pass=-1;},(v:SnapshotMessage)=>{delete v.railway;},(v:SnapshotMessage)=>{v.chain!.course='river';},(v:SnapshotMessage)=>{v.scenarioVersion=4;},(v:SnapshotMessage)=>{v.railway!.dead=['p3'];},(v:SnapshotMessage)=>{v.phase='ended';}]){
   const v=structuredClone(snap);mutate(v);expect(isSnapshotMessage(v)).toBe(false);
  }
  const status={protocolVersion:1,phase:'waiting',runGeneration:0,serverTimeMs:1000,outcome:'active',displayActive:true,railway:snap.railway};
  expect(isControllerStatus(status)).toBe(true);expect(isControllerStatus({...status,outcome:'failed'})).toBe(false);
 }finally{s.dispose();}
});
