import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { protocolVersion } from '@crossy/protocol';
import type { LobbyMessage } from '@crossy/protocol';
import type { GuiAdapter } from './game-shell';
import type { TransportCallbacks } from './network-client';
const stub=vi.hoisted(()=>({callbacks:undefined as TransportCallbacks|undefined,adapter:undefined as GuiAdapter|undefined,command:vi.fn(),send:vi.fn(),blocked:false}));
vi.mock('./game-shell',()=>({gameShell:{get inputBlocked(){return stub.blocked;},inMenu:true,bind:(adapter:GuiAdapter)=>stub.adapter=adapter,connection(){},lobby(){},snapshot(){},draw(){}}}));
vi.mock('./menu-scene',()=>({setMenuScene(){}}));
vi.mock('./network-client',()=>({TransportTestClient:class{constructor(_e:string,c:TransportCallbacks){stub.callbacks=c;}active=true;connected=true;canRejoin=false;lobbyAction=stub.command;sendInput=stub.send;probe(){}reset(){}suspend(){}dispose(){}async leave(){}async connect(){return 'ABCDEFGH';}}}));
vi.mock('./renderer',()=>({GameRenderer:class{chain={group:{visible:true},setCount(){},update(){}};players=new Map(['p1','p2'].map(id=>[id,{reset(){},update(){},setWater(){},setDead(){}}]));labels={resetNames(){}};camera={update(){}};setNames(){}observeSnapshot(){}clearEffects(){}setScenario(){}async loadGoose(){}draw(){}dispose(){}}}));
class Element extends EventTarget {value='';textContent='';disabled=false;hidden=false;focus(){}select(){}append(){}setAttribute(){}remove(){}}
let windowEvents:EventTarget;
const lobby=():LobbyMessage=>({protocolVersion,capacity:2,code:'ABCDEFGH',epoch:2,revision:2,runGeneration:0,stage:'lobby',host:'p1',players:[{slot:'p1',connected:true,ready:false,restartRequested:false},{slot:'p2',connected:true,ready:true,restartRequested:false}]});
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers({toFake:['setInterval','clearInterval','performance']});stub.command.mockClear();stub.send.mockClear();stub.blocked=false;
 const nodes=new Map<string,Element>();windowEvents=new EventTarget();
 vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true,createElement:()=>new Element(),getElementById:(id:string)=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}}));
 vi.stubGlobal('window',Object.assign(windowEvents,{setInterval,location:{pathname:'/play.html',protocol:'http:',search:'',hash:'',href:'http://127.0.0.1:5173/play.html'}}));
 vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
 await import('./multiplayer-main');
 stub.callbacks!.welcome!({protocolVersion,slot:'p1',connectionGeneration:1,runGeneration:0,serverTimeMs:100});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
it('Start explicitly readies the host and waits for authoritative echo before starting once',()=>{
 const data=lobby();stub.callbacks!.lobby!(data);stub.adapter!.hostStart();expect(stub.command.mock.calls).toEqual([['ready']]);
 data.players[0]!.ready=true;data.revision++;stub.callbacks!.lobby!(data);stub.callbacks!.lobby!(data);expect(stub.command.mock.calls).toEqual([['ready'],['start']]);
});
it('cancels queued start when membership epoch changes',()=>{
 const data=lobby();stub.callbacks!.lobby!(data);stub.adapter!.hostStart();data.epoch++;data.players[0]!.ready=true;stub.callbacks!.lobby!(data);expect(stub.command.mock.calls).toEqual([['ready']]);
});
it('never prepares a start for a nonhost or missing/unready peer',()=>{
 const data=lobby();data.host='p2';stub.callbacks!.lobby!(data);stub.adapter!.hostStart();expect(stub.command).not.toHaveBeenCalled();
 data.host='p1';data.players[1]!.ready=false;stub.callbacks!.lobby!(data);stub.adapter!.hostStart();expect(stub.command).not.toHaveBeenCalled();
});
it('cancels queued start on lost connection or rejected action',()=>{
 const data=lobby();stub.callbacks!.lobby!(data);stub.adapter!.hostStart();stub.callbacks!.status('Disconnected',false);data.players[0]!.ready=true;stub.callbacks!.lobby!(data);expect(stub.command.mock.calls).toEqual([['ready']]);
});
it('a menu clear sends immediate neutral and blocks held movement without changing 250-ms safety',()=>{
 stub.callbacks!.snapshot!({protocolVersion,scenarioVersion:1,runGeneration:1,tick:1,serverTimeMs:1000,phase:'running',droppedSeconds:0,players:['p1','p2'].map(id=>({id:id as 'p1'|'p2',position:{x:0,y:1,z:0},velocity:{x:0,y:0,z:0},grounded:true,acknowledgedSequence:0}))});
 const key=()=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{code:'KeyW',repeat:false});windowEvents.dispatchEvent(e);};
 key();vi.advanceTimersByTime(35);expect(stub.send.mock.calls.at(-1)).toEqual([0,1]);
 stub.blocked=true;stub.adapter!.clearInput();key();vi.advanceTimersByTime(35);expect(stub.send.mock.calls.at(-1)).toEqual([0,0]);
 stub.adapter!.clearInput();stub.blocked=false;vi.advanceTimersByTime(35);expect(stub.send.mock.calls.at(-1)).toEqual([0,0]);
 key();vi.advanceTimersByTime(35);expect(stub.send.mock.calls.at(-1)).toEqual([0,1]);
});
