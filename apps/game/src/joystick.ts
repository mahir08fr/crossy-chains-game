export type JoystickAxes = { x: number; z: number };

export function joystickAxes(dx: number, dy: number, radius: number): JoystickAxes {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 0) return { x: 0, z: 0 };
  const magnitude = Math.hypot(dx, dy) / radius;
  if (magnitude <= 0.1) return { x: 0, z: 0 };
  const strength = Math.min(1, (magnitude - 0.1) / 0.9);
  const length = Math.hypot(dx, dy);
  // The existing camera looks toward +Z: screen-right is world -X, matching D.
  return { x: -dx / length * strength, z: -dy / length * strength };
}

/** One captured pointer owns movement; other touches can operate session buttons. */
export class VirtualJoystick {
  private pointer: number | undefined;
  private enabled = false;
  private axes: JoystickAxes = { x: 0, z: 0 };
  private readonly events = new AbortController();
  constructor(private readonly surface: HTMLElement, private readonly knob: HTMLElement, private readonly released: () => void) {
    const options = { signal: this.events.signal };
    surface.addEventListener('pointerdown', event => {
      if (!this.enabled || this.pointer !== undefined || event.button !== 0) return;
      event.preventDefault(); this.pointer = event.pointerId;
      surface.setPointerCapture(event.pointerId); this.move(event);
    }, options);
    surface.addEventListener('pointermove', event => { if (this.pointer === event.pointerId) { event.preventDefault(); this.move(event); } }, options);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      surface.addEventListener(name, event => { if (this.pointer === event.pointerId) this.clear(); }, options);
    }
    surface.addEventListener('contextmenu', event => event.preventDefault(), options);
  }
  private move(event: PointerEvent): void {
    const rect = this.surface.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.34;
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    this.axes = joystickAxes(dx, dy, radius);
    const scale = Math.min(1, radius / Math.max(1, Math.hypot(dx, dy)));
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    this.surface.setAttribute('aria-valuetext', `Horizontal ${this.axes.x.toFixed(1)}, forward ${this.axes.z.toFixed(1)}`);
  }
  sample(): JoystickAxes { return { ...this.axes }; }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled; this.surface.setAttribute('aria-disabled', String(!enabled));
    if (!enabled) this.clear();
  }
  clear(): void {
    const pointer = this.pointer; this.pointer = undefined;
    this.axes = { x: 0, z: 0 }; this.knob.style.transform = 'translate(0px, 0px)';
    this.surface.setAttribute('aria-valuetext', 'Released');
    if (pointer !== undefined && this.surface.hasPointerCapture(pointer)) this.surface.releasePointerCapture(pointer);
    if (pointer !== undefined) this.released();
  }
  dispose(): void { this.events.abort(); this.clear(); }
}
