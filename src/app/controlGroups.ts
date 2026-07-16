import type { GameState } from '../sim/state';
import type { InputHandle } from './input';

/**
 * Control groups (M11): Ctrl+1..9 banks the currently selected armies under a
 * digit; a bare digit recalls them; a quick double-tap also centers the
 * camera on the group. Presentation-only state — groups are not saved, and
 * they hold ARMIES (soldier box-selections are not bankable this milestone).
 */

const DOUBLE_TAP_MS = 350;

export interface ControlGroupsHandle {
  dispose(): void;
}

export function createControlGroups(deps: {
  state: GameState;
  input: InputHandle;
  jumpTo: (x: number, z: number) => void;
}): ControlGroupsHandle {
  const groups = new Map<number, number[]>();
  let lastDigit = -1;
  let lastAt = 0;

  const onKeyDown = (ev: KeyboardEvent) => {
    const m = /^Digit([1-9])$/.exec(ev.code);
    if (!m) return;
    if (ev.altKey) return;
    const digit = Number(m[1]);

    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault(); // keep the browser off Ctrl+digit where it lets us
      const ids = [...deps.input.selection];
      if (ids.length === 0) groups.delete(digit);
      else groups.set(digit, ids);
      return;
    }

    const banked = groups.get(digit);
    if (!banked) return;
    // the dead answer no muster — prune to living player armies
    const alive = banked.filter((id) => deps.state.armies.some((a) => a.id === id && a.ownerRealm === 0));
    groups.set(digit, alive);
    if (alive.length === 0) return;
    deps.input.selectArmies(alive);

    const now = performance.now();
    if (digit === lastDigit && now - lastAt < DOUBLE_TAP_MS) {
      let cx = 0;
      let cz = 0;
      let n = 0;
      for (const a of deps.state.armies) {
        if (!alive.includes(a.id)) continue;
        cx += a.x;
        cz += a.z;
        n++;
      }
      if (n > 0) deps.jumpTo(cx / n, cz / n);
    }
    lastDigit = digit;
    lastAt = now;
  };

  window.addEventListener('keydown', onKeyDown);
  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
