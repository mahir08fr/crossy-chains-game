import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { Box3, Mesh, PropertyBinding } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { characterAssets } from './character-assets';
import { CharacterView } from './character-view';
import { PlayerView } from './player-view';
import { playerSlots } from '@crossy/protocol';
import { playerMovementScale, riverSettings, settings } from '@crossy/config';

export async function characterLoad(url: string) {
  const file = url.split('?')[0]!, path = file.startsWith('/@fs/') ? file.slice(4) : file.startsWith('/assets/') ? `.${file}` : file;
  const bytes = readFileSync(path);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
const inventory: unknown[] = [];
it.each(playerSlots)('loads original %s land/swim GLBs, exact slot/root/clips, materials, stationary roots and authored +Z orientation', async slot => {
  const d = characterAssets[slot], land = await characterLoad(d.landUrl), water = await characterLoad(d.waterUrl);
  expect(land.animations.map(c=>c.name)).toEqual([d.walk]);
  expect(water.animations.map(c=>c.name)).toEqual([d.swim,d.tread]);
  for (const asset of [land,water]) for (const clip of asset.animations) for (const track of clip.tracks) {
    const target = PropertyBinding.parseTrackName(track.name);
    expect(PropertyBinding.findNode(asset.scene,target.nodeName), `${clip.name}: ${track.name}`).toBeDefined();
    expect([...track.values].every(Number.isFinite)).toBe(true);
  }
  const view = new CharacterView(land,water,d);
  try {
    const b = new Box3().setFromObject(land.scene,true), root = land.scene.getObjectByName(d.root)!;
    expect(b.min.y).toBeCloseTo(-.77,4); expect(land.scene.scale.x).toBe(d.scale);
    expect(view.triangles).toBe([1065,3960,2768,2656][playerSlots.indexOf(slot)]);
    expect(root.position.length()).toBe(0); expect(root.quaternion.w).toBe(1);
    let primitives=0; const materials=new Set(); land.scene.traverse(o=>{if(o instanceof Mesh && o.name !== "character-material-batch"){primitives++;materials.add(o.material);expect(o.geometry.getAttribute('normal')).toBeDefined();}});
    inventory.push({slot,species:d.species,land:d.landUrl,water:d.waterUrl,scale:d.scale,landOffset:-.77,waterline:d.waterline,triangles:view.triangles,primitives,materials:materials.size,bounds:{min:b.min.toArray(),max:b.max.toArray()},clips:[...land.animations,...water.animations].map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),hierarchy:land.scene.children.map(o=>o.name)});
    for(let i=0;i<80;i++)view.update(.7,.02,true,false,.77);
    // At ordinary travel all original rigs hit the playback ceiling. Scale it
    // with controlled travel too; otherwise a slower body keeps its old gait.
    const actions = view as unknown as { walk?: { timeScale:number }; goose?: { walk:{timeScale:number} }; swim:{timeScale:number} };
    for(let i=0;i<100;i++)view.update(settings.player.speed,.02,true,false,.77);
    expect((actions.walk ?? actions.goose!.walk).timeScale).toBeCloseTo(3*playerMovementScale,6);
    expect(root.position.toArray()).toEqual([0,0,0]); expect(root.quaternion.toArray()).toEqual([0,0,0,1]);
    const time=land.scene.getObjectByName(d.root)!.position.clone(); view.update(5,1,true,true,.77); expect(root.position).toEqual(time);
    view.setWater(true); for(let i=0;i<30;i++)view.update(.8,.02,true,false,.45);
    view.update(riverSettings.speed,.02,true,false,.45);
    expect(actions.swim.timeScale).toBeCloseTo(3*playerMovementScale,6);
    expect(land.scene.visible).toBe(false); expect(water.scene.visible).toBe(true);
    expect(water.scene.position.y+.45+d.waterline*d.scale).toBeCloseTo(riverSettings.surfaceY,6);
    // Current/chain motion needs no input; stationary water still uses an authored aquatic clip.
    for(let i=0;i<30;i++)view.update(0,.02,false,false,.45);
    expect(water.scene.visible).toBe(true); expect(water.scene.getObjectByName(d.root)!.position.length()).toBe(0);
    view.setWater(false); for(let i=0;i<30;i++)view.update(.001,.02,true,false,.77);
    expect(land.scene.visible).toBe(true); expect(water.scene.visible).toBe(false);
    expect(view.labelHeight).toBeGreaterThan(b.max.y+.25);
    view.reset(); expect(land.scene.position.y).toBe(-.77);
  } finally { view.dispose(); }
});
it('uses stable slot definitions for every capacity and never selects from render order',()=>{
  expect(playerSlots.map(s=>characterAssets[s].species)).toEqual(['Goose','Axolotl','Capybara','Unicorn']);
  for(const capacity of [2,3,4])expect(playerSlots.slice(0,capacity).map(s=>characterAssets[s].root)).toEqual(['Goose_Root','Axolotl_Root','Capybara_Root','Unicorn_Root'].slice(0,capacity));
});
it('owns mixers/resources once, disposes both authored skins and never moves the authoritative group',async()=>{
  const d=characterAssets.p3,land=await characterLoad(d.landUrl),water=await characterLoad(d.waterUrl),p=new PlayerView(0xffffff);
  const disposers: ReturnType<typeof vi.spyOn>[]=[];
  for(const a of [land,water])a.scene.traverse(o=>{if(o instanceof Mesh)disposers.push(vi.spyOn(o.geometry,'dispose'));});
  p.useCharacter(land,water,d);p.setWater({id:'p3',phase:'endangered',exposureSeconds:2,safeSeconds:0});
  for(let i=0;i<40;i++)p.update({x:2,y:.4,z:3},{x:1,y:0,z:0},.02,true,false);
  expect(p.group.position.toArray()).toEqual([2,.4,3]);expect(p.group.getObjectByName('water-marker')!.visible).toBe(true);
  const before=p.group.children.length;p.reset();expect(p.group.children.length).toBe(before);
  p.dispose();expect(disposers.every(s=>s.mock.calls.length===1)).toBe(true);
});
it('writes the measured actual-loader inventory for review when explicitly requested',()=>{
  if(process.env.M15B_INVENTORY==='1')writeFileSync('diagnostics/m15b-asset-inventory.json',JSON.stringify(inventory,null,2));
});

it('restores an aquatic pose immediately on a paused in-water reclaim without advancing animation time',async()=>{
 const d=characterAssets.p1,land=await characterLoad(d.landUrl),water=await characterLoad(d.waterUrl),view=new CharacterView(land,water,d);
 try{
  view.setWater(true);view.update(.4,.1,false,true,.47);
  expect(water.scene.visible).toBe(true);expect(land.scene.visible).toBe(false);
  expect(water.scene.position.y+.47+d.waterline*d.scale).toBeCloseTo(riverSettings.surfaceY,6);
  const pose=water.scene.getObjectByName('Goose_Root')!.position.clone();
  view.update(.4,5,false,true,.47);expect(water.scene.getObjectByName('Goose_Root')!.position).toEqual(pose);
  view.update(.4,.05,false,false,.47);expect(water.scene.visible).toBe(true);
 }finally{view.dispose();}
});
