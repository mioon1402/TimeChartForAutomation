import { describe, expect, it } from 'vitest';
import { tourSteps, type TourId } from '../src/components/Tour';
import { useStore } from '../src/store/store';

describe('tutorials', () => {
  for (const id of ['basic', 'plc'] as TourId[]) {
    it(`${id}: every step explains itself and every task can complete`, () => {
      const steps = tourSteps(id);
      expect(steps.length).toBeGreaterThan(5);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(10);
        if (s.task) expect(s.done).toBeTypeOf('function');
      }
    });
  }

  it('advances when the user does the task', () => {
    const steps = tourSteps('basic');
    const drawTool = steps.find((s) => s.target === '[data-tour="tool-draw"]')!;
    const before = useStore.getState();
    useStore.getState().setTool('select');
    expect(drawTool.done!(useStore.getState(), before)).toBe(false);
    useStore.getState().setTool('draw');
    expect(drawTool.done!(useStore.getState(), before)).toBe(true);
    const add = steps.find((s) => s.target === '[data-tour="add-signal"]')!;
    const start = useStore.getState();
    useStore.getState().addSignal();
    expect(add.done!(useStore.getState(), start)).toBe(true);
  });
});
