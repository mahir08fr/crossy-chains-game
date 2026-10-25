import { expect, it, vi } from 'vitest';
import { joystickAxes, VirtualJoystick } from './joystick';
import { ControllerInput } from './controller-input';
import { controllerJoinLink, controllerQr } from './couch-invite';
import type { ControllerStatus } from '@crossy/protocol';
const neutral = { x: 0, z: 0 };
it('generates a public room-only controller link and local QR with quiet zone', () => {
  const link = controllerJoinLink('http://192.168.1.24:5173/display.html?token=SECRET#private', 'ABCDEFGH');
  expect(link).toBe('http://192.168.1.24:5173/controller.html#ABCDEFGH');
  expect(controllerQr(link)).toMatch(/<svg/); expect(controllerQr(link)).not.toContain('SECRET');
  expect(() => controllerJoinLink('https://game.invalid', 'TOKEN')).toThrow();
  expect(() => controllerJoinLink('javascript:alert(1)', 'ABCDEFGH')).toThrow();
});
it('maps analog strength/deadzone and clamps diagonal magnitude without reversing forward', () => {
  expect(joystickAxes(0, 0, 100)).toEqual(neutral);
  expect(joystickAxes(9, 0, 100)).toEqual(neutral);
  expect(joystickAxes(0, -55, 100).z).toBeCloseTo(.5);
  expect(joystickAxes(55, 0, 100).x).toBeCloseTo(-.5);
  const diagonal = joystickAxes(300, -300, 100);
  expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1); expect(diagonal.z).toBeGreaterThan(0);
  expect(joystickAxes(NaN, 1, 10)).toEqual(neutral);
});
function joystickHarness() {
  const captures = new Set<number>();
  const surface = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setAttribute: vi.fn(),
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
  });
  const released = vi.fn(), knob = { style: { transform: '' } };
  const joystick = new VirtualJoystick(surface as unknown as HTMLElement, knob as unknown as HTMLElement, released);
  function pointer(type: string, id: number, x = 100, y = 10) {
    const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0 }); surface.dispatchEvent(event); return event;
  }
  return { joystick, pointer, released, captures };
}
it('one pointer owns joystick, ignores second touch, releases/cancels/lost capture/disables with fresh gesture', () => {
  const h = joystickHarness(); h.joystick.setEnabled(true);
  expect(h.pointer('pointerdown', 1).defaultPrevented).toBe(true); expect(h.joystick.sample().z).toBe(1);
  h.pointer('pointerdown', 2, 10, 100); h.pointer('pointermove', 2, 10, 100); h.pointer('pointerup', 2);
  expect(h.joystick.sample().z).toBe(1); expect(h.released).not.toHaveBeenCalled();
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    h.pointer(event, 1); expect(h.joystick.sample()).toEqual(neutral);
    h.pointer('pointermove', 1); expect(h.joystick.sample()).toEqual(neutral); h.pointer('pointerdown', 1);
  }
  h.joystick.setEnabled(false); expect(h.joystick.sample()).toEqual(neutral);
  h.joystick.setEnabled(true); h.pointer('pointermove', 1); expect(h.joystick.sample()).toEqual(neutral);
  h.joystick.dispose(); h.pointer('pointerdown', 1); expect(h.joystick.sample()).toEqual(neutral);
});
const status: ControllerStatus = { protocolVersion: 1, runGeneration: 1, serverTimeMs: 100, phase: 'running', outcome: 'active', displayActive: true };
it('clears on missing/stale updates, lock/focus, sender stalls, new runs and reconnect without replay', () => {
  const sent: number[][] = []; let axes = neutral;
  const clear = vi.fn(() => { axes = neutral; });
  const input = new ControllerInput((x, z) => sent.push([x, z]), clear);
  input.receive(status, 100); input.update(100, true, true, () => axes);
  axes = { x: .5, z: .5 }; input.update(134, true, true, () => axes); expect(sent.at(-1)).toEqual([.5, .5]);
  input.update(150, false, true, () => axes); expect(axes).toEqual(neutral);
  input.receive({ ...status, serverTimeMs: 170 }, 170); input.update(170, true, true, () => axes); expect(sent.at(-1)).toEqual([0, 0]);
  axes = { x: 1, z: 0 }; input.update(500, true, true, () => axes); expect(axes).toEqual(neutral);
  input.receive({ ...status, serverTimeMs: 501 }, 501); input.update(501, true, true, () => axes); expect(sent.at(-1)).toEqual([0, 0]);
  axes = { x: 1, z: 0 }; input.receive({ ...status, runGeneration: 2 }, 530); expect(axes).toEqual(neutral);
  axes = { x: 1, z: 0 }; input.reset(); expect(axes).toEqual(neutral);
  expect(input.update(560, true, true, () => axes)).toBe(false);
});
it('uses aligned server age as well as arrival age, and retains a 30Hz steady sender', () => {
  const send = vi.fn(), clear = vi.fn(); const pump = new ControllerInput(send, clear);
  pump.clock(100, 90, 110); pump.receive(status, 100);
  for (let now = 100; now <= 300; now++) { if (now % 50 === 0) pump.receive({ ...status, serverTimeMs: now }, now); pump.update(now, true, true, () => neutral); }
  expect(send.mock.calls.length).toBeLessThanOrEqual(7);
  pump.receive({ ...status, serverTimeMs: 100 }, 400); expect(pump.update(400, true, true, () => ({ x: 1, z: 0 }))).toBe(false);
});

it('does not let an asymmetric slow ping invalidate fresh controller updates', () => {
  let axes = neutral; const sent: number[][] = [];
  const pump = new ControllerInput((x,z) => sent.push([x,z]), () => { axes = neutral; });
  pump.receive({ ...status, serverTimeMs: 1000 }, 1000);
  // True clock offset is zero. This ping spent 1 s waiting on the request
  // path, while status and input traffic continued normally. Its midpoint
  // estimate would falsely put the server 500 ms ahead of this device.
  pump.clock(1000, 0, 1000);
  expect(pump.update(1000, true, true, () => axes)).toBe(true);
  axes = { x: .5, z: 0 };
  pump.receive({ ...status, serverTimeMs: 1050 }, 1050);
  expect(pump.update(1050, true, true, () => axes)).toBe(true);
  expect(sent.at(-1)).toEqual([.5, 0]);
});

it('rejects poor clock samples, retains a good estimate, and resets alignment on reconnection', () => {
  const diagnostics = vi.fn(), pump = new ControllerInput(vi.fn(), vi.fn(), diagnostics);
  pump.clock(1010, 1000, 1020); // good offset zero
  pump.clock(1150, 1050, 1150); // poorer asymmetric 100 ms sample
  pump.receive({ ...status, serverTimeMs: 1200 }, 1200);
  expect(pump.update(1200, true, true, () => neutral)).toBe(true);
  expect(diagnostics).toHaveBeenCalledWith('clock-sample-rejected', expect.objectContaining({ rttMs: 100 }));
  pump.clock(NaN, 1, 2); pump.clock(1, 2, 1);
  // A genuinely queued status still fails the unchanged 250 ms aligned gate.
  pump.receive({ ...status, serverTimeMs: 900 }, 1201);
  expect(pump.update(1201, true, true, () => neutral)).toBe(false);
  pump.reset(); pump.receive({ ...status, serverTimeMs: 10 }, 1250);
  expect(pump.update(1250, true, true, () => neutral)).toBe(true);
});
it('forwards only the explicit diagnostic flag in a public QR link', () => {
  expect(controllerJoinLink('http://192.168.1.24:5173?token=SECRET', 'ABCDEFGH', true))
    .toBe('http://192.168.1.24:5173/controller.html?inputDiagnostics=1#ABCDEFGH');
});
