import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { imageRange, visualTrainX } from './visual-bounds';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { MotionRailway } from '@crossy/protocol';
import { railwaySettings as rail } from '@crossy/config';
// The approved batching helper bakes rigid meshes by material, independent of car art.
import { batchStaticCar as batchStaticModel } from './static-car';
import { disposeTraffic } from './traffic-view';
import locomotiveUrl from '../../../assets/train/output/train_004/locomotive.glb?url';
import boxcarUrl from '../../../assets/train/output/train_004/boxcar.glb?url';
import wagonUrl from '../../../assets/train/output/train_004/open_wagon.glb?url';

export class RailwayView {
  readonly group = new Group();
  readonly train = new Group();
  private readonly lights = new MeshStandardMaterial({ color: 0x64d98b, emissive: 0x205528 });
  private loading: Promise<void> | undefined;
  private disposed = false;
  private failed = false;
  constructor() {
    this.group.add(this.train); this.group.visible = false;
    this.train.rotation.y = rail.direction * Math.PI / 2;
    this.train.position.set(rail.entryX * rail.direction, rail.railTopY, rail.z);
    const steel = new MeshStandardMaterial({ color: 0x9ba5a0, roughness: 0.65, metalness: 0.15 });
    for (const side of [-1, 1]) {
      const line = new Mesh(new BoxGeometry(72, 0.06, 0.08), steel);
      line.userData.continuation='rail';line.position.set(0, rail.railTopY - 0.03, rail.z + side * 0.84); this.group.add(line);
      const post = new Mesh(new BoxGeometry(0.14, 1.4, 0.14), steel);
      post.castShadow = true; post.receiveShadow = true;
      post.position.set(side * 8, 0.7, rail.z - side * 2.2); this.group.add(post);
      const lamp = new Mesh(new BoxGeometry(0.45, 0.45, 0.16), this.lights);
      lamp.castShadow = true; lamp.receiveShadow = true;
      lamp.position.set(side * 8, 1.4, rail.z - side * 2.2); this.group.add(lamp);
    }
    const ties = new InstancedMesh(new BoxGeometry(0.2, 0.04, 2.4), new MeshStandardMaterial({ color: 0x695044 }), 72);
    const matrix = new Matrix4();
    for (let i = 0; i < 72; i++) { matrix.makeTranslation(i - 35.5, 0.018, rail.z); ties.setMatrixAt(i, matrix); }
    ties.userData.continuation='ties';ties.instanceMatrix.needsUpdate = true; this.group.add(ties);
    const paint = new MeshStandardMaterial({ color: 0xf3e5ba });
    for (const z of [1.9, 6.1, rail.finishZ]) {
      const stripe = new Mesh(new BoxGeometry(19, 0.015, 0.08), paint); stripe.userData.continuation='stripe';stripe.position.set(0, 0.01, z); this.group.add(stripe);
    }
    // Functional fallback is collision-aligned and clearly reported if GLB loading fails.
    rail.modules.forEach(m => {
      const mesh = new Mesh(new BoxGeometry(m.width, m.height, m.length), new MeshStandardMaterial({ color: 0xb66c45 }));
      mesh.position.set(0, m.height / 2, m.offset); this.train.add(mesh);
    });
  }
  load(): Promise<void> { return this.loading ??= this.loadModels(); }
  private async loadModels(): Promise<void> {
    // allSettled owns successful resources even if another module fails.
    const results = await Promise.allSettled([locomotiveUrl, boxcarUrl, wagonUrl].map(url => new GLTFLoader().loadAsync(url)));
    const templates: Group[] = [];
    try {
      if (this.disposed || results.some(r => r.status === 'rejected')) {
        if (!this.disposed) throw new Error('Train asset unavailable');
        return;
      }
      for (const result of results) if (result.status === 'fulfilled') templates.push(batchStaticModel(result.value.scene));
      for (const child of this.train.children) disposeTraffic(child); this.train.clear();
      templates.forEach((template, i) => {
        template.position.z = rail.modules[i]!.offset;
        template.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
        this.train.add(template);
      });
      for(const copy of (this.group.userData.trainCopies as Group[]|undefined)??[])this.group.remove(copy);
      this.group.userData.trainCopies=undefined;
      this.group.userData.asset = 'train_004 modular GLBs loaded';
    } catch (error) {
      this.failed = true;
      for (const template of templates) disposeTraffic(template);
      throw error;
    } finally {
      // Merged geometry owns copies; successful templates retain original materials.
      for (const result of results) if (result.status === 'fulfilled') {
        const geometries = new Set<import('three').BufferGeometry>();
        result.value.scene.traverse(o => { if (o instanceof Mesh) geometries.add(o.geometry); });
        geometries.forEach(g => g.dispose());
        if (this.disposed || this.failed) disposeTraffic(result.value.scene);
      }
    }
  }
  private halfWidth=36;
  private latest:MotionRailway|undefined;
  setVisualHalfWidth(width:number): void {
    if(width<=this.halfWidth)return;
    this.halfWidth=width;extendRailway(this.group,width);
    if(this.latest)this.update(this.latest);
  }
  update(state: MotionRailway): void {
    this.latest=state;presentTrain(this.group,this.train,state,rail.direction,this.halfWidth);
    const color = state.signal === 'safe' ? 0x64d98b : state.signal === 'warning' ? 0xffba42 : 0xf04747;
    this.lights.color.setHex(color); this.lights.emissive.setHex(color);
    this.lights.emissiveIntensity = state.signal === 'warning' ? (Math.floor(state.elapsedSeconds * 4) % 2 ? 0.7 : 0.15) : 0.4;
  }
  dispose(): void { this.disposed = true; disposeTraffic(this.group); this.group.traverse(o => { if (o instanceof InstancedMesh) o.dispose(); }); this.group.clear(); }
}

/** Reconfigure only at coverage growth/section creation. Shared template geometry
 * is retained; cloned sleepers own only their instance buffers. */
export function extendRailway(root:Group,halfWidth:number): void {
  for(const child of [...root.children]){
    if(!(child instanceof Mesh))continue;
    if(child.userData.continuation==='rail')child.scale.x=halfWidth/36;
    if(child.userData.continuation==='stripe')child.scale.x=halfWidth*2/19;
    if(child instanceof InstancedMesh && child.userData.continuation==='ties'){
      const count=Math.ceil(halfWidth)*2;
      if(child.instanceMatrix.count!==count){
        const ties=new InstancedMesh(child.geometry,child.material,count);
        ties.userData.continuation='ties';
        const matrix=new Matrix4();
        for(let i=0;i<count;i++){matrix.makeTranslation(i-count/2+.5,.018,rail.z);ties.setMatrixAt(i,matrix);}
        ties.instanceMatrix.needsUpdate=true;root.remove(child);child.dispose();root.add(ties);
      }
    }
  }
}

/** Copies share the retained baked assets and have no colliders. Off-corridor
 * extrapolation cannot contact players: the nearest dwell nose is at −32.82m.
 * There is one exact authoritative consist through the accessible corridor. */
export function presentTrain(root:Group,train:Group,state:MotionRailway,direction:number,halfWidth:number): void {
  train.position.x=state.x;
  const base=visualTrainX(state,direction),period=rail.speed*rail.cycleSeconds;
  const [first,last]=imageRange(base,period,halfWidth,17);
  const dwell=state.elapsedSeconds-state.pass*rail.cycleSeconds<rail.safeSeconds;
  train.visible=!dwell;
  let copies=root.userData.trainCopies as Group[]|undefined;
  if(!copies){copies=[];root.userData.trainCopies=copies;}
  let used=0;
  for(let image=first;image<=last;image++){
    if(image===0&&!dwell)continue;
    let copy=copies[used++];
    if(!copy){copy=train.clone(true);copies.push(copy);root.add(copy);}
    copy.visible=true;copy.position.x=base+image*period;
  }
  for(let i=used;i<copies.length;i++)copies[i]!.visible=false;
}
