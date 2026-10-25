import { AmbientLight, Box3, DirectionalLight, Group, Mesh, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { characterAssets } from './character-assets';
import { CharacterBatch } from './character-batch';
import { disposeGooseAsset } from './goose-view';
import { playerSlots } from '@crossy/protocol';
import type { PlayerSlot } from '@crossy/protocol';
import { cinematicPose } from './gui-state';

/** One transparent canvas, four scissored scenes. The application supplies the only RAF. */
export class MenuPreviews {
  private renderer: WebGLRenderer | undefined;
  private readonly scenes = new Map<PlayerSlot, { scene: Scene; pivot: Group; batch: CharacterBatch; camera: OrthographicCamera }>();
  private disposed = false;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  readonly ready: Promise<void>;
  renderedFrames = 0;
  lastCpuMs = 0;
  private lastDrawAt = -Infinity;
  private calls = 0;
  private loadMs = 0;
  private readonly samples: number[] = [];
  metrics() { const sorted=[...this.samples].sort((a,b)=>a-b); return {loadMs:this.loadMs,loadedModels:this.scenes.size,renderedFrames:this.renderedFrames,calls:this.calls,geometries:this.renderer?.info.memory.geometries??0,textures:this.renderer?.info.memory.textures??0,cpuP95Ms:sorted[Math.floor(sorted.length*.95)]??0,samples:sorted.length}; }
  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      this.renderer.setScissorTest(true);
    } catch { canvas.hidden = true; for(const anchor of document.querySelectorAll<HTMLElement>('[data-preview]')) anchor.textContent = '3D preview needs WebGL2'; }
    this.ready = this.load();
  }
  private async load(): Promise<void> {
    if (!this.renderer) return;
    const started = performance.now();
    const loader = new GLTFLoader();
    await Promise.allSettled(playerSlots.map(async slot => {
      const anchor = document.querySelector<HTMLElement>(`[data-preview="${slot}"]`);
      try {
        const asset = await loader.loadAsync(characterAssets[slot].landUrl);
        if (this.disposed) { disposeGooseAsset(asset.scene); return; }
        asset.scene.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(asset.scene, true), centre = bounds.getCenter(new Vector3());
        // Uniform per-species fit retains original proportions, including horn/tail.
        const size = bounds.getSize(new Vector3()), scale = 2.4 / Math.max(size.x, size.y, size.z);
        asset.scene.position.copy(centre).multiplyScalar(-scale); asset.scene.scale.setScalar(scale);
        const pivot = new Group(); pivot.add(asset.scene);
        const batch = new CharacterBatch(asset.scene);
        const scene = new Scene(); scene.add(pivot, new AmbientLight(0xfff8ec, 2.5));
        const light = new DirectionalLight(0xffefd5, 3); light.position.set(-3, 5, 4); scene.add(light);
        const camera = new OrthographicCamera(-2, 2, 2, -2, .1, 80); camera.position.set(3, 2, 5); camera.lookAt(0, 0, 0);
        // Preview rigs are static; only their containing pivot moves. Bake once.
        batch.update();
        this.scenes.set(slot, { scene, pivot, batch, camera });
        if (anchor) { anchor.dataset.loaded = 'true'; anchor.textContent = ''; }
      } catch { if (anchor) anchor.textContent = `${characterAssets[slot].species} preview unavailable`; }
    }));
    this.loadMs = performance.now() - started;
  }
  draw(now: number, targets: { slot: PlayerSlot; element: HTMLElement; cinematicSeconds?: number }[]): void {
    const renderer = this.renderer;
    if (!renderer || this.disposed || document.hidden || !targets.length || performance.now()-this.lastDrawAt<1000/30) return;
    this.lastDrawAt = performance.now(); this.calls = 0;
    const started = performance.now(), width = innerWidth, height = innerHeight;
    if (this.canvas.clientWidth !== width || renderer.domElement.width !== Math.floor(width * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(height * renderer.getPixelRatio())) renderer.setSize(width, height, false);
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    for (const target of targets) {
      const view = this.scenes.get(target.slot), rect = target.element.getBoundingClientRect();
      if (!view || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > height) continue;
      const cinematic = target.cinematicSeconds === undefined ? undefined : cinematicPose(target.cinematicSeconds, this.reduced.matches);
      view.pivot.rotation.set(cinematic?.flip ?? 0, cinematic ? .4 : this.reduced.matches ? .4 : now / 1000 * Math.PI / 5, 0);
      view.pivot.position.y = cinematic?.y ?? (this.reduced.matches ? 0 : Math.sin(now / 1000 * 1.6) * .09);
      const aspect = rect.width / rect.height, halfHeight = target.cinematicSeconds === undefined ? 1.9 : 4.5;
      Object.assign(view.camera, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight }); view.camera.updateProjectionMatrix();
      renderer.setViewport(rect.left, height - rect.bottom, rect.width, rect.height);
      renderer.setScissor(Math.max(0, rect.left), Math.max(0, height - rect.bottom), Math.min(rect.width,width-rect.left), Math.min(rect.height,rect.bottom));
      renderer.render(view.scene, view.camera); this.calls += renderer.info.render.calls;
    }
    this.renderedFrames++; this.lastCpuMs = performance.now() - started; this.samples.push(this.lastCpuMs); if(this.samples.length>120)this.samples.shift();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const { scene } of this.scenes.values()) { scene.traverse(o => { if (o instanceof Mesh) o.castShadow = false; }); for (const child of [...scene.children]) if (child instanceof Group) disposeGooseAsset(child); }
    this.scenes.clear(); this.renderer?.dispose(); this.canvas.remove();
  }
}
