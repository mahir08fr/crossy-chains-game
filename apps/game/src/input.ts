import type { PlayerInputs } from '@crossy/simulation';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private readonly events = new AbortController();
  private focused = document.hasFocus();

  constructor(onRestart: () => void, onDebug: () => void, private readonly onClear?: (reason: string, hadKeys: boolean) => void) {
    const options = { signal: this.events.signal };
    window.addEventListener('keydown', (event) => {
      if (this.paused || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['SELECT', 'INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (movementKeys.has(event.code)) {
        event.preventDefault();
        // A held key after focus returns must not become a fresh movement gesture.
        if (!event.repeat || this.pressed.has(event.code)) this.pressed.add(event.code);
      }
      if (event.code === 'KeyR' && !event.repeat) onRestart();
      if (event.code === 'F2' && !event.repeat) { event.preventDefault(); onDebug(); }
    }, options);
    window.addEventListener('keyup', (event) => this.pressed.delete(event.code), options);
    window.addEventListener('blur', () => { this.focused = false; this.clear('blur'); }, options);
    window.addEventListener('focus', () => { this.focused = true; this.clear('focus'); }, options);
    document.addEventListener('visibilitychange', () => this.clear(document.hidden ? 'hidden' : 'visible'), options);
  }

  get paused(): boolean {
    return !this.focused || document.hidden;
  }

  sample(): PlayerInputs {
    if (this.paused) return {};
    const held = (key: string) => this.pressed.has(key) ? 1 : 0;
    // Camera looks toward +Z: screen-right is world -X. Orientation stays fixed.
    return {
      p1: { x: held('KeyA') - held('KeyD'), z: held('KeyW') - held('KeyS') },
      p2: { x: held('ArrowLeft') - held('ArrowRight'), z: held('ArrowUp') - held('ArrowDown') },
    };
  }

  clear(reason = 'explicit'): void {
    const hadKeys = this.pressed.size > 0;
    this.pressed.clear();
    this.onClear?.(reason, hadKeys);
  }
  dispose(): void { this.events.abort(); this.clear(); }
}
