// Development-only presentation fixture. No sockets, physics, gameplay bypass or production entry.
import { mountGameShell } from './game-shell';
import { GameRenderer } from './renderer';
import { setMenuScene } from './menu-scene';
import { protocolVersion, playerSlots, defaultDisplayName } from '@crossy/protocol';
import type { LobbyMessage, PlayerSlot, SnapshotMessage } from '@crossy/protocol';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const shell=mountGameShell('online'), renderer=new GameRenderer(document.getElementById('viewport')!);setMenuScene(renderer);
await renderer.loadGoose().catch(()=>undefined);await shell.previews.ready;
const fixedTime=Number(new URLSearchParams(location.search).get("cinematicTime"));
let failureStarted=0;
let run=0,frame=0,last=performance.now(),tick=0,restarts=0,clears=0,leaves=0,stopped=false;
const data:LobbyMessage={protocolVersion,capacity:4,code:'REVIEW42',epoch:1,revision:1,runGeneration:0,stage:'lobby',host:'p1',players:playerSlots.map(slot=>({slot,displayName:defaultDisplayName(slot),connected:true,ready:slot!=='p1',restartRequested:false}))};
function snapshot(phase:'running'|'ended'|'waiting',slot:PlayerSlot='p1'):SnapshotMessage{return {protocolVersion,scenarioVersion:3,runGeneration:run,tick:++tick,serverTimeMs:performance.now(),droppedSeconds:0,phase,players:playerSlots.map((id,i)=>({id,position:{x:6-i*4,y:.77,z:0},velocity:{x:0,y:0,z:0},grounded:true,acknowledgedSequence:0})),road:{elapsedSeconds:0,vehicles:[],dead:phase==='ended'?[slot]:[],outcome:phase==='ended'?'failed':'active'}};}
function showFailure(slot:PlayerSlot){failureStarted=performance.now();run++;shell.snapshot(snapshot('running'));shell.snapshot(snapshot('ended',slot));}
shell.bind({clearInput:()=>clears++,hostStart:()=>{run++;shell.snapshot(snapshot('running'));},ready:()=>undefined,restart:()=>{restarts++;run++;shell.snapshot(snapshot('running'));},leave:async()=>{leaves++;await Promise.resolve();shell.connection(false,false);}});
shell.connection(true,true);shell.lobby(data,'p1');
const controls=document.createElement('div');controls.style.cssText='position:fixed;bottom:5px;left:5px;right:5px;z-index:20;display:flex;flex-wrap:wrap;gap:5px;align-items:center;background:#f5f1e8e8;padding:5px;border:1px solid #303b34;font-size:11px';
controls.append(document.createTextNode('SYNTHETIC · NO ROOM / PHYSICS'));
for(const slot of playerSlots){const b=document.createElement('button');b.textContent=`Failure ${slot}`;b.style.cssText='font-size:11px;min-height:28px;padding:3px 8px';b.onclick=()=>showFailure(slot);controls.append(b);}
const checks=document.createElement('button');checks.textContent='Run bounded UI checks';checks.style.cssText='font-size:11px;min-height:28px;padding:3px 8px';controls.append(checks);
const output=document.createElement('output');output.id='gui-check-output';controls.append(output);document.body.append(controls);
const assert=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);};
checks.onclick=async()=>{
 checks.disabled=true;const failures:string[]=[];let passed=0;const check=(label:string,fn:()=>void)=>{try{fn();passed++;}catch(e){failures.push(`${label}: ${String(e)}`);}};
 check('viewport fills browser',()=>assert(document.getElementById('viewport')!.getBoundingClientRect().height===innerHeight,'Viewport height mismatch'));
 check('pixel font loaded',()=>assert(document.fonts.check('700 24px Pixelify'),'Font not loaded'));
 check('four original previews loaded',()=>assert(shell.previews.metrics().loadedModels===4,'Missing original preview'));
 check('single preview + world renderer',()=>assert(document.querySelectorAll('canvas').length===2,'Duplicate canvas'));
 check('active slots cannot be removed',()=>assert((document.querySelector('[data-remove="p4"]') as HTMLButtonElement).disabled,'Active capacity mutable'));
 document.getElementById('show-invite')!.click();shell.snapshot(snapshot('waiting'));
 check('first waiting snapshot preserves invitations',()=>assert((document.getElementById('invite-dialog') as HTMLDialogElement).open,'First snapshot closed invitations'));
 check('existing room shows details instead of creation',()=>assert(document.getElementById('room-entry')!.hidden&&!document.getElementById('room-details')!.hidden&&!document.getElementById('room-share')!.hidden,'Wrong room panel state'));
 document.getElementById('invite-close')!.click();check('manual close preserves room',()=>assert(!(document.getElementById('invite-dialog') as HTMLDialogElement).open&&document.getElementById('room-summary')!.textContent?.includes('REVIEW42'),'Close left room'));
 document.getElementById('mode-local')!.click();check('mode switch opens warning',()=>assert((document.getElementById('mode-warning') as HTMLDialogElement).open,'Missing warning'));
 document.getElementById('mode-leave')!.click();check('warning leave requires confirmation',()=>assert((document.getElementById('leave-dialog') as HTMLDialogElement).open&&leaves===0,'Leave bypassed confirmation'));
 document.getElementById('leave-cancel')!.click();check('cancel preserves room and warning',()=>assert(leaves===0&&(document.getElementById('mode-warning') as HTMLDialogElement).open,'Cancel disconnected'));
 document.getElementById('mode-stay')!.click();
 const residentBefore=shell.previews.metrics().geometries;
 const before=shell.previews.metrics().renderedFrames;shell.snapshot(snapshot('running'));shell.draw(performance.now()+1000);
 check('hidden previews stop updating',()=>assert(shell.previews.metrics().renderedFrames===before,'Preview updates during gameplay'));
 for(const slot of playerSlots){
  showFailure(slot);check(`${slot} death`,()=>assert(!document.getElementById('cinematic-screen')!.hidden,'Missing cinematic'));
  const event=new KeyboardEvent('keydown',{code:'Enter',key:'Enter',bubbles:true,cancelable:true});window.dispatchEvent(event);
  check(`${slot} skip`,()=>assert(event.defaultPrevented&&!document.getElementById('results-screen')!.hidden,'Skip not consumed/results missing'));
  const held=new KeyboardEvent('keydown',{code:'Enter',repeat:true,bubbles:true,cancelable:true});window.dispatchEvent(held);check(`${slot} held skip`,()=>assert(held.defaultPrevented&&restarts===0,'Held skip escaped'));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Enter',bubbles:true,cancelable:true}));
  const ended=snapshot('ended',slot);shell.snapshot(ended);check(`${slot} duplicate`,()=>assert(!document.getElementById('results-screen')!.hidden,'Duplicate cinematic'));
  check(`${slot} victim`,()=>assert(document.getElementById('failure-name')!.textContent===defaultDisplayName(slot),'Wrong victim'));
 }
 check('skip does not vote',()=>assert(restarts===0,'Skip voted'));
 for(let i=0;i<20;i++){run++;shell.snapshot(snapshot('running'));shell.snapshot(snapshot('ended',playerSlots[i%4]!));window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',bubbles:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Enter',bubbles:true,cancelable:true}));shell.draw(performance.now()+i*40);}
 check('repeated transitions keep two canvases',()=>assert(document.querySelectorAll('canvas').length===2,'Transition duplicated renderer'));
 check('GPU preview resources unchanged',()=>assert(shell.previews.metrics().geometries===residentBefore,'Preview geometry growth'));
 check('input neutral on every terminal transition',()=>assert(clears>=24,'Terminal did not clear input'));
 document.getElementById('results-leave')!.click();check('results leave requires confirmation',()=>assert(leaves===0&&(document.getElementById('leave-dialog') as HTMLDialogElement).open,'Results left without confirmation'));
 document.getElementById('leave-confirm')!.click();document.getElementById('leave-confirm')!.click();await Promise.resolve();await Promise.resolve();
 check('leave sent once',()=>assert(leaves===1,'Duplicate leave'));
 check('leave returns menu',()=>assert(!document.getElementById('game-menu')!.hidden,'Menu not restored'));
 output.textContent=JSON.stringify({passed,failures,cycles:20,preview:shell.previews.metrics(),canvases:document.querySelectorAll('canvas').length});checks.disabled=false;
};
const showMetrics = new URLSearchParams(location.search).has('performance');
const metricsPanel = document.createElement('pre');
if (showMetrics) {
 metricsPanel.style.cssText = 'position:fixed;right:4px;top:4px;max-width:450px;z-index:30;background:#fff8;color:#102128;font:11px monospace;pointer-events:none';
 document.body.append(metricsPanel);
}
let metricAt = 0;
function updateMetrics(now:number):void {
 if (!showMetrics || now-metricAt<=1000) return;
 metricAt = now;
 const glbs = performance.getEntriesByType('resource').filter(e=>/\.glb(?:\?|$)/.test(e.name)&&!/[?&](?:import|url)(?:&|$)/.test(e.name)) as PerformanceResourceTiming[];
 const raw = document.getElementById('gui-metrics')!.textContent ?? '';
 metricsPanel.textContent = (raw.startsWith('{') ? JSON.stringify(JSON.parse(raw)) : raw)
  + '\nGLB resources ' + JSON.stringify({requests:glbs.length,unique:new Set(glbs.map(e=>e.name)).size,
   encodedBytes:glbs.reduce((n,e)=>n+e.encodedBodySize,0),transferBytes:glbs.reduce((n,e)=>n+e.transferSize,0)});
}
function draw(now:number){if(stopped)return;updateMetrics(now);const started=performance.now();renderer.draw();shell.recordGameRender({calls:renderer.renderer.info.render.calls,triangles:renderer.renderer.info.render.triangles,...renderer.renderer.info.memory},performance.now()-started);shell.draw(failureStarted && fixedTime>0 ? failureStarted+fixedTime*1000 : now);last=now;frame=requestAnimationFrame(draw);}
void last;frame=requestAnimationFrame(draw);
const dispose=()=>{stopped=true;cancelAnimationFrame(frame);shell.dispose();renderer.dispose();controls.remove();metricsPanel.remove();};if(import.meta.hot)import.meta.hot.dispose(dispose);
