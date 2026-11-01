import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { FollowCamera } from './camera';
import { VisualBounds, imageRange, visualTrainX } from './visual-bounds';
import { railwayPose, railwayTiming, railwayPeriod } from '@crossy/simulation';
import { railwaySettings as rail, generateSection, roadLanes, wrapTrafficX, generatedSettings, vehicleColor } from '@crossy/config';

it('covers actual tilted orthographic ground corners through resize, group zoom, following and projection zoom',()=>{
 for(const [w,h] of [[1920,1080],[1920,1200],[3440,1440],[5120,1440],[480,900],[1100,800]]){
  const c=new FollowCamera(),bounds=new VisualBounds();c.resize(w!,h!);
  for(const z of [0,500,10000])for(const span of [4,18,60]){
   c.update([{x:-9,y:.8,z},{x:9,y:.8,z:z+span}],1,true,{highWater:z,rearLimit:z-7});
   for(const zoom of [1,.5,2]){
    c.camera.zoom=zoom;c.camera.updateProjectionMatrix();bounds.update(c.camera);
    for(const x of [-1,1])for(const y of [-1,1]){
     const a=new Vector3(x,y,-1).unproject(c.camera),b=new Vector3(x,y,1).unproject(c.camera);
     const p=a.clone().lerp(b,-a.y/(b.y-a.y));
     expect(Math.abs(p.x)+6).toBeLessThanOrEqual(bounds.halfWidth+1e-7);
    }
    const retained=bounds.halfWidth;expect(bounds.update(c.camera)).toBe(false);expect(bounds.halfWidth).toBe(retained);
   }
  }
 }
});
it('also intersects downward perspective rays at the terrain plane',()=>{
 const c=new PerspectiveCamera(45,32/9,.1,1000);c.position.set(3,30,-30);c.lookAt(0,0,0);c.updateMatrixWorld();
 const b=new VisualBounds();b.update(c);expect(b.halfWidth).toBeGreaterThan(50);
});
it('keeps whole cars and shadows through both exits, including modulo recycle, without changing schedules/profiles',()=>{
 for(const seed of [1,42,20261016])for(const tier of [0,1,2,3]){
  const s={...generateSection(seed,1,4,undefined,tier),type:'road' as const};
  for(const [i,lane] of roadLanes(s).entries()){
   expect(lane.speed).toBeCloseTo(generatedSettings.laneSpeeds[vehicleColor(s,i)]!*[1,1.05,1.05,1.1][tier]!);
   for(const width of [24,48,160])for(const sign of [-1,1]){
    const center=sign*(width+1.77*.8-.01),[lo,hi]=imageRange(center,lane.period,width,4);expect(lo).toBeLessThanOrEqual(0);expect(hi).toBeGreaterThanOrEqual(0);
    const images=(x:number)=>{const [a,b]=imageRange(x,lane.period,width,4);return Array.from({length:b-a+1},(_,j)=>x+(a+j)*lane.period);};
    const x=lane.period/2-.001,dx=.002*lane.direction;
    const before=images(x).map(v=>v+dx).filter(v=>Math.abs(v)<width+3.9);
    const after=images(wrapTrafficX(x+dx,lane.period));
    for(const v of before)expect(after.some(w=>Math.abs(w-v)<1e-7)).toBe(true);
    // A periodic image outside the primary period cannot enter playable ±10.
    for(const v of images(0))if(v!==0)expect(Math.abs(v)-1.416).toBeGreaterThan(10);
   }
  }
 }
});
it('continues full train transits across dwell/recycle in both directions with exact unchanged corridor occupancy',()=>{
 expect(rail.speed).toBe(35);expect(railwayPeriod()).toBe(7);expect(rail.warningSeconds).toBe(3);
 const timing=railwayTiming();expect(timing.arrival-timing.warning).toBeCloseTo(3);
 for(const direction of [-1,1]){
  const config={...rail,direction};
  for(let tick=0;tick<1680;tick++){
   const t=tick/120,state={...railwayPose(t,config),elapsedSeconds:t,dead:[],outcome:'active' as const};
   const x=visualTrainX(state,direction);
   const local=t-state.pass*7;
   if(local>=rail.safeSeconds)expect(x).toBe(state.x);
   else {expect(x*direction+3.18).toBeLessThanOrEqual(-32.82+1e-7);expect(x*direction+245-12.5).toBeGreaterThanOrEqual(35.5-1e-7);}
   for(const width of [24,80,160]){
    const roots=(time:number)=>{const s={...railwayPose(time,config),elapsedSeconds:time,dead:[],outcome:'active' as const},v=visualTrainX(s,direction);const [a,b]=imageRange(v,245,width,17);return Array.from({length:b-a+1},(_,j)=>v+(a+j)*245);};
    for(const p of roots(t))if(Math.abs(p)<width+16)expect(roots(t+1/120).some(q=>Math.abs(q-p-35*direction/120)<1e-6)).toBe(true);
   }
  }
 }
});

it('continues the outgoing off-corridor train during a held pass-ID interpolation bracket',()=>{
 const s={elapsedSeconds:7.02,pass:0,x:47.3,signal:'safe' as const,dead:[],outcome:'active' as const};
 expect(visualTrainX(s,1)).toBeCloseTo(48.7);
 expect(visualTrainX({...s,x:-47.3},-1)).toBeCloseTo(-48.7);
});
