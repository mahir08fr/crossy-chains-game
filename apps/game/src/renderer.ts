import { VisualEffects, VisualEventTracker } from './visual-effects';
import { BoundaryShading, playableSides } from './boundary-shading';
import { VisualBounds } from './visual-bounds';
import { extendWorldView } from './world-view';
import { GeneratedWorldView } from './generated-world-view';
import { RailwayView } from './railway-view';
import { TrafficView } from './traffic-view';
import { HemisphereLight, Color, DirectionalLight, Group, LineSegments, Mesh, PCFShadowMap, Scene, WebGLRenderer } from 'three';
import { localPlayers, scenarios, settings } from '@crossy/config';
import type { Scenario } from '@crossy/config';
import { FollowCamera } from './camera';
import { ChainView } from './chain-view';
import { PlayerView } from './player-view';
import { createWorldView } from './world-view';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { characterAssets } from './character-assets';
import { PlayerLabels } from './player-labels';
import { playerSlots, defaultDisplayName } from '@crossy/protocol';
import type { LobbyMessage } from '@crossy/protocol';
import { disposeGooseAsset } from './goose-view';

export class GameRenderer {
  readonly scene = new Scene();
  readonly effects = new VisualEffects();
  private readonly visualEvents = new VisualEventTracker();
  private effectsAt: number | undefined;
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  observeSnapshot(snapshot: import('@crossy/protocol').SnapshotMessage): void {
    // Waiting-room snapshots can replace the static menu scene while the menu
    // stays visible. Keep that background unshaded as well as the initial menu.
    this.boundaryShading.amount.value = snapshot.phase === 'waiting' ? 0 : .25;
    if (snapshot.phase === 'waiting' || snapshot.phase === 'fault') this.clearEffects();
    const reduced = this.reducedMotion?.matches ?? false;
    for (const event of this.visualEvents.observe(snapshot)) this.effects.emit(event, reduced);
  }
  clearEffects(): void { this.effects.clear(); this.visualEvents.reset(); this.effectsAt = undefined; }
  readonly renderer = new WebGLRenderer({ antialias: true });
  readonly camera = new FollowCamera();
  readonly chain = new ChainView();
  readonly generated = new GeneratedWorldView();
  private readonly sunlight = new DirectionalLight(0xfff0d5, 3);
  readonly traffic = new TrafficView();
  readonly railway = new RailwayView();
  readonly players = new Map(localPlayers.map(({ id, color }) => [id, new PlayerView(color)]));
  private worldView = createWorldView(scenarios[0]!);
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private characterLoading: Promise<void> | undefined;
  readonly labels: PlayerLabels;
  private assetError: HTMLElement | undefined;
  readonly characterStatus: Record<string, string> = {};
  setNames(data: LobbyMessage): void { this.labels.setPresent(data.players.map(p=>p.slot)); for (const slot of playerSlots) if (data.players.some(p=>p.slot===slot)) this.labels.setName(slot, data.players.find(p => p.slot === slot)?.displayName ?? defaultDisplayName(slot)); }
  private readonly visualBounds = new VisualBounds();
  readonly boundaryShading = new BoundaryShading();

  constructor(private readonly viewport: HTMLElement) {
    for (const root of [this.generated.group, this.railway.group, this.traffic.group, this.worldView]) this.boundaryShading.watch(root);
    this.labels = new PlayerLabels(viewport);
    this.scene.background = new Color(0x122d35);
    this.scene.add(this.effects.group, this.generated.group, this.railway.group, this.traffic.group, this.worldView, this.chain.group, ...Array.from(this.players.values(), (player) => player.group), new HemisphereLight(0xe3eeeb, 0xa5ad92, 2));
    const light = this.sunlight;
    light.position.set(-8, 18, -8);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -16, right: 16, top: 30, bottom: -16, far: 70 });
    light.shadow.normalBias = 0.04;
    light.target.position.set(0, 0, 8);
    this.scene.add(light, light.target);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Crossy Chains 3D playground');
    viewport.append(this.renderer.domElement);
    const resize = () => {
      const { width, height } = viewport.getBoundingClientRect();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.rendering.maxPixelRatio));
      this.renderer.setSize(width, height, false);
      this.camera.resize(width, height);
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(viewport);
    resize();
  }

  setScenario(scenario: Scenario): void {
    this.boundaryShading.amount.value = .25;
    this.clearEffects();
    for (const definition of scenario.players) {
      if (this.players.has(definition.id)) continue;
      const view = new PlayerView(definition.color);
      this.players.set(definition.id, view);
      this.scene.add(view.group);
    }
    for (const [id, view] of this.players) view.group.visible = scenario.players.some(player => player.id === id);
    this.generated.reset(); this.generated.group.visible = scenario.id === 'generated';
    this.traffic.group.visible = scenario.id === 'road';
    this.railway.group.visible = scenario.id === 'railway';
    if (scenario.id === 'railway') void this.railway.load().catch(() => { this.railway.group.userData.asset = 'Train asset unavailable · box fallback'; });
    this.scene.remove(this.worldView);
    this.disposeObjects(this.worldView);
    this.worldView = createWorldView(scenario);
    this.boundaryShading.watch(this.worldView);
    // Generated sections provide the exact authoritative collider descriptors.
    this.boundaryShading.setBounds(playableSides(scenario.boxes));
    this.scene.add(this.worldView);
  }

  loadGoose(): Promise<void> {
    return this.characterLoading ??= this.loadCharacters();
  }

  private async loadCharacters(): Promise<void> {
    const loader = new GLTFLoader();
    const results = await Promise.allSettled(playerSlots.map(async slot => {
      const definition = characterAssets[slot];
      const loaded = await Promise.allSettled([loader.loadAsync(definition.landUrl), loader.loadAsync(definition.waterUrl)]);
      if (loaded.some(r => r.status === "rejected")) {
        for (const r of loaded) if (r.status === "fulfilled") disposeGooseAsset(r.value.scene);
        this.characterStatus[slot] = `${definition.species} unavailable: required GLB failed`;
        throw new Error(this.characterStatus[slot]);
      }
      const [land, water] = loaded.map(r => (r as PromiseFulfilledResult<import("three/addons/loaders/GLTFLoader.js").GLTF>).value);
      if (this.disposed) { disposeGooseAsset(land!.scene); disposeGooseAsset(water!.scene); return; }
      const view = this.players.get(slot) ?? new PlayerView(0xffffff);
      if (!this.players.has(slot)) { view.group.visible = false; this.players.set(slot, view); this.scene.add(view.group); }
      try { view.useCharacter(land!, water!, definition); this.characterStatus[slot] = definition.species + " loaded"; }
      catch (error) { disposeGooseAsset(land!.scene); disposeGooseAsset(water!.scene); this.characterStatus[slot] = String(error); throw error; }
    }));
    if (this.disposed) return;
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length) {
      const message = Object.values(this.characterStatus).join(' · ');
      this.assetError = document.createElement('small'); this.assetError.setAttribute('role','status');
      this.assetError.style.cssText = 'position:absolute;bottom:4px;left:4px;z-index:6;background:#102128;color:white;padding:4px';
      this.assetError.textContent = `${message}. Unavailable characters retain placeholders; reload to retry.`;
      this.viewport.append(this.assetError); throw new Error(message);
    }
  }

  private disposeObjects(root: Scene | Group): void {
    const geometries = new Set<Mesh['geometry']>();
    const materials = new Set<import('three').Material>();
    root.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  draw(): void {
    const now = performance.now();
    if (this.reducedMotion?.matches) this.effects.clear();
    this.effects.update(this.effectsAt === undefined ? 0 : (now-this.effectsAt)/1000); this.effectsAt = now;
    this.visualBounds.update(this.camera.camera);
    this.generated.setVisualHalfWidth(this.visualBounds.halfWidth);
    this.railway.setVisualHalfWidth(this.visualBounds.halfWidth);
    this.traffic.setVisualHalfWidth(this.visualBounds.halfWidth);
    extendWorldView(this.worldView,this.visualBounds.halfWidth);
    if(this.generated.group.visible){
      this.generated.refresh();
      if (this.generated.group.userData.playableSides) this.boundaryShading.setBounds(this.generated.group.userData.playableSides);
      const p=this.camera.camera.position, z=p.z+settings.camera.behind;
      this.sunlight.position.set(p.x-8,18,z-8);this.sunlight.target.position.set(p.x,0,z+3);
    }
    this.labels.update(this.players, this.camera.camera);
    this.renderer.render(this.scene, this.camera.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.effects.dispose();
    this.labels.dispose(); this.assetError?.remove();
    this.resizeObserver.disconnect();
    this.scene.remove(this.generated.group); this.generated.dispose();
    this.scene.remove(this.railway.group);
    this.railway.dispose();
    this.scene.remove(this.traffic.group);
    this.traffic.dispose();
    this.scene.remove(this.chain.group);
    this.chain.dispose();
    for (const player of this.players.values()) player.dispose();
    this.disposeObjects(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
