import { BoxGeometry, Group, InstancedMesh, Matrix4, Vector3, Mesh, MeshStandardMaterial } from 'three';
import type { RiverLayout } from '@crossy/config';
import { riverRockSizes, riverSettings } from '@crossy/config';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import smallUrl from '../../../assets/rocks/output/rocks_001/rock_small.glb?url';
import mediumUrl from '../../../assets/rocks/output/rocks_001/rock_medium.glb?url';

// One load per renderer, shared immutable meshes/materials across streamed sections.
export class RiverRockAssets {
  private readonly templates = new Map<'small'|'medium',Group>();
  private readonly fallback = new BoxGeometry(1,1,1);
  private readonly material = new MeshStandardMaterial({color:0x7d8589,roughness:.9});
  private disposed=false;
  async load(): Promise<void> {
    const results=await Promise.allSettled([smallUrl,mediumUrl].map(url=>new GLTFLoader().loadAsync(url)));
    for(const [i,result] of results.entries())if(result.status==='fulfilled'){
      const root=result.value.scene;
      if(this.disposed)this.release(root);else this.templates.set(i===0?'small':'medium',root);
    }
    if(results.some(r=>r.status==='rejected'))throw new Error('Rock GLB unavailable; temporary geometry retained');
  }
  create(layout: RiverLayout): Group {
    const root=new Group();root.name='river-rocks';
    for(const size of ['small','medium'] as const){
      const rocks=layout.rocks.filter(r=>r.size===size);if(!rocks.length)continue;
      const template=this.templates.get(size),dim=riverRockSizes[size];
      const add=(source:Mesh)=>{
        const mesh=new InstancedMesh(source.geometry,source.material,rocks.length),m=new Matrix4();
        for(const [i,r] of rocks.entries()){
          m.makeTranslation(r.x,riverSettings.surfaceY-.05,r.z);
          if(template)m.multiply(source.matrixWorld);else m.scale(new Vector3(dim.halfX*2,dim.height,dim.halfZ*2)).setPosition(r.x,riverSettings.surfaceY-.05+dim.height/2,r.z);
          mesh.setMatrixAt(i,m);
        }
        mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.rockSize=size;root.add(mesh);
      };
      if(template){template.updateMatrixWorld(true);template.traverse(o=>{if(o instanceof Mesh)add(o);});}
      else add(new Mesh(this.fallback,this.material));
    }
    root.userData.recipe=layout;return root;
  }
  private release(root:Group):void {
    const g=new Set<import('three').BufferGeometry>(),m=new Set<import('three').Material>();
    root.traverse(o=>{if(o instanceof Mesh){g.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material])m.add(material);}});
    g.forEach(x=>x.dispose());m.forEach(x=>x.dispose());
  }
  dispose():void {this.disposed=true;for(const root of this.templates.values())this.release(root);this.templates.clear();this.fallback.dispose();this.material.dispose();}
}
