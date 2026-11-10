/** Host-owned clock: hidden time never advances a scene or its return sequence. */
export function createSceneClock() {
  let visible = false, previous: number | null = null, time = 0, pending = 0, force = true;
  return {
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value; previous = null; pending = 0; force = true;
    },
    frame(now: number, reducedMotion = false): { time: number; delta: number } | null {
      if (!visible || !Number.isFinite(now)) return null;
      const delta = previous === null ? 0 : Math.max(0, Math.min(.05, (now - previous) / 1000));
      previous = now; time += delta * 1000; pending += delta;
      if (!force && reducedMotion && pending < .1 - 1e-8) return null;
      force = false; const result = { time, delta: pending }; pending = 0; return result;
    },
    getState: () => ({ visible, time, pending }),
  };
}
