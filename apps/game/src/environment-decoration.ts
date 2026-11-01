import { BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { Material } from 'three';
import { roadLanes, sectionCenter, sectionBoxes, generatedSettings } from '@crossy/config';
import type { WorldSection } from '@crossy/config';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import smallUrl from '../../../assets/trees/output/trees_005/tree_small.glb?url';
import mediumUrl from '../../../assets/trees/output/trees_005/tree_medium.glb?url';
import tallUrl from '../../../assets/trees/output/trees_005/tree_tall.glb?url';

export const treeVariants = ['small','medium','tall'] as const;
export type TreeVariant = typeof treeVariants[number];
export const treeCanopy = {small:1.426,medium:1.85,tall:2.28} as const;
export type TreePlacement = {variant:TreeVariant;x:number;z:number;rotation:number;scale:number};
// Separate cosmetic RNG; never consumes or modifies the authoritative generator.
export function decorationRandom(id:string, stream:number):number {
  let h=2166136261;
  for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);
  h^=Math.imul(stream+1,0x9e3779b9);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);
  return ((h^(h>>>16))>>>0)/4294967296;
}
/** Flat existing grass only, including real grass approaches between hazards.
 * Slopes, water bed, asphalt and rail ballast are excluded at every X. */
export function grassIntervals(s:WorldSection):[number,number][] {
  let excluded:[number,number]|undefined;
  const z=sectionCenter(s);
  if(s.type==='road'){const depth=roadLanes(s).length*generatedSettings.lanePitch/2;excluded=[z-depth-.25,z+depth+.25];}
  if(s.type==='railway')excluded=[z-2.65,z+2.65];
  const result:[number,number][]=[];
  for(const b of sectionBoxes(s)){
    if(b.kind!=='ground'||b.rotationX||Math.abs(b.center.y+b.halfSize.y)>.01)continue;
    const lo=Math.max(s.start,b.center.z-b.halfSize.z), hi=Math.min(s.start+s.length,b.center.z+b.halfSize.z);
    if(excluded){if(lo<excluded[0])result.push([lo,Math.min(hi,excluded[0])]);if(hi>excluded[1])result.push([Math.max(lo,excluded[1]),hi]);}
    else result.push([lo,hi]);
  }
  return result.filter(([a,b])=>b>a);
}
export function treePlacements(s:WorldSection,halfWidth:number):TreePlacement[] {
  const trees:TreePlacement[]=[], intervals=grassIntervals(s);
  // World-anchored 4.8 m strata: resizing retains identical existing transforms.
  // Random thinning and Z jitter prevent a regular fence along physical bounds.
  for(let cell=Math.floor(-halfWidth/4.8);cell<=Math.ceil(halfWidth/4.8);cell++){
    for(let slot=0;slot<2;slot++){
      const r=(n:number)=>decorationRandom(s.id,cell*37+slot*13+n+10000);
      if(r(0)>.64)continue;
      const pick=r(1),variant:TreeVariant=pick<.56?'small':pick<.86?'medium':'tall';
      const scale=.94+r(2)*.12, radius=treeCanopy[variant]*scale/2+.22;
      const x=cell*4.8+.5+r(3)*1.6;
      // Includes canopy and shadow/readability clearance for all player/cable X.
      if(Math.abs(x)<12.1+radius)continue;
      const usable=intervals.filter(([a,b])=>b-a>radius*2+.2);
      if(!usable.length)continue;
      const [a,b]=usable[Math.floor(r(4)*usable.length)]!;
      const z=a+radius+.1+r(5)*(b-a-radius*2-.2);
      if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<(treeCanopy[t.variant]*t.scale/2+radius+.35)))continue;
      trees.push({variant,x,z,rotation:r(6)*Math.PI*2,scale});
    }
  }
  return trees.filter(t=>Math.abs(t.x)+treeCanopy[t.variant]*t.scale/2+.22<=halfWidth).sort((a,b)=>Math.abs(a.x)-Math.abs(b.x)).slice(0,80);
}

/** Retains unmodified GLTF primitives, original material assignments and node
 * matrices. Each primitive/variant is one instance batch per streamed section. */
export class EnvironmentDecoration {
  private templates = new Map<TreeVariant,Group>();
  private pending:Promise<void>|undefined;
  private disposed=false;
  private readonly tuft = new BufferGeometry();
  private readonly tuftMaterial = new MeshStandardMaterial({color:0x668b48,roughness:1,side:2});
  constructor(){
    this.tuft.setAttribute('position',new Float32BufferAttribute([-.12,0,0,0,.17,0,.1,0,0, 0,0,-.1,0,.12,0,0,0,.11],3));
    this.tuft.computeVertexNormals();
  }
  load():Promise<void>{return this.pending??=this.loadAssets();}
  private async loadAssets():Promise<void>{
    const results=await Promise.allSettled([smallUrl,mediumUrl,tallUrl].map(url=>new GLTFLoader().loadAsync(url)));
    for(const [i,r] of results.entries())if(r.status==='fulfilled'){
      if(this.disposed)this.release(r.value.scene);else this.templates.set(treeVariants[i]!,r.value.scene);
    }
    if(results.some(r=>r.status==='rejected'))throw new Error('Custom tree GLB unavailable; no replacement trees generated');
  }
  create(s:WorldSection,halfWidth:number):Group {
    const root=new Group();root.name='environment-decoration';
    const placements=treePlacements(s,halfWidth);root.userData.trees=placements;
    const m=new Matrix4(),q=new Quaternion(),p=new Vector3(),scale=new Vector3();
    for(const variant of treeVariants){
      const positions=placements.filter(t=>t.variant===variant),template=this.templates.get(variant);
      if(!positions.length||!template)continue;
      template.updateMatrixWorld(true);
      template.traverse(o=>{if(o instanceof Mesh){
        const batch=new InstancedMesh(o.geometry,o.material,positions.length);
        positions.forEach((t,i)=>{q.setFromAxisAngle(p.set(0,1,0),t.rotation);m.compose(p.set(t.x,0,t.z),q,scale.setScalar(t.scale));m.multiply(o.matrixWorld);batch.setMatrixAt(i,m);});
        batch.castShadow=true;batch.receiveShadow=true;batch.userData.treeVariant=variant;root.add(batch);
      }});
    }
    const intervals=grassIntervals(s),points:{x:number;z:number}[]=[];
    tuftCells: for(let cell=Math.floor(-halfWidth/2);cell<Math.ceil(halfWidth/2);cell++)for(let slot=0;slot<2;slot++){
      const r=(n:number)=>decorationRandom(s.id,cell*31+slot*7+n+30000);
      if(r(0)>.55||!intervals.length)continue;
      const [a,b]=intervals[Math.floor(r(1)*intervals.length)]!;
      if(b-a<.4)continue;
      const x=cell*2+r(2)*1.7,z=a+.16+r(3)*(b-a-.32);
      if(Math.abs(x)>halfWidth-.2||(s.index===0&&Math.abs(x)<8&&Math.abs(z)<4))continue;
      points.push({x,z});if(points.length===160)break tuftCells;
    }
    if(points.length){
      const tufts=new InstancedMesh(this.tuft,this.tuftMaterial,Math.min(160,points.length));tufts.name='grass-tufts';
      points.slice(0,160).forEach((t,i)=>{q.setFromAxisAngle(p.set(0,1,0),decorationRandom(s.id,i)*6.283);m.compose(p.set(t.x,.012,t.z),q,scale.setScalar(.7+decorationRandom(s.id,i+500)*.6));tufts.setMatrixAt(i,m);});root.add(tufts);
    }
    return root;
  }
  private release(root:Group):void {
    const geometries=new Set<BufferGeometry>(),materials=new Set<Material>();
    root.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
  dispose():void {this.disposed=true;for(const root of this.templates.values())this.release(root);this.templates.clear();this.tuft.dispose();this.tuftMaterial.dispose();}
}
