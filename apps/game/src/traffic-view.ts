import { imageRange } from './visual-bounds';
import { batchStaticCar } from './static-car';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { Object3D } from 'three';
import type { MotionRoad } from '@crossy/protocol';
import { generatedSettings, roadSettings } from '@crossy/config';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import carUrl from '../../../assets/car/output/car_001/car.glb?url';

export function disposeTraffic(root: Object3D): void {
  const geometries = new Set<import('three').BufferGeometry>(), materials = new Set<import('three').Material>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}

/** Visuals only. Static model, cloned shared geometry, body-only colour variants. */
export class TrafficView {
  readonly group = new Group();
  private readonly cars: Group[] = [];
  private disposed = false;
  private loading: Promise<void> | undefined;
  constructor(private readonly paletteOnly = false) {
    for (let id = 0; id < (paletteOnly ? generatedSettings.colors.length : 6); id++) {
      const car = new Group();
      const mesh = new Mesh(new BoxGeometry(1.72, 1.5, 3.54), new MeshStandardMaterial({ color: generatedSettings.colors[this.paletteOnly?id:Math.floor(id/2)]! }));
      mesh.position.y = 0.75; car.add(mesh);
      car.rotation.y = roadSettings.lanes[paletteOnly?0:Math.floor(id / 2)]!.direction * Math.PI / 2;
      this.cars.push(car); this.group.add(car);
    }
    this.group.visible = false;
  }
  load(): Promise<void> { return this.loading ??= this.loadModel(); }
  private async loadModel(): Promise<void> {
    const asset = await new GLTFLoader().loadAsync(carUrl);
    if (this.disposed) { disposeTraffic(asset.scene); return; }
    let template: Group;
    try { template = batchStaticCar(asset.scene); }
    catch (error) { disposeTraffic(asset.scene); throw error; }
    const sourceGeometries = new Set<import('three').BufferGeometry>();
    asset.scene.traverse(object => { if (object instanceof Mesh) sourceGeometries.add(object.geometry); });
    sourceGeometries.forEach(geometry => geometry.dispose());
    const colours = generatedSettings.colors;
    this.cars.forEach((car, id) => {
      car.children.forEach(child => disposeTraffic(child)); car.clear();
      const model = template.clone(true);
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true; object.receiveShadow = true;
        const recolour = (material: import('three').Material) => {
          if (!material.name.startsWith('Car_Mat_Mustard')) return material;
          const copy = material.clone() as MeshStandardMaterial;
          copy.color.setHex(colours[this.paletteOnly?id:Math.floor(id/2)]!); return copy;
        };
        object.material = Array.isArray(object.material) ? object.material.map(recolour) : recolour(object.material);
      });
      car.add(model);
    });
    // Source body materials have been replaced in every clone.
    const originals = new Set<import('three').Material>();
    asset.scene.traverse(object => { if (object instanceof Mesh) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (mat.name.startsWith('Car_Mat_Mustard')) originals.add(mat);
    } });
    originals.forEach(material => material.dispose());
    for(const copies of this.copies)for(const copy of copies)this.group.remove(copy);
    this.copies.length=0;
    this.group.userData.asset = 'car.glb loaded';
  }
  private halfWidth=24;
  private readonly copies: Group[][]=[];
  private latest:MotionRoad|undefined;
  setVisualHalfWidth(width:number): void {
    if(this.halfWidth===width)return;
    this.halfWidth=width;if(this.latest)this.update(this.latest);
  }
  update(road: MotionRoad): void {
    this.latest=road;road.vehicles.forEach(vehicle => {
      const car=this.cars[vehicle.id]!;car.position.set(vehicle.x,0,roadSettings.lanes[vehicle.lane]!.z);
      if(this.paletteOnly)return;
      const copies=this.copies[vehicle.id]??(this.copies[vehicle.id]=[]);
      const [first,last]=imageRange(vehicle.x,roadSettings.halfLength*2,this.halfWidth,4);
      let used=0;
      for(let image=first;image<=last;image++){
        if(image===0)continue;
        let copy=copies[used++];
        if(!copy){copy=car.clone(true);copies.push(copy);this.group.add(copy);}
        copy.visible=true;copy.position.x=vehicle.x+image*roadSettings.halfLength*2;
      }
      for(let i=used;i<copies.length;i++)copies[i]!.visible=false;
    });
  }
  dispose(): void { this.disposed = true; disposeTraffic(this.group); this.group.clear(); }
}
