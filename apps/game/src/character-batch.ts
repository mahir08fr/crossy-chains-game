import { Bone, BufferAttribute, Group, Matrix4, Mesh, Skeleton, SkinnedMesh } from 'three';
import type { BufferGeometry, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One GPU transform per original rigid node, one draw per exact material.
 * Original animation targets and original skinned limbs remain untouched. These
 * render-only batch bones copy authored transforms; they contain no new clips. */
export class CharacterBatch {
  readonly group = new Group();
  private readonly pieces: {source:Mesh;bone:Bone}[] = [];
  private readonly inverse = new Matrix4();
  private readonly matrix = new Matrix4();
  constructor(private readonly root: Group) {
    const materials = new Map<Material,{geometry:BufferGeometry;source:Mesh}[]>();
    root.updateMatrixWorld(true);this.inverse.copy(root.matrixWorld).invert();
    root.traverse(o=>{
      if (!(o instanceof Mesh) || o instanceof SkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences || !o.geometry.getAttribute('normal')) return;
      this.matrix.multiplyMatrices(this.inverse,o.matrixWorld);
      const geometry=o.geometry.clone().applyMatrix4(this.matrix),count=geometry.getAttribute('position').count,index=this.pieces.length;
      const indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
      for(let i=0;i<count;i++){indices[i*4]=index;weights[i*4]=1;}
      geometry.setAttribute('skinIndex',new BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new BufferAttribute(weights,4));
      const bone=new Bone();bone.name=`batch-transform-${index}`;bone.matrixAutoUpdate=false;bone.matrix.copy(this.matrix);
      this.group.add(bone);this.pieces.push({source:o,bone});
      const list=materials.get(o.material)??[];list.push({geometry,source:o});materials.set(o.material,list);
    });
    root.add(this.group);root.updateMatrixWorld(true);
    const skeleton=new Skeleton(this.pieces.map(p=>p.bone));let used=false;
    for(const [material,parts] of materials){
      const geometry=mergeGeometries(parts.map(p=>p.geometry),false);parts.forEach(p=>p.geometry.dispose());
      if(!geometry)continue; // Unsupported layouts retain authored meshes.
      const mesh=new SkinnedMesh(geometry,material);mesh.name='character-material-batch';mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
      this.group.add(mesh);mesh.bind(skeleton,root.matrixWorld);parts.forEach(p=>{p.source.visible=false;});used=true;
    }
    if(!used)skeleton.dispose();
  }
  update(): void {
    this.root.updateMatrixWorld(true);this.inverse.copy(this.root.matrixWorld).invert();
    for(const {source,bone} of this.pieces)bone.matrix.multiplyMatrices(this.inverse,source.matrixWorld);
    this.group.updateMatrixWorld(true);
  }
}
