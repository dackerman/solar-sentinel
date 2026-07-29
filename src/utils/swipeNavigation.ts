// Touch swipe day-navigation for the main content area. See
// docs/superpowers/specs/2026-07-29-swipe-day-navigation-design.md for the
// interaction design this implements.

export type SwipeDirection = 1 | -1; // 1 = next day (swipe left), -1 = previous day (swipe right)

export interface SwipeNavigatorOptions {
  surface: HTMLElement; // element that listens for touches
  target: HTMLElement; // element that gets translated
  canNavigate: (direction: SwipeDirection) => boolean;
  onNavigate: (direction: SwipeDirection) => void;
}

// Below this much total finger movement, the gesture's axis is undecided.
export const AXIS_LOCK_THRESHOLD_PX = 10;
// Horizontal wins only once |dx| clearly dominates |dy| by this ratio; ties go to vertical.
export const AXIS_DOMINANCE_RATIO = 1.2;
// Commit once the drag covers this fraction of the surface width.
export const COMMIT_DISTANCE_RATIO = 0.35;
// A flick below this distance never commits, no matter how fast.
export const FLICK_MIN_DISTANCE_PX = 30;
// Minimum same-direction release velocity (px/ms) for a flick commit.
export const FLICK_MIN_VELOCITY = 0.5;
// Rubber-band divisor applied to movement in a blocked direction.
export const RESISTANCE_DIVISOR = 3;

const SNAP_BACK_MS = 200;
const COMMIT_OUT_MS = 200;
const COMMIT_IN_MS = 220;
// transitionend can be swallowed (e.g. backgrounded tab); this fallback guarantees progress.
const TRANSITION_FALLBACK_MS = 350;

/**
 * Classifies a gesture's axis from cumulative movement. Returns null while the
 * gesture is still undecided (total movement under the lock threshold); the
 * caller is responsible for locking in the first non-null result it sees.
 */
export function classifyAxis(dx: number, dy: number): 'horizontal' | 'vertical' | null {
  if (Math.hypot(dx, dy) < AXIS_LOCK_THRESHOLD_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE_RATIO ? 'horizontal' : 'vertical';
}

/** Negative dx (finger moved left) means "next day"; positive means "previous day". */
export function directionForOffset(dx: number): SwipeDirection {
  return dx < 0 ? 1 : -1;
}

/** Rubber-bands movement in a direction that's blocked (e.g. at a date bound). */
export function applyResistance(dx: number, allowed: boolean): number {
  return allowed ? dx : dx / RESISTANCE_DIVISOR;
}

/**
 * Decides whether a released drag should commit to navigation: either the
 * offset crossed the distance threshold, or it's a decisive flick (enough
 * distance, moving the same direction as the offset, and fast enough).
 * Small offsets never commit, so dragging far and returning to the origin
 * cancels the gesture.
 */
export function shouldCommit(dx: number, velocityX: number, surfaceWidth: number): boolean {
  if (Math.abs(dx) >= surfaceWidth * COMMIT_DISTANCE_RATIO) return true;
  if (Math.abs(dx) < FLICK_MIN_DISTANCE_PX) return false;
  const sameSign = (dx > 0 && velocityX > 0) || (dx < 0 && velocityX < 0);
  return sameSign && Math.abs(velocityX) >= FLICK_MIN_VELOCITY;
}

type Axis = 'horizontal' | 'vertical';

/**
 * Owns touch listeners on a swipe surface, drives an interactive drag/commit
 * animation on a target element via inline styles, and defers the actual
 * navigation + bounds decisions to the supplied callbacks.
 */
export class SwipeNavigator {
  private readonly surface: HTMLElement;
  private readonly target: HTMLElement;
  private readonly canNavigate: (direction: SwipeDirection) => boolean;
  private readonly onNavigate: (direction: SwipeDirection) => void;

  private active = false;
  private animating = false;
  private axis: Axis | null = null;
  private startX = 0;
  private startY = 0;
  private prevX = 0;
  private prevTime = 0;
  private lastDx = 0;
  private velocityX = 0;
  private surfaceWidth = 0;
  private reducedMotion = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionHandler: ((event: TransitionEvent) => void) | null = null;

  constructor(options: SwipeNavigatorOptions) {
    this.surface = options.surface;
    this.target = options.target;
    this.canNavigate = options.canNavigate;
    this.onNavigate = options.onNavigate;

    this.surface.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    this.surface.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.surface.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    this.surface.addEventListener('touchcancel', this.handleTouchEnd, { passive: true });
  }

  destroy(): void {
    this.surface.removeEventListener('touchstart', this.handleTouchStart);
    this.surface.removeEventListener('touchmove', this.handleTouchMove);
    this.surface.removeEventListener('touchend', this.handleTouchEnd);
    this.surface.removeEventListener('touchcancel', this.handleTouchEnd);
    this.clearSettle();
    this.clearTransform();
    this.active = false;
    this.animating = false;
    this.axis = null;
  }

  private readonly handleTouchStart = (e: TouchEvent): void => {
    if (this.animating) return;
    if (e.touches.length > 1) return;
    if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.prevX = touch.clientX;
    this.prevTime = e.timeStamp;
    this.velocityX = 0;
    this.lastDx = 0;
    this.axis = null;
    this.surfaceWidth = this.surface.clientWidth;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.active = true;
  };

  private readonly handleTouchMove = (e: TouchEvent): void => {
    if (!this.active) return;
    if (e.touches.length > 1) {
      this.abandon();
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - this.startX;
    const dy = touch.clientY - this.startY;

    if (this.axis === null) {
      const axis = classifyAxis(dx, dy);
      if (axis === null) return;
      this.axis = axis;
      if (axis === 'vertical') {
        // Let the browser scroll normally; no transforms were ever applied.
        this.active = false;
        return;
      }
    }

    if (this.axis !== 'horizontal') return;

    if (e.cancelable) e.preventDefault();

    const dt = Math.max(1, e.timeStamp - this.prevTime);
    this.velocityX = (touch.clientX - this.prevX) / dt;
    this.prevX = touch.clientX;
    this.prevTime = e.timeStamp;
    this.lastDx = dx;

    if (!this.reducedMotion) {
      const allowed = this.canNavigate(directionForOffset(dx));
      const resisted = applyResistance(dx, allowed);
      this.target.style.transition = 'none';
      this.target.style.transform = `translate3d(${resisted}px, 0, 0)`;
    }
  };

  private readonly handleTouchEnd = (): void => {
    if (!this.active) return;
    this.active = false;

    if (this.axis !== 'horizontal') {
      this.axis = null;
      return;
    }

    const dx = this.lastDx;
    const direction = directionForOffset(dx);
    const commit =
      shouldCommit(dx, this.velocityX, this.surfaceWidth) && this.canNavigate(direction);

    if (this.reducedMotion) {
      this.axis = null;
      if (commit) this.onNavigate(direction);
      return;
    }

    this.animating = true;
    if (commit) {
      this.runCommitAnimation(direction, dx);
    } else {
      this.runSnapBackAnimation();
    }
  };

  private abandon(): void {
    this.active = false;
    if (this.axis === 'horizontal' && !this.reducedMotion) {
      this.animating = true;
      this.runSnapBackAnimation();
    } else {
      this.axis = null;
    }
  }

  private runSnapBackAnimation(): void {
    this.target.style.transition = `transform ${SNAP_BACK_MS}ms ease-out`;
    this.target.style.transform = 'translate3d(0, 0, 0)';
    this.awaitTransitionEnd(() => {
      this.clearTransform();
      this.animating = false;
      this.axis = null;
    });
  }

  private runCommitAnimation(direction: SwipeDirection, dx: number): void {
    const sign = dx < 0 ? -1 : 1;
    const outX = sign * this.surfaceWidth;
    this.target.style.transition = `transform ${COMMIT_OUT_MS}ms ease-out`;
    this.target.style.transform = `translate3d(${outX}px, 0, 0)`;

    this.awaitTransitionEnd(() => {
      this.onNavigate(direction);

      const inStartX = -sign * this.surfaceWidth;
      this.target.style.transition = 'none';
      this.target.style.transform = `translate3d(${inStartX}px, 0, 0)`;
      void this.target.offsetWidth; // force reflow so the jump doesn't animate
      this.target.style.transition = `transform ${COMMIT_IN_MS}ms ease-out`;
      this.target.style.transform = 'translate3d(0, 0, 0)';

      this.awaitTransitionEnd(() => {
        this.clearTransform();
        this.animating = false;
        this.axis = null;
      });
    });
  }

  private awaitTransitionEnd(callback: () => void): void {
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      this.clearSettle();
      callback();
    };
    this.transitionHandler = (event: TransitionEvent): void => {
      if (event.target !== this.target || event.propertyName !== 'transform') return;
      settle();
    };
    this.target.addEventListener('transitionend', this.transitionHandler);
    this.settleTimer = setTimeout(settle, TRANSITION_FALLBACK_MS);
  }

  private clearSettle(): void {
    if (this.transitionHandler) {
      this.target.removeEventListener('transitionend', this.transitionHandler);
      this.transitionHandler = null;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private clearTransform(): void {
    this.target.style.transition = '';
    this.target.style.transform = '';
  }
}
