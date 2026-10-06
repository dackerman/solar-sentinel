import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneParallax, tiltOffset } from '../components/sceneParallax.js';

function media(matches: boolean): MediaQueryList {
  return Object.assign(new EventTarget(), {
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as MediaQueryList;
}

let reduced: MediaQueryList;
let coarse: MediaQueryList;
let controller: SceneParallax;
let surface: HTMLElement;
let button: HTMLButtonElement;
let move: ReturnType<typeof vi.fn>;
const orientation = (beta: number | null, gamma: number | null) =>
  window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma }));
const gravity = (x: number, y: number, z: number) =>
  window.dispatchEvent(
    Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x, y, z } })
  );

beforeEach(() => {
  reduced = media(false);
  coarse = media(true);
  vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    query.includes('reduced-motion') ? reduced : coarse
  );
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('DeviceOrientationEvent', class {});
  vi.stubGlobal('DeviceMotionEvent', class {});
  document.body.innerHTML =
    '<section><button></button><p id="scene-tilt-status" hidden></p></section>';
  surface = document.querySelector('section')!;
  button = document.querySelector('button')!;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    width: 400,
    height: 600,
  } as DOMRect);
  move = vi.fn();
});
afterEach(() => {
  controller?.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = () => {
  controller = new SceneParallax(surface, button, move);
  controller.setActive(true);
  move.mockClear();
};

describe('scene parallax', () => {
  it('calibrates relative tilt, caps motion and rotates axes in landscape', () => {
    expect(tiltOffset({ beta: 50, gamma: 0 }, { beta: 50, gamma: 0 }, 0)).toEqual([0, 0]);
    expect(tiltOffset({ beta: 57, gamma: 7 }, { beta: 50, gamma: 0 }, 0)).toEqual([0.5, 0.5]);
    const landscape = tiltOffset({ beta: 57, gamma: 0 }, { beta: 50, gamma: 0 }, 90);
    expect(landscape[0]).toBeCloseTo(0.5);
    expect(landscape[1]).toBeCloseTo(0);
    expect(tiltOffset({ beta: 170, gamma: -90 }, { beta: 50, gamma: 0 }, 0)).toEqual([-1, 1]);
    expect(tiltOffset({ beta: -179, gamma: 0 }, { beta: 179, gamma: 0 }, 0)[1]).toBeCloseTo(2 / 14);
  });

  it('normalizes pointer input and leaves touchscreen scrolling alone', () => {
    mount();
    surface.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 500, clientY: 50 })
    );
    expect(move).toHaveBeenLastCalledWith(1, -1);
    surface.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerType: 'touch', clientX: 100, clientY: 650 })
    );
    expect(move).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(new Event('pointerleave'));
    expect(move).toHaveBeenLastCalledWith(0, 0);
  });

  it('anchors to the first valid sensor reading and detaches while inactive', () => {
    mount();
    orientation(null, null);
    expect(move).not.toHaveBeenCalled();
    orientation(50, 0);
    expect(move).toHaveBeenLastCalledWith(0, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
    controller.setActive(false);
    move.mockClear();
    orientation(70, 14);
    expect(move).not.toHaveBeenCalled();
    controller.setActive(true);
    orientation(70, 14);
    expect(move).toHaveBeenLastCalledWith(0, 0);
  });

  it('falls back to gravity readings and ignores shakes and duplicate motion readings', () => {
    mount();
    gravity(0, 0, 9.81);
    gravity(2.54, 0, 9.47);
    expect(move.mock.calls[move.mock.calls.length - 1][0]).toBe(1);
    move.mockClear();
    gravity(30, 20, 10);
    expect(move).not.toHaveBeenCalled();
    orientation(50, 0);
    move.mockClear();
    gravity(4, 0, 8);
    expect(move).not.toHaveBeenCalled();
  });

  it('falls back to a tap when automatic permission needs activation and handles denial', async () => {
    const requestPermission = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Tap required', 'NotAllowedError'))
      .mockResolvedValue('denied');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    mount();
    await vi.waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('no motion readings')
    );
    expect(requestPermission).toHaveBeenCalledOnce();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toContain('denied'));
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    move.mockClear();
    orientation(50, 0);
    expect(move).not.toHaveBeenCalled();
    requestPermission.mockResolvedValue('granted');
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    orientation(50, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
  });

  it('reuses granted permissions on startup without a tap, and respects a manual disable', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    mount();
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    orientation(50, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
    expect(button.getAttribute('aria-label')).toBe('Disable device tilt');
    button.click();
    controller.setActive(false);
    controller.setActive(true);
    move.mockClear();
    orientation(64, 14);
    expect(move).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it('accepts readings automatically despite a permission API and does not prompt on desktop', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    mount();
    // Browsers that already emit events need no click or permission callback.
    orientation(50, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
    controller.dispose();
    Object.assign(coarse, { matches: false });
    requestPermission.mockClear();
    mount();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(button.hidden).toBe(true);
  });

  it('recalibrates after a rotation and respects reduced motion and insecure contexts', () => {
    mount();
    orientation(50, 0);
    orientation(57, 7);
    window.dispatchEvent(new Event('orientationchange'));
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0, 0);
    Object.assign(reduced, { matches: true });
    reduced.dispatchEvent(new Event('change'));
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(document.getElementById('scene-tilt-status')?.textContent).toContain('Reduce motion');
    move.mockClear();
    orientation(80, 14);
    surface.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 500, clientY: 50 })
    );
    expect(move).not.toHaveBeenCalled();
    controller.dispose();
    vi.stubGlobal('isSecureContext', false);
    Object.assign(reduced, { matches: false });
    mount();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(document.getElementById('scene-tilt-status')?.textContent).toContain('HTTPS');
    orientation(50, 0);
    expect(move).not.toHaveBeenCalled();
  });
  it('supports touch devices even when the coarse pointer query is false', () => {
    Object.assign(coarse, { matches: false });
    vi.stubGlobal('navigator', { maxTouchPoints: 2 });
    mount();
    expect(button.hidden).toBe(false);
    orientation(50, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
    surface.dispatchEvent(Object.assign(new Event('pointerleave'), { pointerType: 'touch' }));
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
  });

  it('requests both sensor permissions from the tap so gravity can recover denied orientation', async () => {
    const requestOrientation = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Tap required', 'NotAllowedError'))
      .mockResolvedValue('denied');
    const requestMotion = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Tap required', 'NotAllowedError'))
      .mockResolvedValue('granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: requestOrientation });
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: requestMotion });
    mount();
    button.click();
    expect(requestOrientation).toHaveBeenCalledTimes(2);
    expect(requestMotion).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    gravity(0, 0, 9.81);
    gravity(2.54, 0, 9.47);
    expect(move.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it('reports silent sensors, retries from a tap, and logs no raw readings', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    controller = new SceneParallax(surface, button, move, log);
    controller.setActive(true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(button.getAttribute('aria-label')).toContain('no motion readings');
    expect(document.getElementById('scene-tilt-status')?.textContent).toContain('site settings');
    button.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    orientation(50, 0);
    orientation(57, 7);
    expect(move).toHaveBeenLastCalledWith(0.5, 0.5);
    expect(log).toHaveBeenCalledWith('Scene tilt: receiving readings', { source: 'orientation' });
    expect(log).toHaveBeenCalledWith('Scene tilt: camera movement requested', {
      source: 'orientation',
    });
    expect(document.getElementById('scene-tilt-status')?.hidden).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain('beta');
    controller.setActive(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(log.mock.calls.filter(call => call[0] === 'Scene tilt: no readings')).toHaveLength(1);
  });
});
