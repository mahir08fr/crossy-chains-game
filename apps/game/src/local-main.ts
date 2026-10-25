import { generatedScenario, groupScenario, railwayScenario, riverScenario, roadScenario, settings } from '@crossy/config';
import { FixedStepClock, FoundationSimulation, initializePhysics } from '@crossy/simulation';
import type { PlayerSlot, LobbyMessage, SnapshotMessage } from '@crossy/protocol';
import { protocolVersion, defaultDisplayName } from '@crossy/protocol';
import { EndlessRunScore } from '../../server/src/endless-run';
import { gameShell } from './game-shell';
import { SharedScene } from './shared-scene';
import { KeyboardInput } from './input';
import { setMenuScene } from './menu-scene';

// Two established keyboard sources only. Larger local teams use the phone display adapter.
await initializePhysics();
const shell = gameShell!, viewport = document.getElementById('viewport')!;
const scene = new SharedScene(viewport,document.getElementById('player-labels')!); setMenuScene(scene.renderer);
const events = new AbortController(), options = {signal:events.signal};
let simulation: FoundationSimulation | undefined, frame = 0, previous = performance.now(), generation = 0, tick = 0, disposed = false, snapTime = 0;
let lastSafe:SnapshotMessage|undefined;
let active = false, terminal = false, selectedCourse = 'generated';
const score = new EndlessRunScore(), clock = new FixedStepClock(settings.physics.tickSeconds,settings.physics.maxCatchUpTicks);
const ready = new Set<PlayerSlot>(), names = new Map<PlayerSlot,string>();
function lobby(): LobbyMessage {
  return {protocolVersion,capacity:shell.desiredCapacity,code:'LOCAL',epoch:0,revision:tick,runGeneration:generation,stage:active?'playing':'lobby',host:'p1',players:(['p1','p2'] as const).map(slot=>({slot,connected:true,ready:ready.has(slot),restartRequested:false,displayName:names.get(slot)??defaultDisplayName(slot)}))};
}
function refresh(): void { const data=lobby(); shell.lobby(data,'p1'); scene.renderer.setNames(data); }
// Local mode owns its simulation; a single shared restart resets both keyboard seats.
function start(): void {
  if (active || ready.size!==2 || shell.desiredCapacity!==2) return;
  selectedCourse = (document.getElementById('course') as HTMLSelectElement).value;
  const scenario = groupScenario(selectedCourse==='generated'?generatedScenario:selectedCourse==='railway'?railwayScenario:selectedCourse==='river'?riverScenario:roadScenario,2);
  const field = document.getElementById('world-seed') as HTMLInputElement;
  const seed = field.value === '' ? crypto.getRandomValues(new Uint32Array(1))[0]! : Number(field.value);
  if (!Number.isInteger(seed)||seed<0||seed>4294967295) { document.getElementById('menu-feedback')!.textContent='Use a whole seed from 0 to 4294967295.';return; }
  simulation?.dispose(); simulation = new FoundationSimulation(scenario.players,scenario.boxes,true,scenario.obstacles,selectedCourse==='road',selectedCourse==='river',selectedCourse==='railway',selectedCourse==='generated'?seed:undefined);
  generation++; tick=0; score.reset(); clock.reset(); scene.clear(); input.clear('start'); active=true;terminal=false; shell.lobby(lobby(),'p1'); push(performance.now()); viewport.focus();
}
function restart(): void {
  if (!simulation || !active) return;
  simulation.reset(); generation++;tick=0;score.reset();clock.reset();scene.clear();input.clear('reset');terminal=false;push(performance.now());
}
const input = new KeyboardInput(()=>{if(!shell.inputBlocked)restart();},()=>undefined);
shell.bind({clearInput:()=>input.clear('menu'),hostStart:start,ready:slot=>{if(!slot||active)return; ready.has(slot)?ready.delete(slot):ready.add(slot);refresh();},restart,
  name:(slot,value)=>{if(active)return;names.set(slot,value);refresh();},
  leave:async()=>{input.clear('leave');simulation?.dispose();simulation=undefined;active=false;terminal=false;ready.clear();clock.reset();scene.clear();setMenuScene(scene.renderer);},
});
// Local cards are authoritative UI state; editing does not target any remote participant.
shell.connection(true,false);
function push(now:number): void {
  if(!simulation)return;
  if(simulation.fault && lastSafe){const stopped={...lastSafe,tick:++tick,serverTimeMs:now,phase:'fault' as const};scene.push(stopped,now);shell.snapshot(stopped,now);terminal=true;return;}
  const world=simulation.generatedState(), road=simulation.roadState(),river=simulation.riverState(),railway=simulation.railwayState();
  terminal=!!simulation.fault || (world??railway??river??road)?.outcome!=='active';
  const states=simulation.states(); if(world)score.advance(states,world.outcome==='failed');
  const snapshot:SnapshotMessage={protocolVersion,scenarioVersion:world?7:railway?6:river?5:3,runGeneration:generation,tick:++tick,serverTimeMs:now,phase:simulation.fault?'fault':terminal?'ended':shell.inputBlocked?'paused':'running',droppedSeconds:clock.droppedSeconds,
    players:states.map(({tick:_tick,...p})=>({...p,acknowledgedSequence:0})),chain:{course:selectedCourse as 'generated'|'road'|'river'|'railway',endpoints:['p1','p2'],segments:simulation.chainStates()},
    ...(world?{world,run:score.state()}:{}),...(road?{road}:{}),...(river?{river}:{}),...(railway?{railway}:{})};
  lastSafe=snapshot;scene.push(snapshot,now);shell.snapshot(snapshot,now);
}
let lastMenuDraw=0;
function draw(now:number):void {
  if(disposed)return;
  const elapsed=Math.max(0,(now-previous)/1000);previous=now;
  if(active&&simulation){
    if(shell.inputBlocked||input.paused||elapsed>=.25||terminal){clock.reset();if(elapsed>=.25||input.paused)input.clear('local-stall');}
    else clock.advance(elapsed,()=>simulation!.step(input.sample()));
    if(now-snapTime>=1000/30){snapTime=now;push(now);}
  }
  if(!shell.inMenu||now-lastMenuDraw>=100){const start=performance.now();scene.draw(now,Math.min(.1,elapsed));lastMenuDraw=now;const info=scene.renderer.renderer.info;shell.recordGameRender({calls:info.render.calls,triangles:info.render.triangles,...info.memory},performance.now()-start);}
  shell.draw(now);frame=requestAnimationFrame(draw);
}
frame=requestAnimationFrame(draw);
document.getElementById('fullscreen')!.addEventListener('click',()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen?.().catch(()=>undefined);},options);
window.addEventListener('pagehide',()=>input.clear('pagehide'),options);
const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(frame);events.abort();input.dispose();simulation?.dispose();scene.dispose();};
if(import.meta.hot)import.meta.hot.dispose(dispose);
