/**
 * 차트 편집기의 신호 복사·붙여넣기 (다른 차트·다른 창·텍스트 탭으로).
 * 클립보드에는 TCT 텍스트로 넣어서 사람이 읽을 수 있고, 텍스트 코드 탭에 그대로 붙여 넣어도 된다.
 */
import type { Annotation, Project } from './types';
import { parseDsl, serializeDsl } from '../io/dsl';
import { uid } from './wave';

/** 고른 신호와 그 신호들끼리의 화살표·치수·메모를 텍스트로 */
export function copySignalsText(p: Project, ids: string[]): string {
  const sel = new Set(ids);
  const signals = p.signals.filter((s) => sel.has(s.id));
  const annotations = p.annotations.filter((a) => {
    if (a.type === 'arrow') return sel.has(a.from.signalId) && sel.has(a.to.signalId);
    if (a.type === 'dimension' || a.type === 'note') return !!a.signalId && sel.has(a.signalId);
    return false;
  });
  return serializeDsl({ ...p, signals, annotations, steps: [], rules: [] });
}

/** 클립보드 글이 신호 텍스트면 지금 차트에 끼워 넣는다 (afterId 뒤, 없으면 맨 끝) */
export function pasteSignals(p: Project, text: string, afterId?: string): { project: Project; ids: string[] } | null {
  if (!/^\s*sig\s/m.test(text)) return null;
  const r = parseDsl(text);
  const incoming = r.project.signals;
  if (!incoming.length) return null;
  const idMap = new Map(incoming.map((s) => [s.id, uid('sig')]));
  const re = (id: string) => idMap.get(id) ?? id;
  const signals = incoming.map((s) => ({ ...s, id: re(s.id) }));
  const annotations: Annotation[] = r.project.annotations.flatMap((a): Annotation[] => {
    if (a.type === 'arrow') return [{ ...a, id: uid('ann'), from: { ...a.from, signalId: re(a.from.signalId) }, to: { ...a.to, signalId: re(a.to.signalId) } }];
    if (a.type === 'dimension' || a.type === 'note') return a.signalId && idMap.has(a.signalId) ? [{ ...a, id: uid('ann'), signalId: re(a.signalId) }] : [];
    return [];
  });
  const at = afterId ? p.signals.findIndex((s) => s.id === afterId) + 1 : p.signals.length;
  const idx = at > 0 ? at : p.signals.length;
  const maxT = Math.max(0, ...signals.flatMap((s) => s.points.map((pt) => pt.t)));
  return {
    project: {
      ...p,
      signals: [...p.signals.slice(0, idx), ...signals, ...p.signals.slice(idx)],
      annotations: [...p.annotations, ...annotations],
      settings: { ...p.settings, duration: Math.max(p.settings.duration, maxT) },
    },
    ids: signals.map((s) => s.id),
  };
}
