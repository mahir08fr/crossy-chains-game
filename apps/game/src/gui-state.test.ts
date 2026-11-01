import { expect, it } from 'vitest';
import { canHostStart, cinematicPose, failureNames, failurePresentation, nextCapacity, reachablePhoneOrigin } from './gui-state';
import { protocolVersion } from '@crossy/protocol';
import type { LobbyMessage, SnapshotMessage } from '@crossy/protocol';
const lobby = ():LobbyMessage=>({protocolVersion,capacity:2,code:'ABCDEFGH',epoch:1,revision:1,runGeneration:0,stage:'lobby',host:'p1',players:[{slot:'p1',connected:true,ready:false,restartRequested:false,displayName:'Goose'},{slot:'p2',connected:true,ready:true,restartRequested:false,displayName:'Alex'}]});
const snapshot = (extra: Partial<SnapshotMessage> = {}):SnapshotMessage=>({protocolVersion,scenarioVersion:3,runGeneration:1,tick:5,serverTimeMs:100,phase:'ended',droppedSeconds:0,players:[],...extra});
it('bounds optional slots without changing an active room',()=>{expect(nextCapacity(2,-1,false)).toBe(2);expect(nextCapacity(2,1,false)).toBe(3);expect(nextCapacity(3,1,false)).toBe(4);expect(nextCapacity(4,1,false)).toBe(4);expect(nextCapacity(4,-1,true)).toBe(4);expect(nextCapacity(4,-1,false)).toBe(3);});
it('host start prepares only a complete ready peer group and respects transferred ownership',()=>{const l=lobby();expect(canHostStart(l,'p1')).toBe(true);expect(canHostStart(l,'p2')).toBe(false);l.players[1]!.ready=false;expect(canHostStart(l,'p1')).toBe(false);l.host='p2';l.players[0]!.ready=true;expect(canHostStart(l,'p2')).toBe(true);l.players[0]!.connected=false;expect(canHostStart(l,'p2')).toBe(false);l.players.pop();expect(canHostStart(l,'p2')).toBe(false);});
it('rejects host preparation after start and for absent identities',()=>{const l=lobby();l.stage='playing';expect(canHostStart(l,'p1')).toBe(false);expect(canHostStart(undefined,'p1')).toBe(false);expect(canHostStart(l)).toBe(false);});
it.each(['p1','p2','p3','p4'] as const)('presents actual %s victim and payload cause',id=>{const s=snapshot({road:{elapsedSeconds:2,vehicles:[],dead:[id],outcome:'failed'}});expect(failurePresentation(s)).toEqual({slots:[id],cause:'was hit by traffic',failed:true});expect(failureNames([id])).toMatch(/Player [1-4]/);});
it('distinguishes railway, water, safety faults and successful course clear',()=>{
 expect(failurePresentation(snapshot({railway:{elapsedSeconds:2,pass:0,x:0,signal:'occupying',dead:['p3'],outcome:'failed'}})).cause).toBe('was hit by a train');
 expect(failurePresentation(snapshot({river:{exposureLimitSeconds:8,recoverySeconds:1,players:[],dead:['p2'],outcome:'failed'}})).cause).toBe('drowned');
 expect(failurePresentation(snapshot({phase:'fault'}))).toEqual({slots:[],cause:'The team stopped for physics safety.',failed:true});
 expect(failurePresentation(snapshot({road:{elapsedSeconds:2,vehicles:[],dead:[],outcome:'cleared'}})).failed).toBe(false);
 expect(failureNames(['p2'],lobby())).toBe('Alex');
 expect(failurePresentation(snapshot())).toEqual({slots:[],cause:'The team attempt has ended.',failed:true});
});
it('reads generated death provenance without guessing a victim or mixed cause',()=>{
 const s=snapshot({world:{version:4,riverVersion:1,highWater:0,rearLimit:-6.7,seed:1,elapsedSeconds:0,sections:[],hazards:[{id:'road',road:{elapsedSeconds:0,vehicles:[],dead:['p1'],outcome:'failed'}}],water:{exposureLimitSeconds:8,recoverySeconds:1,players:[],dead:['p2'],outcome:'failed'},dead:['p1','p2'],outcome:'failed'}});
 expect(failurePresentation(s).cause).toBe('could not finish the crossing');s.world!.dead=['p2'];s.world!.hazards=[];expect(failurePresentation(s).cause).toBe('drowned');
});
it('has continuous rise/apex/fall and bounded reduced motion, with no physics mutation',()=>{
 expect(cinematicPose(0)).toEqual({y:0,flip:0,done:false});expect(cinematicPose(.7).y).toBeCloseTo(2.7);expect(cinematicPose(.95).y).toBeCloseTo(2.7);expect(cinematicPose(.7).flip%(Math.PI*2)).toBeCloseTo(Math.PI/2);expect(cinematicPose(1.8).y).toBeLessThan(-10);expect(cinematicPose(1.85).done).toBe(true);expect(cinematicPose(.15,true)).toEqual({y:0,flip:0,done:true});
});
it('suppresses impossible cross-device loopback invitations while retaining LAN/public URLs',()=>{
 expect(reachablePhoneOrigin('http://127.0.0.1:5173','http://192.168.1.10:2567')).toBe(false);
 expect(reachablePhoneOrigin('http://192.168.1.10:5173','http://127.0.0.1:2567')).toBe(false);
 expect(reachablePhoneOrigin('http://192.168.1.10:5173','http://192.168.1.10:2567')).toBe(true);
 expect(reachablePhoneOrigin('https://game.example.com','https://server.example.com')).toBe(true);
});

it('eases cinematic rotation into launch and apex without a sudden angular stop',()=>{
 const epsilon=.0001;
 expect(cinematicPose(epsilon).flip/epsilon).toBeLessThan(.01);
 expect((cinematicPose(.7).flip-cinematicPose(.7-epsilon).flip)/epsilon).toBeLessThan(.01);
 expect(cinematicPose(.35).y).toBeGreaterThan(2);
});
