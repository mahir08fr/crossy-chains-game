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
for(const [couch,capacity] of [[false,2],[false,3],[false,4],[true,2],[true,3],[true,4]] as const)it(`generated ${capacity} ${couch?'phone':'desktop TCP'}: seed reconstruction, safe reclaim, shared water failure and same-seed restart`,async()=>{
 const proxy=await relay(port,{delay:couch?0:40,jitter:couch?0:8,holdEvery:0});
 const sdk=new Client(proxy.endpoint,{headers:{Origin:'http://127.0.0.1:5173'}});
 const rooms:Room[]=[], owners:(WelcomeMessage|DisplayWelcome|undefined)[]=[], states:(SnapshotMessage|undefined)[]=[], controls:(ControllerStatus|undefined)[]=[],lobbies:(LobbyMessage|undefined)[]=[],seq:number[]=[],neutral:boolean[]=[],rejections:string[]=[];
 const firstFrames=new Map<number,SnapshotMessage>();
 let drive=false,phoneSnapshots=0,compactSnapshots=0;
 const attach=(r:Room,i:number)=>{
  rooms[i]=r;owners[i]=undefined;seq[i]=0;neutral[i]=true;r.reconnection.enabled=false;r.reconnection.maxEnqueuedMessages=0;
  r.onMessage('welcome',(m:WelcomeMessage)=>owners[i]=m);r.onMessage('display-welcome',(m:DisplayWelcome)=>owners[i]=m);
  r.onMessage('lobby',(m:LobbyMessage)=>lobbies[i]=m);
  const snap=(m:SnapshotMessage)=>{expect(isSnapshotMessage(m)).toBe(true);if(couch&&i>0)phoneSnapshots++;if(i===0&&!firstFrames.has(m.runGeneration))firstFrames.set(m.runGeneration,m);states[i]=m;};
  r.onMessage('snapshot',snap);r.onMessage('snapshot-compact',m=>{compactSnapshots++;snap(unpackSnapshot(m)!);});
  r.onMessage('controller-status',(m:ControllerStatus)=>{expect(isControllerStatus(m)).toBe(true);controls[i]=m;});
  r.onMessage('rejected',(m:{code:string})=>{rejections.push(m.code);if(m.code==='requires-neutral')neutral[i]=true;});
  r.onMessage('input-expired',()=>neutral[i]=true);r.onMessage('lobby-rejected',()=>{});r.onMessage('couch-health',()=>{});r.onMessage('room-closed',()=>{});
  r.send('hello',{protocolVersion:1,snapshotFormat:'flat-chain-v1'});
 };
 const timer=setInterval(()=>rooms.forEach((r,i)=>{
  const o=owners[i];if(!r.connection.isOpen||!o)return;
  if(couch&&i===0){r.send('display-heartbeat',{protocolVersion:1,active:true});return;}
  const s=couch?controls[i]:states[i];if(!s||performance.now()-s.serverTimeMs>=250)return;
  // Regroup into the validated corridor before parking in the opening river.
  const pose=(couch?states[0]:states[i])?.players.find(p=>p.id===('slot' in o?o.slot:''));
  const targetX=(capacity-1)*.45-(Number(('slot' in o?o.slot:'p1').slice(1))-1)*.9;
  const x=drive&&!neutral[i]?Math.max(-1,Math.min(1,(targetX-(pose?.position.x??0))*2)):0;
  const z=drive&&!neutral[i]&&(pose?.position.z??0)<11.6?1:0;
  r.send('input',{protocolVersion:1,sequence:++seq[i]!,connectionGeneration:o.connectionGeneration,runGeneration:s.runGeneration,referenceTimeMs:s.serverTimeMs,x,z});neutral[i]=false;
 }),1000/30);
 const command=(i:number,action:string,extra={})=>rooms[i]!.send('lobby',{protocolVersion:1,action,connectionGeneration:owners[i]!.connectionGeneration,runGeneration:states[0]!.runGeneration,lobbyEpoch:lobbies[i]!.epoch,...extra});
 try {
  attach(await sdk.create(couch?'couch-game':'private-game',{protocolVersion:1,capacity,course:'generated',seed:1,...(couch?{role:'display',displaySecret:'b'.repeat(32)}:{})}),0);
  for(let i=1;i<capacity+(couch?1:0);i++)attach(await sdk.joinById(rooms[0]!.roomId,{protocolVersion:1,...(couch?{role:'controller'}:{})}),i);
  await vi.waitFor(()=>expect(owners.filter(Boolean).length).toBe(rooms.length));
  await vi.waitFor(()=>expect(lobbies[0]?.players.length).toBe(capacity));
  for(let i=couch?1:0;i<rooms.length;i++)command(i,'ready');
  await vi.waitFor(()=>expect(lobbies[0]!.players.every(p=>p.ready)).toBe(true));command(0,'start');
  await vi.waitFor(()=>expect(states[0]?.phase).toBe('running'));
  const first=couch?1:0, initialRun=states[0]!.runGeneration;
  // Existing 500-ms command cooldown applies after start as well as restart.
  await new Promise(r=>setTimeout(r,550));
  command(first,'restart');
  await vi.waitFor(()=>expect(lobbies[0]!.players.find(p=>p.slot===('slot' in owners[first]!?owners[first]!.slot:undefined))?.restartRequested).toBe(true));
  expect(states[0]!.runGeneration).toBe(initialRun);
  for(let i=first+1;i<rooms.length;i++)command(i,'restart');
  await vi.waitFor(()=>expect(states[0]!.runGeneration).toBe(initialRun+1));
  neutral.fill(true);drive=true;
  await vi.waitFor(()=>expect(states[0]?.players.every(p=>p.position.z>11.4)).toBe(true),{timeout:12000});
  drive=false;
  // Park physically before pausing: a retained 5-m/s velocity must not coast out
  // of the hazard after reclaim and invalidate the intended impact fixture.
  await vi.waitFor(()=>expect(states[0]!.players.every(p=>Math.abs(p.velocity.z)<.1 && p.position.z>11.3 && p.position.z<13.2)).toBe(true),{timeout:2000});
  const dropIndex=couch?2:1,token=rooms[dropIndex]!.reconnectionToken,oldOwner=owners[dropIndex]!.connectionGeneration;
  rooms[dropIndex]!.connection.close();
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('paused'));
  const paused=states[0]!;expect(paused.world!.seed).toBe(1);await new Promise(r=>setTimeout(r,400));
  expect(states[0]!.run).toEqual(paused.run);expect(states[0]!.world).toEqual(paused.world);expect(states[0]!.chain).toEqual(paused.chain);expect(states[0]!.players).toEqual(paused.players);
  attach(await sdk.reconnect(token),dropIndex);
  await vi.waitFor(()=>expect(owners[dropIndex]?.connectionGeneration).toBeGreaterThan(oldOwner));
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('running'));
  expect(states[0]!.run!.distance).toBeGreaterThanOrEqual(paused.run!.distance);
  expect(states[0]!.runGeneration).toBe(paused.runGeneration);expect(states[dropIndex]?.world?.seed??states[0]!.world!.seed).toBe(1);
  rooms[dropIndex]!.send('input',{protocolVersion:1,sequence:99999,connectionGeneration:owners[dropIndex]!.connectionGeneration,runGeneration:states[0]!.runGeneration,referenceTimeMs:states[0]!.serverTimeMs,x:0,z:0,world:{seed:0}});
  await vi.waitFor(()=>expect(rejections).toContain('invalid-message'));
  command(dropIndex,'restart',{runGeneration:states[0]!.runGeneration-1});
  await vi.waitFor(()=>expect(states[0]!.phase).toBe('ended'),{timeout:19000});
  expect(states[0]!.world!.outcome).toBe('failed');expect(states[0]!.world!.dead.length).toBeGreaterThan(0);expect(states[0]!.world!.water.outcome).toBe('failed');
  if(couch){await vi.waitFor(()=>expect(controls.slice(1).every(c=>c?.outcome==='failed')).toBe(true));expect(phoneSnapshots).toBe(0);}
  else {await vi.waitFor(()=>expect(states[1]!.world).toEqual(states[0]!.world));}
  const generation=states[0]!.runGeneration, finalRun=states[0]!.run!;
  expect(finalRun.roomBest).toBe(finalRun.distance);expect(finalRun.newRecord).toBe(true);
  command(first,'restart');
  await vi.waitFor(()=>expect(lobbies[0]!.players.find(p=>p.slot===('slot' in owners[first]!?owners[first]!.slot:undefined))?.restartRequested).toBe(true));
  expect(states[0]!.run).toEqual(finalRun);expect(states[0]!.runGeneration).toBe(generation);
  for(let i=first;i<rooms.length;i++)command(i,'restart');
  await vi.waitFor(()=>expect(states[0]!.runGeneration).toBe(generation+1));
  expect(states[0]!.run).toMatchObject({distance:0,roomBest:finalRun.distance,previousBest:finalRun.distance,newRecord:false});
  // Polling may observe a valid running tick after reset. Assert the atomic
  // reset packet itself, retained on arrival, rather than racing the next tick.
  expect(firstFrames.get(generation+1)?.world).toMatchObject({elapsedSeconds:0,version:4,seed:1,dead:[],outcome:'active'});
  expect(states[0]!.world!.elapsedSeconds).toBeGreaterThanOrEqual(0);expect(compactSnapshots).toBeGreaterThan(0);
 }catch(error){console.error('Generated socket failure', {capacity,couch,phase:states[0]?.phase,world:states[0]?.world,players:states[0]?.players.map(p=>({id:p.id,z:p.position.z,vz:p.velocity.z})),rejections});throw error;}finally{clearInterval(timer);await Promise.all(rooms.filter(r=>r.connection.isOpen).map(r=>r.leave().catch(()=>{})));await proxy.stop();}
},30000);
