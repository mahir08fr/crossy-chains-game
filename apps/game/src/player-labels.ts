import { Vector3 } from 'three';
import type { Camera } from 'three';
import type { PlayerSlot } from '@crossy/protocol';
import { defaultDisplayName } from '@crossy/protocol';
import type { PlayerView } from './player-view';

/** Four plain-text nodes, stable pixel size and only transform writes on draw.
 * Labels use the exact camera/interpolated visual pose, not a second interpolation. */
export class PlayerLabels {
  private readonly layer = document.createElement('div');
  private readonly nodes = new Map<PlayerSlot, HTMLSpanElement>();
  private present: ReadonlySet<PlayerSlot> | undefined;
  setPresent(slots: readonly PlayerSlot[]): void {
    this.present = new Set(slots);
    for (const [slot,node] of this.nodes) if (!this.present.has(slot)) { node.remove(); this.nodes.delete(slot); }
  }
  private readonly point = new Vector3();
  constructor(private readonly viewport: HTMLElement) {
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
    this.layer.setAttribute('aria-label','Player names');
    viewport.append(this.layer);
  }
  setName(slot: PlayerSlot, name: string): void {
    let node = this.nodes.get(slot);
    if (!node) {
      node = document.createElement('span'); node.dataset.playerName = slot;
      node.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:600 12px/18px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #102128,1px 0 2px #102128,-1px 0 2px #102128;max-width:150px;overflow:hidden;text-overflow:ellipsis;will-change:transform';
      this.nodes.set(slot,node); this.layer.append(node);
    }
    if (node.textContent !== name) node.textContent = name;
  }
  update(players: ReadonlyMap<PlayerSlot, PlayerView>, camera: Camera): void {
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    const occupied: { x: number; y: number; width: number }[] = [];
    for (const [slot, view] of players) {
      if (this.present && !this.present.has(slot)) continue;
      if (!this.nodes.has(slot)) this.setName(slot, defaultDisplayName(slot));
      const node = this.nodes.get(slot)!;
      this.point.copy(view.group.position); this.point.y += view.labelHeight; this.point.project(camera);
      const visible = view.group.visible && Math.abs(this.point.x) <= 1 && Math.abs(this.point.y) <= 1 && Math.abs(this.point.z) <= 1;
      node.hidden = !visible; if (!visible) continue;
      const labelWidth = Math.min(150, Math.max(36, node.offsetWidth));
      const x = Math.max(labelWidth / 2 + 3, Math.min(width - labelWidth / 2 - 3, (this.point.x + 1) * width / 2));
      let y = Math.max(20, (1 - this.point.y) * height / 2);
      for (let n = 0; n < 4; n++) {
        const collision = occupied.find(p => Math.abs(x - p.x) < (labelWidth + p.width) / 2 + 4 && Math.abs(y - p.y) < 19);
        if (!collision) break; y = collision.y - 20;
      }
      y = Math.max(19,y); occupied.push({x,y,width:labelWidth});
      node.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-100%)`;
    }
    for (const [slot,node] of this.nodes) if (!players.has(slot)) { node.remove(); this.nodes.delete(slot); }
  }
  resetNames(): void { this.present = undefined; for (const [slot] of this.nodes) this.setName(slot, defaultDisplayName(slot)); }
  dispose(): void { this.nodes.clear(); this.layer.remove(); }
}
