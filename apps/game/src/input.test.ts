import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardInput } from './input';

let windowEvents: EventTarget;
let documentEvents: EventTarget & { hidden: boolean; hasFocus: () => boolean };
let input: KeyboardInput;
let restart: ReturnType<typeof vi.fn<() => void>>;
let debug: ReturnType<typeof vi.fn<() => void>>;

function key(code: string, type = 'keydown', repeat = false): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat, ctrlKey: false, metaKey: false, altKey: false });
  windowEvents.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  windowEvents = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true });
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('document', documentEvents);
  restart = vi.fn();
  debug = vi.fn();
  input = new KeyboardInput(restart, debug);
});
afterEach(() => { input.dispose(); vi.unstubAllGlobals(); });

describe('shared keyboard routing and lifecycle', () => {
  it('splits WASD and arrows, prevents scrolling and releases keys independently', () => {
    key('KeyW');
    key('KeyD');
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    key('ArrowLeft');
    expect(input.sample()).toEqual({ p1: { x: -1, z: 1 }, p2: { x: 1, z: -1 } });
    key('KeyW', 'keyup');
    expect(input.sample()).toEqual({ p1: { x: -1, z: 0 }, p2: { x: 1, z: -1 } });
    input.clear();
    expect(input.sample()).toEqual({ p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } });
  });

  it('clears both players on blur and requires fresh keys after returning', () => {
    key('KeyW'); key('ArrowUp');
    windowEvents.dispatchEvent(new Event('blur'));
    expect(input.paused).toBe(true);
    expect(input.sample()).toEqual({});
    windowEvents.dispatchEvent(new Event('focus'));
    key('KeyW', 'keydown', true); key('ArrowUp', 'keydown', true);
    expect(input.sample()).toEqual({ p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } });
    key('KeyW'); key('ArrowUp');
    expect(input.sample().p1?.z).toBe(1);
    expect(input.sample().p2?.z).toBe(1);
  });

  it('clears both players when hidden and does not retain input on return', () => {
    key('KeyW'); key('ArrowUp');
    documentEvents.hidden = true;
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(input.paused).toBe(true);
    expect(input.sample()).toEqual({});
    documentEvents.hidden = false;
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(input.sample()).toEqual({ p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } });
  });

  it('lets the scenario selector use keyboard navigation without driving players', () => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code: 'ArrowDown', repeat: false });
    Object.defineProperty(event, 'target', { value: { tagName: 'SELECT' } });
    windowEvents.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(input.sample()).toEqual({ p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } });
  });

  it('removes listeners on disposal so replacing input does not duplicate callbacks', () => {
    input.dispose();
    input = new KeyboardInput(restart, debug);
    key('KeyR'); key('KeyR', 'keydown', true);
    key('F2');
    expect(restart).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
    input.dispose();
    key('KeyR'); key('KeyW'); key('ArrowUp');
    expect(restart).toHaveBeenCalledTimes(1);
    expect(input.sample()).toEqual({ p1: { x: 0, z: 0 }, p2: { x: 0, z: 0 } });
  });
});
