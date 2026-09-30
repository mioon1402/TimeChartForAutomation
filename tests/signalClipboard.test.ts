import { describe, expect, it } from 'vitest';
import { copySignalsText, pasteSignals } from '../src/model/signalClipboard';
import { createProject, sampleProject } from '../src/model/project';

describe('copy and paste signals between charts', () => {
  it('keeps waveforms and the arrows between copied signals', () => {
    const src = sampleProject();
    const ids = src.signals.slice(1, 5).map((s) => s.id);
    const text = copySignalsText(src, ids);
    expect(text).toMatch(/^sig /m);
    const dst = createProject();
    const r = pasteSignals(dst, text)!;
    expect(r.ids).toHaveLength(4);
    const pasted = r.project.signals;
    expect(pasted.map((s) => s.name)).toEqual(src.signals.slice(1, 5).map((s) => s.name));
    expect(pasted.map((s) => s.points.map((p) => p.t))).toEqual(src.signals.slice(1, 5).map((s) => s.points.map((p) => p.t)));
    // 새 id, 화살표는 붙여 넣은 신호끼리 이어진다
    expect(pasted.some((s) => ids.includes(s.id))).toBe(false);
    for (const a of r.project.annotations) if (a.type === 'arrow') expect(r.ids).toContain(a.from.signalId);
    // 차트 길이가 짧으면 늘린다
    expect(r.project.settings.duration).toBeGreaterThanOrEqual(Math.max(...pasted.flatMap((s) => s.points.map((p) => p.t))));
  });

  it('inserts after the selected signal and ignores plain text', () => {
    const dst = sampleProject();
    const text = copySignalsText(dst, [dst.signals[0].id]);
    const r = pasteSignals(dst, text, dst.signals[2].id)!;
    expect(r.project.signals[3].id).toBe(r.ids[0]);
    expect(pasteSignals(dst, '그냥 글자')).toBeNull();
  });
});
