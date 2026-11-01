import { expect, it } from 'vitest';
import { isPrivateRoomOptions, isCouchOptions, isInputMessage, isSnapshotMessage, isControllerStatus, packSnapshot, unpackSnapshot } from './index.js';
import type { SnapshotMessage, MotionRiver } from './index.js';
const river: MotionRiver={exposureLimitSeconds:8,recoverySeconds:1,players:['p1','p2'].map(id=>({id:id as 'p1'|'p2',phase:'safe',exposureSeconds:0,safeSeconds:0})),dead:[],outcome:'active'};
const snap:SnapshotMessage={protocolVersion:1,scenarioVersion:5,runGeneration:1,tick:1,serverTimeMs:10,phase:'running',droppedSeconds:0,
 players:['p1','p2'].map(id=>({id:id as 'p1'|'p2',position:{x:0,y:.77,z:0},velocity:{x:0,y:0,z:0},grounded:true,acknowledgedSequence:0})),
 chain:{course:'river',endpoints:['p1','p2'],segments:Array.from({length:12},()=>({position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}}))},river};
it('strict creation-only course selection and no client water/timer authority',()=>{
 expect(isPrivateRoomOptions({protocolVersion:1,capacity:4,course:'river'})).toBe(true);
 expect(isCouchOptions({protocolVersion:1,role:'display',displaySecret:'a'.repeat(32),capacity:4,course:'river'})).toBe(true);
 expect(isCouchOptions({protocolVersion:1,role:'controller',course:'river'})).toBe(false);
 for(const course of ['bad',null,{},1])expect(isPrivateRoomOptions({protocolVersion:1,course})).toBe(false);
 expect(isInputMessage({protocolVersion:1,sequence:1,connectionGeneration:1,runGeneration:1,referenceTimeMs:10,x:0,z:0,water:'safe'})).toBe(false);
});
it('requires complete coherent river authority and preserves packed chain without precision loss',()=>{
 expect(isSnapshotMessage(snap)).toBe(true);expect(unpackSnapshot(packSnapshot(snap))).toEqual(snap);
 for(const mutate of [(s:SnapshotMessage)=>{s.river!.players[0]!.exposureSeconds=NaN;},(s:SnapshotMessage)=>{s.river!.players[0]!.phase='failed';},(s:SnapshotMessage)=>{s.river!.players[0]!.exposureSeconds=9;},(s:SnapshotMessage)=>{s.river!.dead=['p4'];},(s:SnapshotMessage)=>{s.phase='ended';},(s:SnapshotMessage)=>{s.chain!.course='road';},(s:SnapshotMessage)=>{delete s.river;}]){
  const copy=structuredClone(snap);mutate(copy);expect(isSnapshotMessage(copy)).toBe(false);
 }
 const end=structuredClone(snap);end.phase='ended';end.river!.outcome='failed';end.river!.dead=['p1'];Object.assign(end.river!.players[0]!,{phase:'failed',exposureSeconds:8});expect(isSnapshotMessage(end)).toBe(true);
 const status={protocolVersion:1,phase:'running',runGeneration:1,serverTimeMs:10,outcome:'active',displayActive:true,river};
 expect(isControllerStatus(status)).toBe(true);expect(isControllerStatus({...status,outcome:'failed'})).toBe(false);
});
