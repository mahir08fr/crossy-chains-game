import { EnvironmentDecoration } from './environment-decoration';
import { playableSides } from './boundary-shading';
import { grassMaterial, flowingWater, updateWater, asphaltMaterial, shorelineMaterial } from './environment-materials';
import { RiverRockAssets } from './river-rock-view';
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Matrix4 } from 'three';
import { generatedCarsPerLane, generatedSettings, sectionCenter, vehicleColor, roadLanes, railwaySettings, sectionBoxes, riverSettings } from '@crossy/config';
import type { WorldSection } from '@crossy/config';
import type { BufferGeometry, Material } from 'three';
import type { MotionWorld } from '@crossy/protocol';
import { imageRange } from './visual-bounds';
import { extendRailway, presentTrain } from './railway-view';
import { TrafficView } from './traffic-view';
import { RailwayView } from './railway-view';

/** One asset load/batch per renderer; streamed clones share model geometry/materials.
 * Only signal materials vary by railway. Terrain uses one unit geometry/material pool. */
export class GeneratedWorldView {
  readonly group = new Group();
  private readonly decorations = new EnvironmentDecoration();
  private readonly rocks = new RiverRockAssets();
  private readonly traffic = new TrafficView(true);
  private readonly railway = new RailwayView();
  private readonly box = new BoxGeometry(1,1,1);
  private readonly materials = {
    ground:grassMaterial(),
    boundary:new MeshStandardMaterial({color:0x38645e,roughness:1}),
    railbed:new MeshStandardMaterial({color:0x777166,roughness:1}),
    road:asphaltMaterial(),
    water:new MeshStandardMaterial({color:0x247faf,transparent:true,opacity:.65,roughness:.85}),
    paint:new MeshStandardMaterial({color:0xf3e5ba}),
  };
  private readonly rearMark = new Mesh(this.box,this.materials.paint);
  private readonly sections = new Map<string,{root:Group; decoration?:Group; water?:MeshStandardMaterial; shore?:MeshStandardMaterial; paint?:InstancedMesh; cars?:Group[]; batches?:Map<string,InstancedMesh>; rail?:Group; train?:Group; signals:MeshStandardMaterial[]}>();
  private halfWidth = 24;
  setVisualHalfWidth(width:number): void {
    if(width<=this.halfWidth)return;
    this.halfWidth=width;
    for(const section of this.latest?.sections??[]){
      const view=this.sections.get(section.id);if(!view)continue;
      for(const mesh of view.root.children)if(mesh instanceof Mesh&&mesh.userData.horizontalSurface)mesh.scale.x=width*2;
      if(view.paint){view.root.remove(view.paint);view.paint.dispose();view.paint=this.roadPaint(section);view.root.add(view.paint);}
      if(view.decoration){view.decoration.traverse(o=>{if(o instanceof InstancedMesh)o.dispose();});view.root.remove(view.decoration);}
      view.decoration=this.decorations.create(section,width);view.root.add(view.decoration);
      if(view.rail)extendRailway(view.rail,width);
      // Only instance buffers depend on horizontal capacity. Preserve terrain,
      // car roots, train clones, lamps and all shared model geometry/materials.
      for(const batch of view.batches?.values()??[]){view.root.remove(batch);batch.dispose();}
      view.batches?.clear();
    }
    if(this.latest)this.update(this.latest);
  }
  private readonly matrix = new Matrix4();
  private parts: {geometry:BufferGeometry;material:Material;matrix:Matrix4}[][] = [];
  private roadPaint(s:WorldSection): InstancedMesh {
    const first=Math.ceil((-this.halfWidth-.6)/2.4),last=Math.ceil((this.halfWidth-.6)/2.4)-1;
    const paint=new InstancedMesh(this.box,this.materials.paint,(roadLanes(s).length-1)*(last-first+1));let mark=0;
    for(const lane of roadLanes(s).slice(1))for(let dash=first;dash<=last;dash++){
      this.matrix.makeScale(1.12,.012,.048).setPosition(.6+dash*2.4,.025,lane.z-generatedSettings.lanePitch/2);
      paint.setMatrixAt(mark++,this.matrix);
    }
    paint.count=mark;paint.receiveShadow=true;return paint;
  }
  private cacheCars(): void {
    this.traffic.group.updateMatrixWorld(true);
    this.parts=this.traffic.group.children.map(car=>{
      const inverse=car.matrixWorld.clone().invert(),parts:{geometry:BufferGeometry;material:Material;matrix:Matrix4}[]=[];
      car.traverse(o=>{if(o instanceof Mesh && !Array.isArray(o.material))parts.push({geometry:o.geometry,material:o.material,matrix:new Matrix4().multiplyMatrices(inverse,o.matrixWorld)});});
      return parts;
    });
  }
  private latest: MotionWorld | undefined;
  private disposed=false;
  private loading=false;
  private version=0;
  private loadedVersion=-1;
  private startLoads(): void {
    if(this.loading)return;this.loading=true;
    for(const load of [this.traffic.load(),this.railway.load(),this.rocks.load(),this.decorations.load()]) void load.then(()=>{if(!this.disposed)this.version++;}).catch(()=>{this.group.userData.asset='Generated hazard asset unavailable · collision-aligned fallback';});
  }
  private release(s: {root:Group;signals:MeshStandardMaterial[];water?:MeshStandardMaterial;shore?:MeshStandardMaterial}): void {
    s.signals.forEach(m=>m.dispose());s.water?.dispose();s.shore?.dispose();
    s.root.traverse(o=>{if(o instanceof InstancedMesh)o.dispose();});
    this.group.remove(s.root);s.root.clear();
  }
  private clear(): void {
    for(const s of this.sections.values())this.release(s);
    this.sections.clear();
  }
  update(world: MotionWorld): void {
    this.startLoads();this.latest=world;
    if(this.loadedVersion!==this.version){this.clear();this.cacheCars();this.loadedVersion=this.version;}
    const ids=new Set(world.sections.map(s=>s.id));
    for(const [id,s] of this.sections)if(!ids.has(id)){this.release(s);this.sections.delete(id);}
    for(const s of world.sections){
      let view=this.sections.get(s.id);
      if(!view){
        const root=new Group(),signals:MeshStandardMaterial[]=[];view={root,signals};this.sections.set(s.id,view);this.group.add(root);
        const add=(x:number,y:number,z:number,w:number,h:number,d:number,material:MeshStandardMaterial)=>{
          const mesh=new Mesh(this.box,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.receiveShadow=true;mesh.userData.horizontalSurface=true;root.add(mesh);return mesh;
        };
        if(s.type==='river')view.shore=shorelineMaterial(sectionCenter(s));
        const boxes = sectionBoxes(s);
        this.group.userData.playableSides = playableSides(boxes);
        for(const b of boxes.filter(b=>b.kind==='ground')) {const m=add(b.center.x,b.center.y,b.center.z,this.halfWidth*2,b.halfSize.y*2,b.halfSize.z*2,view.shore??this.materials.ground);m.rotation.x=b.rotationX??0;}
        view.decoration=this.decorations.create(s,this.halfWidth);root.add(view.decoration);
        const z=sectionCenter(s);
        if(s.type==='river'){
          view.water=flowingWater(s.river);
          add(0,riverSettings.surfaceY,z,this.halfWidth*2,.012,5,view.water);
          if(s.river)root.add(this.rocks.create(s.river));
        }
        if(s.type==='road'){
          add(0,.012,z,this.halfWidth*2,.016,roadLanes(s).length*generatedSettings.lanePitch,this.materials.road);
          for(const side of [-1,1])add(0,.025,z+side*roadLanes(s).length*generatedSettings.lanePitch/2,this.halfWidth*2,.012,.08,this.materials.paint);
          view.batches=new Map();
          view.cars=roadLanes(s).flatMap((lane,i)=>lane.positions.map((_,slot)=>{
            const car=new Group();car.scale.setScalar(generatedSettings.carScale);car.userData.color=vehicleColor(s,i,world.elapsedSeconds,slot);car.rotation.y=lane.direction*Math.PI/2;car.position.z=lane.z;root.add(car);return car;
          }));
          view.paint=this.roadPaint(s);root.add(view.paint);
        }
        if(s.type==='railway'){
          add(0,.006,z,this.halfWidth*2,.008,4.8,this.materials.railbed);
          view.rail=this.railway.group.clone(true);view.rail.userData.trainCopies=undefined;view.rail.visible=true;view.rail.position.z=z-railwaySettings.z;
          view.train=view.rail.children[0] as Group;view.train.rotation.y=s.direction*Math.PI/2;
          view.rail.traverse(o=>{if(o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.emissive.getHex()!==0){o.material=o.material.clone();signals.push(o.material);}});
          extendRailway(view.rail,this.halfWidth);root.add(view.rail);
        }
      }
      if(view.water)updateWater(view.water,world.elapsedSeconds);
      const h=world.hazards.find(h=>h.id===s.id);
      if(view.cars&&view.batches&&h?.road){
        const batches=view.batches;
        for(const batch of batches.values())batch.count=0;
        view.cars.forEach((car,i)=>{
          car.userData.color=vehicleColor(s,h.road!.vehicles[i]!.lane);
          car.position.set(h.road!.vehicles[i]!.x,0,roadLanes(s)[h.road!.vehicles[i]!.lane]!.z);car.updateMatrix();
          const lane=roadLanes(s)[h.road!.vehicles[i]!.lane]!;
          const [first,last]=imageRange(car.position.x,lane.period,this.halfWidth,4);
          for(let image=first;image<=last;image++){
            car.position.x=h.road!.vehicles[i]!.x+image*lane.period;car.updateMatrix();
            for(const part of this.parts[car.userData.color as number]!){
              const key=part.geometry.uuid+part.material.uuid;
              let batch=batches.get(key);
              if(!batch){
                const shortestPeriod=Math.min(...roadLanes(s).map(l=>l.period));
                const images=Math.ceil((2*this.halfWidth+8)/shortestPeriod)+1;
                batch=new InstancedMesh(part.geometry,part.material,roadLanes(s).length*generatedCarsPerLane*images);
                batch.count=0;batch.castShadow=true;batch.receiveShadow=true;batches.set(key,batch);view!.root.add(batch);
              }
              this.matrix.multiplyMatrices(car.matrix,part.matrix);batch.setMatrixAt(batch.count++,this.matrix);
            }
          }
          car.position.x=h.road!.vehicles[i]!.x;car.updateMatrix();
        });
        for(const batch of batches.values()){
          batch.visible=batch.count>0;batch.instanceMatrix.needsUpdate=true;
          if(batch.visible)batch.computeBoundingSphere();
        }
      }
      if(view.train&&h?.railway){
        presentTrain(view.rail!,view.train,h.railway,s.direction,this.halfWidth);
        const color=h.railway.signal==='safe'?0x64d98b:h.railway.signal==='warning'?0xffba42:0xf04747;
        view.signals.forEach(m=>{m.color.setHex(color);m.emissive.setHex(color);m.emissiveIntensity=.4;});
      }
    }
    const first=this.sections.values().next().value;
    if(first && this.rearMark.parent!==first.root)first.root.add(this.rearMark);
    this.rearMark.position.set(0,.035,world.rearLimit);
    this.rearMark.scale.set(19.4,.012,.04);
    this.group.userData.sections=this.sections.size;
  }
  refresh(): void {if(this.latest && this.loadedVersion!==this.version)this.update(this.latest);}
  reset(): void {this.latest=undefined;this.clear();}
  dispose(): void {this.disposed=true;this.reset();this.traffic.dispose();this.railway.dispose();this.rocks.dispose();this.decorations.dispose();this.box.dispose();Object.values(this.materials).forEach(m=>m.dispose());}
}
