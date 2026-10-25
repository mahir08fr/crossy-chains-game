import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FollowCamera } from './camera';

it('frames both players across anticipated separation and viewport shapes without rotating input axes', () => {
  for (const [width, height] of [[1920, 1080], [800, 800], [500, 900]]) {
    const camera = new FollowCamera();
    camera.resize(width!, height!);
    for (const positions of [
      [{ x: 3, y: 0.8, z: 0 }, { x: -3, y: 0.8, z: 0 }],
      [{ x: 0, y: 0.8, z: -3 }, { x: 0, y: 0.8, z: 3 }],
      [{ x: -10, y: 0.8, z: 5 }, { x: 10, y: 0.8, z: 5 }],
    ]) {
      camera.update(positions, 1 / 60, true);
      const rotation = camera.camera.quaternion.clone();
      for (const point of positions) {
        const projected = new Vector3(point.x, point.y, point.z).project(camera.camera);
        expect(Math.abs(projected.x)).toBeLessThan(0.85);
        expect(Math.abs(projected.y)).toBeLessThan(0.85);
      }
      camera.update(positions.map((p) => ({ ...p, z: p.z + 0.1 })), 1 / 60);
      expect(camera.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-6);
    }
  }
});
it('frames four players, three cables and nearby lane hazards at supported aspect ratios', () => {
  for (const [width, height] of [[1920, 1080], [800, 800], [500, 900]]) {
    const camera = new FollowCamera(); camera.resize(width!, height!);
    const points = [{ x: -9, y: 0.8, z: 0 }, { x: -3, y: 0.8, z: 1 }, { x: 3, y: 0.8, z: 1 }, { x: 9, y: 0.8, z: 0 }];
    camera.update(points, 1 / 60, true);
    for (const point of [...points, { x: 0, y: 1, z: 6 }]) {
      const p = new Vector3(point.x, point.y, point.z).project(camera.camera);
      expect(Math.abs(p.x)).toBeLessThan(0.9); expect(Math.abs(p.y)).toBeLessThan(0.9);
    }
  }
});

it('authoritative generated progression never reverses with backtracking and snaps only on a new run/reclaim',()=>{
 const c=new FollowCamera();c.resize(1000,800);
 const p=(z:number)=>[{x:-6,y:.8,z},{x:6,y:.8,z:z+2}];
 c.update(p(0),1,true,{highWater:0,rearLimit:-6.7});let z=c.camera.position.z;
 for(let i=0;i<120;i++){
  const highWater=Math.min(i/4,20);c.update(p(i<80?highWater:highWater-5),1/60,false,{highWater,rearLimit:Math.max(-6.7,highWater-7)});
  expect(c.camera.position.z).toBeGreaterThanOrEqual(z);z=c.camera.position.z;
 }
 c.update(p(15),1,true,{highWater:20,rearLimit:13});expect(c.camera.position.z).toBeCloseTo(5);
 c.update(p(0),1,true,{highWater:0,rearLimit:-6.7});expect(c.camera.position.z).toBeCloseTo(-15);
});
