export type Speed = 0 | 5 | 20 | 60; // ticks per second; 0 = paused
export const SPEEDS: readonly Speed[] = [0, 5, 20, 60];

const MAX_TICKS_PER_FRAME = 30;

export interface LoopHandle {
  setSpeed(s: Speed): void;
  getSpeed(): Speed;
  dispose(): void;
}

/**
 * Fixed-timestep accumulator. Owns the single requestAnimationFrame loop:
 * runs 0..N sim ticks per frame, then hands the frame to render/UI with the
 * fractional-tick alpha (used for movement interpolation from M4).
 */
export function startLoop(opts: {
  simTick: () => void;
  onFrame: (alpha: number, dtMs: number) => void;
}): LoopHandle {
  let speed: Speed = 5;
  let acc = 0;
  let last = performance.now();
  let raf = 0;

  const frame = (ts: number) => {
    const dt = Math.min(ts - last, 250); // tab-switch clamp
    last = ts;
    acc += (dt / 1000) * speed;
    let ran = 0;
    while (acc >= 1 && ran < MAX_TICKS_PER_FRAME) {
      opts.simTick();
      acc -= 1;
      ran++;
    }
    if (ran >= MAX_TICKS_PER_FRAME) acc = 0; // shed load instead of death-spiraling
    opts.onFrame(Math.min(acc, 1), dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setSpeed: (s) => {
      speed = s;
    },
    getSpeed: () => speed,
    dispose: () => cancelAnimationFrame(raf),
  };
}
