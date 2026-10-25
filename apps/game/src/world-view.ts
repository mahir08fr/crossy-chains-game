import { grassMaterial, asphaltMaterial, flowingWater } from './environment-materials';
import { BoxGeometry, CylinderGeometry, GridHelper, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, RingGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { riverSettings, roadSettings } from '@crossy/config';
import type { Scenario } from '@crossy/config';

export function createWorldView(scenario: Scenario): Group {
  const group = new Group();
  const materials = {
    ground: ['road','river','railway'].includes(scenario.id) ? grassMaterial() : new MeshStandardMaterial({ color: 0x64998b, roughness: 1 }),
    boundary: new MeshStandardMaterial({ color: 0x38645e, roughness: 0.95 }),
    obstacle: new MeshStandardMaterial({ color: 0xe2dec8, roughness: 0.9 }),
  };
  group.userData.seamless=['road','river','railway'].includes(scenario.id);
  for (const box of scenario.boxes) {
    const mesh = new Mesh(new BoxGeometry(box.halfSize.x * 2, box.halfSize.y * 2, box.halfSize.z * 2), materials[box.kind]);
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    mesh.rotation.x = box.rotationX ?? 0;
    if(group.userData.seamless){
      if(box.kind==='ground')mesh.userData.continuationWidth=box.halfSize.x*2;
      if(box.id==='left-wall'||box.id==='right-wall')mesh.visible=false;
    }
    mesh.castShadow = box.kind !== 'ground';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const obstacle of scenario.obstacles ?? []) {
    const geometry = obstacle.shape === 'post'
      ? new CylinderGeometry(obstacle.radius, obstacle.radius, obstacle.halfHeight * 2, 24)
      : new RoundedBoxGeometry((obstacle.halfSize.x + obstacle.borderRadius) * 2, (obstacle.halfSize.y + obstacle.borderRadius) * 2, (obstacle.halfSize.z + obstacle.borderRadius) * 2, 4, obstacle.borderRadius);
    const mesh = new Mesh(geometry, materials.obstacle);
    mesh.position.set(obstacle.center.x, obstacle.center.y, obstacle.center.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (scenario.id === 'railway' || scenario.id === 'generated') return group;
  if (scenario.id === 'river') {
    const water = new Mesh(new PlaneGeometry(riverSettings.halfWidth * 2, riverSettings.maxZ - riverSettings.minZ),
      flowingWater());
    water.userData.continuationWidth=riverSettings.halfWidth*2;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, riverSettings.surfaceY, (riverSettings.minZ + riverSettings.maxZ) / 2); group.add(water);
    const lineMaterial = new MeshStandardMaterial({ color: 0xf3e5ba });
    for (const z of [riverSettings.minZ, riverSettings.maxZ, riverSettings.finishZ]) {
      const line = new Mesh(new PlaneGeometry(20, 0.08), lineMaterial);
      line.userData.continuationWidth=20;
      line.rotation.x = -Math.PI / 2; line.position.set(0, 0.035, z); group.add(line);
    }
    return group;
  }
  if (scenario.id === 'road') {
    const paint = new MeshStandardMaterial({ color: 0xf3e5ba, roughness: 1 });
    const asphalt = asphaltMaterial();
    const addStrip = (width: number, depth: number, x: number, z: number, material: MeshStandardMaterial, y = 0.012) => {
      const mesh = new Mesh(new PlaneGeometry(width, depth), material);
      if(width===36)mesh.userData.continuationWidth=width;
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.receiveShadow = true; group.add(mesh);
    };
    addStrip(36, 6, 0, 4.5, asphalt);
    addStrip(36, 3, 0, 11, asphalt);
    for (const z of [1.5, 7.5, 9.5, 12.5]) addStrip(36, 0.09, 0, z, paint, 0.018);
    for (let x = -17; x < 18; x += 3) addStrip(1.5, 0.1, x, 4.5, paint, 0.018);
    const dashes=new InstancedMesh(new BoxGeometry(1.5,.01,.1),paint,1);
    dashes.userData.continuationDashes=true;group.add(dashes);
    // World-space arrow chevrons communicate each lane's fixed direction.
    roadSettings.lanes.forEach(lane => {
      for (const sign of [-1, 1]) {
        const stripe = new Mesh(new PlaneGeometry(0.8, 0.10), paint);
        stripe.rotation.set(-Math.PI / 2, 0, sign * Math.PI / 4);
        stripe.position.set(0, 0.02, lane.z + sign * lane.direction * 0.27); group.add(stripe);
      }
    });
    for (let x = -9.5; x < 10; x++) addStrip(0.5, 0.6, x, roadSettings.finishZ, paint);
    return group;
  }
  const grid = new GridHelper(24, 24, 0x598c7f, 0x598c7f);
  grid.position.set(0, 0.006, 2);
  group.add(grid);
  for (const player of scenario.players) {
    const spawn = new Mesh(new RingGeometry(0.8, 0.86, 40), new MeshStandardMaterial({ color: player.color, roughness: 1 }));
    spawn.rotation.x = -Math.PI / 2;
    spawn.position.set(player.spawn.x, 0.012, player.spawn.z);
    group.add(spawn);
  }
  // Flat guide marks are visual only, not progression/checkpoint gameplay.
  const stripeMaterial = new MeshStandardMaterial({ color: 0xa9c5ae, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const stripe = new Mesh(new PlaneGeometry(0.08, 0.5), stripeMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.01, -3.5 + i * 3);
    group.add(stripe);
  }
  return group;
}

/** Original course colliders are untouched; only hazard fixture visuals widen.
 * Development playground retains its visible diagnostic walls and grid. */
export function extendWorldView(root:Group,halfWidth:number): void {
  if(!root.userData.seamless||root.userData.visualHalfWidth===halfWidth)return;
  root.userData.visualHalfWidth=halfWidth;
  for(const child of [...root.children]){
    if(!(child instanceof Mesh))continue;
    const width=child.userData.continuationWidth as number|undefined;
    if(width)child.scale.x=halfWidth*2/width;
    if(child instanceof InstancedMesh && child.userData.continuationDashes){
      const count=Math.ceil(halfWidth*2/3),marks=new InstancedMesh(child.geometry,child.material,count),matrix=new Matrix4();
      marks.userData.continuationDashes=true;let n=0;
      for(let i=Math.ceil(-halfWidth/3);i*3<halfWidth;i++){
        const x=i*3+1; // preserve the original −17 + 3n marking alignment
        if(x>=-17&&x<18)continue;
        matrix.makeTranslation(x,.018,4.5);marks.setMatrixAt(n++,matrix);
      }
      marks.count=n;marks.instanceMatrix.needsUpdate=true;root.remove(child);child.dispose();root.add(marks);
    }
  }
}
