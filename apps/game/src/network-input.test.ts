import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardInput } from './input';
import { NetworkInputSender } from './network-input';
afterEach(() => vi.unstubAllGlobals());
describe('current browser input sending', () => {
  it('sends roughly 30 Hz with immediate edges and no queued offline history', () => {
    const send = vi.fn<(x: number, z: number) => void>();
    const sender = new NetworkInputSender(send);
    sender.update(0, { x: 0, z: 0 }, true);
    sender.update(10, { x: 0, z: 1 }, true);
    sender.update(11, { x: 0, z: 0 }, true);
    sender.update(20, { x: 0, z: 0 }, true);
    expect(send.mock.calls).toEqual([[0, 0], [0, 1], [0, 0]]);
    sender.update(44, { x: 0, z: 0 }, true);
    expect(send).toHaveBeenCalledTimes(4);
    sender.update(45, { x: 1, z: 1 }, false);
    sender.update(46, { x: -1, z: 0 }, false);
    sender.update(47, { x: 0, z: 0 }, true);
    expect(send.mock.calls.at(-1)).toEqual([0, 0]);
    expect(send).toHaveBeenCalledTimes(5);
  });
  it('sends neutral immediately on focus/visibility loss and requires fresh movement gestures', () => {
    const windowEvents = new EventTarget();
    const documentEvents = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true });
    vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents);
    const keyboard = new KeyboardInput(() => undefined, () => undefined);
    const send = vi.fn<(x: number, z: number) => void>();
    const sender = new NetworkInputSender(send);
    const key = (repeat = false) => {
      const event = new Event('keydown'); Object.assign(event, { code: 'KeyW', repeat }); windowEvents.dispatchEvent(event);
    };
    const update = (time: number) => sender.update(time, keyboard.sample().p1 ?? { x: 0, z: 0 }, true);
    try {
      key(); update(0);
      windowEvents.dispatchEvent(new Event('blur')); update(1);
      expect(send.mock.calls.at(-1)).toEqual([0, 0]);
      windowEvents.dispatchEvent(new Event('focus')); key(true); update(2);
      expect(send).toHaveBeenCalledTimes(2);
      key(); update(3);
      expect(send.mock.calls.at(-1)).toEqual([0, 1]);
      documentEvents.hidden = true; documentEvents.dispatchEvent(new Event('visibilitychange')); update(4);
      expect(send.mock.calls.at(-1)).toEqual([0, 0]);
      documentEvents.hidden = false; documentEvents.dispatchEvent(new Event('visibilitychange')); key(true); update(5);
      expect(send).toHaveBeenCalledTimes(4);
    } finally { keyboard.dispose(); }
  });
});
