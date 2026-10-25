import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { isSnapshotMessage, isControllerStatus, unpackSnapshot } from '@crossy/protocol';
import type { SnapshotMessage, ControllerStatus, WelcomeMessage, LobbyMessage, DisplayWelcome } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
import { relay } from './tcp-relay.test-helper.js';
const runtime=createServerRuntime(readServerConfig({}));let port:number;
beforeAll(async()=>{port=await runtime.start(0);});afterAll(()=>runtime.stop());
for(const couch of [false,true])it(`river ${couch?'four-phone':'two-desktop impaired TCP'}: exposure freeze/reclaim, authority, shared failure and host restart`,async()=>{
 const proxy=await relay(port,{delay:couch?0:40,jitter:couch?0:8,holdEvery:0});
 const sdk=new Client(proxy.endpoint,{headers:{Origin:'http://127.0.0.1:5173'}});
 const capacity=couch?4:2, rooms:Room[]=[], owners:(WelcomeMessage|DisplayWelcome|undefined)[]=[], states:(SnapshotMessage|undefined)[]=[], controls:(ControllerStatus|undefined)[]=[],lobbies:(LobbyMessage|undefined)[]=[],seq:number[]=[],neutral:boolean[]=[],rejections:string[]=[];
 let drive=true,phoneSnapshots=0;
 const attach=(r:Room,i:number)=>{
  rooms[i]=r;owners[i]=undefined;seq[i]=0;neutral[i]=true;r.reconnection.enabled=false;r.reconnection.maxEnqueuedMessages=0;
  r.onMessage('welcome',(m:WelcomeMessage)=>owners[i]=m);r.onMessage('display-welcome',(m:DisplayWelcome)=>owners[i]=m);
  r.onMessage('lobby',(m:LobbyMessage)=>lobbies[i]=m);
  const snap=(m:SnapshotMessage)=>{expect(isSnapshotMessage(m)).toBe(true);if(couch&&i>0)phoneSnapshots++;states[i]=m;};
  r.onMessage('snapshot',snap);r.onMessage('snapshot-compact',m=>snap(unpackSnapshot(m)!));
  r.onMessage('controller-status',(m:ControllerStatus)=>{expect(isControllerStatus(m)).toBe(true);controls[i]=m;});
  r.onMessage('rejected',(m:{code:string})=>{rejections.push(m.code);if(m.code==='requires-neutral')neutral[i]=true;});
  r.onMessage('input-expired',()=>neutral[i]=true);r.onMessage('lobby-rejected',()=>{});r.onMessage('couch-health',()=>{});r.onMessage('room-closed',()=>{});
  r.send('hello',{protocolVersion:1,snapshotFormat:'flat-chain-v1'});
 };
 const timer=setInterval(()=>rooms.forEach((r,i)=>{
  const o=owners[i];if(!r.connection.isOpen||!o)return;
  if(couch&&i===0){r.send('display-heartbeat',{protocolVersion:1,active:true});return;}
  const s=couch?controls[i]:states[i];if(!s||performance.now()-s.serverTimeMs>=250)return;
  r.send('input',{protocolVersion:1,sequence:++seq[i]!,connectionGeneration:o.connectionGeneration,runGeneration:s.runGeneration,referenceTimeMs:s.serverTimeMs,x:0,z:drive&&!neutral[i]?1:0});neutral[i]=false;
 }),1000/30);
 const command=(i:number,action:string,extra={})=>rooms[i]!.send('lobby',{protocolVersion:1,action,connectionGeneration:owners[i]!.connectionGeneration,runGeneration:states[0]!.runGeneration,lobbyEpoch:lobbies[i]!.epoch,...extra});
 try {
  attach(await sdk.create(couch?'couch-game':'private-game',{protocolVersion:1,capacity,course:'river',...(couch?{role:'display',displaySecret:'b'.repeat(32)}:{})}),0);
  for(let i=1;i<capacity+(couch?1:0);i++)attach(await sdk.joinById(rooms[0]!.roomId,{protocolVersion:1,...(couch?{role:'controller'}:{})}),i);
  await vi.waitFor(()=>expect(owners.filter(Boolean).length).toBe(rooms.length));
  await vi.waitFor(()=>expect(lobbies[0]?.players.length).toBe(capacity));
  for(let i=couch?1:0;i<rooms.length;i++)command(i,'ready');
  await vi.waitFor(()=>expect(lobbies[0]!.players.every(p=>p.ready)).toBe(true));command(0,'start');
  await vi.waitFor(()=>expect(states[0]?.phase).toBe('running'));
  await vi.waitFor(()=>expect(states[0]?.river?.players.every(p=>p.exposureSeconds>.1)).toBe(true),{timeout:3500});
  drive=false;
  const dropIndex=couch?2:1,token=rooms[dropIndex]!.reconnectionToken,oldOwner=owners[dropIndex]!.connectionGeneration;
  rooms[dropIndex]!.connection.close();
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('paused'));
  const paused=states[0]!;await new Promise(r=>setTimeout(r,400));
  expect(states[0]!.river).toEqual(paused.river);expect(states[0]!.chain).toEqual(paused.chain);expect(states[0]!.players).toEqual(paused.players);
  attach(await sdk.reconnect(token),dropIndex);
  await vi.waitFor(()=>expect(owners[dropIndex]?.connectionGeneration).toBeGreaterThan(oldOwner));
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('running'));
  expect(states[0]!.runGeneration).toBe(paused.runGeneration);
  rooms[dropIndex]!.send('input',{protocolVersion:1,sequence:99999,connectionGeneration:owners[dropIndex]!.connectionGeneration,runGeneration:states[0]!.runGeneration,referenceTimeMs:states[0]!.serverTimeMs,x:0,z:0,water:'safe'});
  await vi.waitFor(()=>expect(rejections).toContain('invalid-message'));
  command(dropIndex,'restart',{runGeneration:states[0]!.runGeneration-1});
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('ended'),{timeout:10500});
  expect(states[0]!.river!.outcome).toBe('failed');expect(states[0]!.river!.dead.length).toBeGreaterThan(0);
  if(couch){await vi.waitFor(()=>expect(controls.slice(1).every(c=>c?.river?.outcome==='failed')).toBe(true));expect(phoneSnapshots).toBe(0);}
  else {await vi.waitFor(()=>expect(states[1]!.river).toEqual(states[0]!.river));}
  const generation=states[0]!.runGeneration;command(0,'restart');
  await vi.waitFor(()=>expect(states[0]!.runGeneration).toBe(generation+1));
  expect(states[0]!.river!.players.every(p=>p.phase==='safe'&&p.exposureSeconds===0)).toBe(true);
 }finally{clearInterval(timer);await Promise.all(rooms.filter(r=>r.connection.isOpen).map(r=>r.leave().catch(()=>{})));await proxy.stop();}
},25000);
