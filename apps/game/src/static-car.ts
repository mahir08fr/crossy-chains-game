import { Group, Mesh, SkinnedMesh } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bake the unanimated car's nodes once; retain one draw per solid material.
 * Materials remain shared; output geometry is owned independently of the source.
 */
export function batchStaticCar(source: Object3D): Group {
  source.updateMatrixWorld(true);
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const result = new Group();
  try {
    source.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (Array.isArray(object.material) || object instanceof SkinnedMesh) throw new Error('Static car requires single-material rigid meshes');
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const group = byMaterial.get(object.material) ?? [];
      group.push(geometry); byMaterial.set(object.material, group);
    });
    for (const [material, geometries] of byMaterial) {
      const merged = mergeGeometries(geometries, false);
      if (!merged) throw new Error('Incompatible static car vertex attributes');
      result.add(new Mesh(merged, material));
    }
    return result;
  } catch (error) {
    result.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    throw error;
  } finally {
    for (const geometries of byMaterial.values()) for (const geometry of geometries) geometry.dispose();
  }
}
