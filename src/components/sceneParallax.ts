import { clamp } from '../utils/weatherScene.js';

interface PermissionSensor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}
interface TiltReading {
  beta: number;
  gamma: number;
}

const wrapDegrees = (value: number): number => ((value + 540) % 360) - 180;

// Relative tilt means the user's normal holding position is always neutral.
export function tiltOffset(
  reading: TiltReading,
  neutral: TiltReading,
  screenAngle: number
): [number, number] {
  const pitch = wrapDegrees(reading.beta - neutral.beta);
  const roll = wrapDegrees(reading.gamma - neutral.gamma);
  const angle = (screenAngle * Math.PI) / 180;
  return [
    clamp((roll * Math.cos(angle) + pitch * Math.sin(angle)) / 14, -1, 1),
    clamp((-roll * Math.sin(angle) + pitch * Math.cos(angle)) / 14, -1, 1),
  ];
}

export class SceneParallax {
  private active = false;
  private tiltEnabled = true;
  private autoPermissionRequested = false;
  private disposed = false;
  private requesting = false;
  private listening = false;
  private neutral: TiltReading | null = null;
  private source: 'orientation' | 'gravity' | null = null;
  private lastOrientationAt = -Infinity;
  private receivedReading = false;
  private reportedMovement = false;
  private needsTap = false;
  private permissionDenied = false;
  private waitingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly status: HTMLElement | null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly coarsePointer = window.matchMedia('(any-pointer: coarse)');

  constructor(
    private readonly surface: HTMLElement,
    private readonly button: HTMLButtonElement,
    private readonly move: (x: number, y: number) => void,
    private readonly log: (message: string, data?: Record<string, unknown>) => void = () => {}
  ) {
    this.status = surface.querySelector('#scene-tilt-status');
    this.log('Scene tilt: capabilities', {
      secure: window.isSecureContext,
      touchPoints: navigator.maxTouchPoints,
      coarsePointer: this.coarsePointer.matches,
      reducedMotion: this.reducedMotion.matches,
      orientation: typeof DeviceOrientationEvent !== 'undefined',
      motion: typeof DeviceMotionEvent !== 'undefined',
      permissionRequired: Boolean(this.permissionSensors().length),
    });
    // Listen immediately: having a permission API does not imply access is blocked.
    surface.addEventListener('pointermove', this.onPointerMove, { passive: true });
    surface.addEventListener('pointerleave', this.onPointerLeave);
    button.addEventListener('click', this.toggleTilt);
    this.reducedMotion.addEventListener('change', this.sync);
    this.coarsePointer.addEventListener('change', this.sync);
    screen.orientation?.addEventListener('change', this.recenter);
    window.addEventListener('orientationchange', this.recenter);
    this.sync();
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.sync();
  }

  private permissionSensors(): PermissionSensor[] {
    const orientation =
      typeof DeviceOrientationEvent === 'undefined'
        ? undefined
        : (DeviceOrientationEvent as PermissionSensor);
    const motion =
      typeof DeviceMotionEvent === 'undefined'
        ? undefined
        : (DeviceMotionEvent as PermissionSensor);
    return [orientation, motion].filter(
      (sensor): sensor is PermissionSensor => typeof sensor?.requestPermission === 'function'
    );
  }

  private mobile(): boolean {
    return this.coarsePointer.matches || navigator.maxTouchPoints > 0;
  }

  private supported(): boolean {
    return (
      window.isSecureContext &&
      (typeof DeviceOrientationEvent !== 'undefined' || typeof DeviceMotionEvent !== 'undefined')
    );
  }

  private requestPermissions(): Promise<PromiseSettledResult<'granted' | 'denied'>[]> {
    // Calls happen before the first await, retaining activation on a manual tap.
    return Promise.allSettled(
      this.permissionSensors().map(async sensor => sensor.requestPermission!())
    );
  }

  private async reusePermissions(): Promise<void> {
    if (this.autoPermissionRequested || !this.permissionSensors().length) return;
    this.autoPermissionRequested = true;
    // Already granted access can be reused without activation. A browser that
    // needs a new permission rejects this attempt; the tap control stays available.
    const permissions = await this.requestPermissions();
    if (this.disposed) return;
    const granted = permissions.some(
      permission => permission.status === 'fulfilled' && permission.value === 'granted'
    );
    this.log('Scene tilt: automatic permission result', {
      granted,
      results: permissions.map(permission =>
        permission.status === 'fulfilled' ? permission.value : 'gesture-required'
      ),
    });
    if (!granted && !this.receivedReading && this.tiltEnabled) {
      this.needsTap = true;
      this.permissionDenied = permissions.some(
        permission => permission.status === 'fulfilled' && permission.value === 'denied'
      );
      if (this.permissionDenied) this.stopSensors();
      this.updateControl();
    }
  }

  private readonly toggleTilt = async (): Promise<void> => {
    if (this.requesting) return;
    if (this.tiltEnabled && !this.needsTap && this.receivedReading) {
      this.tiltEnabled = false;
      this.sync();
      return;
    }
    this.requesting = true;
    this.permissionDenied = false;
    this.log('Scene tilt: enable tapped');
    this.button.disabled = true;
    try {
      // Request both APIs within the same user gesture so the gravity fallback
      // is usable even when orientation events are absent.
      const permissions = await this.requestPermissions();
      this.tiltEnabled =
        !permissions.length ||
        permissions.some(
          permission => permission.status === 'fulfilled' && permission.value === 'granted'
        );
      this.permissionDenied = !this.tiltEnabled;
      this.needsTap = false;
      this.log('Scene tilt: permission result', {
        granted: this.tiltEnabled,
        results: permissions.map(permission =>
          permission.status === 'fulfilled' ? permission.value : 'error'
        ),
      });
      this.sync();
    } catch {
      this.tiltEnabled = false;
      this.permissionDenied = true;
      this.log('Scene tilt: permission unavailable');
      this.sync();
    } finally {
      this.requesting = false;
      this.button.disabled = !this.supported() || this.reducedMotion.matches;
    }
  };

  private readonly sync = (): void => {
    const mobile = this.mobile();
    this.button.hidden = !mobile;
    this.button.disabled = !this.supported() || this.reducedMotion.matches;
    this.stopSensors();
    this.recenter();
    if (
      this.active &&
      mobile &&
      this.supported() &&
      this.tiltEnabled &&
      !this.reducedMotion.matches
    ) {
      window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
      window.addEventListener('devicemotion', this.onMotion, { passive: true });
      this.listening = true;
      this.receivedReading = false;
      this.log('Scene tilt: listening');
      void this.reusePermissions();
      this.waitingTimer = setTimeout(() => {
        if (this.receivedReading || !this.listening) return;
        this.needsTap = true;
        this.log('Scene tilt: no readings', { secure: window.isSecureContext });
        this.updateControl();
        void this.checkPermissions();
      }, 4000);
    }
    this.updateControl();
  };

  private updateControl(): void {
    let label =
      this.tiltEnabled && this.receivedReading && !this.needsTap
        ? 'Disable device tilt'
        : 'Enable device tilt';
    let message = '';
    if (!window.isSecureContext) message = 'Open the HTTPS preview to use phone tilt.';
    else if (!this.supported()) message = 'Phone tilt is unavailable in this browser.';
    else if (this.reducedMotion.matches)
      message = 'Phone tilt is off because Reduce motion is enabled.';
    else if (this.permissionDenied) {
      label = 'Enable device tilt; sensor permission was denied';
      message = 'Motion access was denied. Tap to retry.';
    } else if (this.needsTap) {
      label = 'Enable device tilt; no motion readings received';
      message =
        'No motion readings. Tap the phone icon to retry, or allow motion sensors in site settings.';
    } else if (!this.tiltEnabled) message = 'Tap the phone icon to enable tilt.';
    else if (this.active && !this.receivedReading)
      message = 'Move your phone gently to tilt the scene.';
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    this.button.setAttribute('aria-pressed', String(this.tiltEnabled && !this.needsTap));
    if (this.status) {
      this.status.textContent = message;
      this.status.hidden = !this.mobile() || !message || !this.active;
    }
  }

  private async checkPermissions(): Promise<void> {
    if (!navigator.permissions?.query) return;
    const states = await Promise.allSettled(
      ['accelerometer', 'gyroscope'].map(async name => {
        const permission = await navigator.permissions.query({ name: name as PermissionName });
        return { name, state: permission.state };
      })
    );
    this.log('Scene tilt: browser permissions', {
      states: states.map(state => (state.status === 'fulfilled' ? state.value : 'unavailable')),
    });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active || this.reducedMotion.matches || event.pointerType === 'touch') return;
    const bounds = this.surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.move(
      clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1),
      clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1)
    );
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || (this.listening && this.receivedReading)) return;
    this.recenter();
  };

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (
      event.beta === null ||
      event.gamma === null ||
      !Number.isFinite(event.beta) ||
      !Number.isFinite(event.gamma)
    )
      return;
    this.lastOrientationAt = performance.now();
    this.sample({ beta: event.beta, gamma: event.gamma }, 'orientation');
  };

  private readonly onMotion = (event: DeviceMotionEvent): void => {
    // Use gravity-based tilt only when no orientation readings are arriving.
    if (performance.now() - this.lastOrientationAt < 2000) return;
    const gravity = event.accelerationIncludingGravity;
    if (
      !gravity ||
      gravity.x === null ||
      gravity.y === null ||
      gravity.z === null ||
      ![gravity.x, gravity.y, gravity.z].every(Number.isFinite)
    )
      return;
    const magnitude = Math.hypot(gravity.x, gravity.y, gravity.z);
    if (magnitude < 6 || magnitude > 13) return; // Ignore shakes and free fall.
    this.sample(
      {
        beta: (Math.atan2(gravity.y, gravity.z) * 180) / Math.PI,
        gamma: (Math.atan2(gravity.x, Math.hypot(gravity.y, gravity.z)) * 180) / Math.PI,
      },
      'gravity'
    );
  };

  private sample(reading: TiltReading, source: 'orientation' | 'gravity'): void {
    if (!this.active || !this.listening || this.reducedMotion.matches) return;
    if (!this.receivedReading) {
      this.receivedReading = true;
      this.needsTap = false;
      this.permissionDenied = false;
      if (this.waitingTimer) clearTimeout(this.waitingTimer);
      this.waitingTimer = null;
      this.log('Scene tilt: receiving readings', { source });
      this.updateControl();
    }
    if (!this.neutral || source !== this.source) {
      this.neutral = reading;
      this.source = source;
    }
    const screenAngle =
      screen.orientation?.angle ??
      (typeof window.orientation === 'number' ? window.orientation : 0);
    const [x, y] = tiltOffset(reading, this.neutral, screenAngle);
    if (!this.reportedMovement && Math.max(Math.abs(x), Math.abs(y)) > 0.2) {
      this.reportedMovement = true;
      this.log('Scene tilt: camera movement requested', { source });
    }
    this.move(Math.abs(x) < 0.025 ? 0 : x, Math.abs(y) < 0.025 ? 0 : y);
  }

  private readonly recenter = (): void => {
    this.neutral = null;
    this.source = null;
    this.lastOrientationAt = -Infinity;
    this.move(0, 0);
  };

  private stopSensors(): void {
    if (this.waitingTimer) clearTimeout(this.waitingTimer);
    this.waitingTimer = null;
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('devicemotion', this.onMotion);
    this.listening = false;
  }

  dispose(): void {
    this.disposed = true;
    this.stopSensors();
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerleave', this.onPointerLeave);
    this.button.removeEventListener('click', this.toggleTilt);
    this.reducedMotion.removeEventListener('change', this.sync);
    this.coarsePointer.removeEventListener('change', this.sync);
    screen.orientation?.removeEventListener('change', this.recenter);
    window.removeEventListener('orientationchange', this.recenter);
    this.recenter();
  }
}
