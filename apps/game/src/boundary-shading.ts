import { Mesh, Vector2 } from 'three';
import type { Material, Object3D } from 'three';
import type { CourseBox } from '@crossy/config';

/** Inner wall faces, not capsule-centre clearance or camera estimates. */
export function playableSides(boxes: readonly CourseBox[]): [number, number] | undefined {
  const left = boxes.find(b => b.kind === 'boundary' && /(?:left-wall|wall--1)$/.test(b.id));
  const right = boxes.find(b => b.kind === 'boundary' && /(?:right-wall|wall-1)$/.test(b.id));
  return left && right ? [left.center.x + left.halfSize.x, right.center.x - right.halfSize.x] : undefined;
}

/** One fragment tint; no extra draw, geometry, physics or per-frame traversal.
 * Child-added hooks cover asynchronous GLBs, instance batches and streaming.
 * Only scenery roots are watched; players, labels and screen UI are excluded. */
export class BoundaryShading {
  readonly bounds = { value: new Vector2(-1e20, 1e20) };
  readonly amount = { value: .25 };
  private readonly objects = new WeakSet<Object3D>();
  private readonly materials = new WeakSet<Material>();
  setBounds(sides: [number, number] | undefined): void {
    this.bounds.value.set(sides?.[0] ?? -1e20, sides?.[1] ?? 1e20);
  }
  watch(root: Object3D): void {
    if (this.objects.has(root)) return;
    this.objects.add(root);
    if (root instanceof Mesh) for (const material of Array.isArray(root.material) ? root.material : [root.material]) this.tint(material);
    for (const child of root.children) this.watch(child);
    root.addEventListener('childadded', event => this.watch(event.child));
  }
  private tint(material: Material): void {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      shader.uniforms.playableSides = this.bounds;
      shader.uniforms.boundaryShade = this.amount;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float boundaryWorldX;')
        .replace('#include <project_vertex>', `
          vec4 boundaryPosition = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            boundaryPosition = batchingMatrix * boundaryPosition;
          #endif
          #ifdef USE_INSTANCING
            boundaryPosition = instanceMatrix * boundaryPosition;
          #endif
          boundaryWorldX = (modelMatrix * boundaryPosition).x;
          #include <project_vertex>`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float boundaryWorldX;\nuniform vec2 playableSides;\nuniform float boundaryShade;')
        // After lighting/tone mapping/colour conversion: a visible 25% dimming,
        // including emissive signals, with a 12cm transition entirely OUTSIDE.
        .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
          float outsideDistance = max(playableSides.x-boundaryWorldX, boundaryWorldX-playableSides.y);
          gl_FragColor.rgb *= 1.0-boundaryShade*smoothstep(0.0, .12, outsideDistance);`);
    };
    material.customProgramCacheKey = () => `${key}|pre-m16-boundaries-v1`;
    material.needsUpdate = true;
  }
}
