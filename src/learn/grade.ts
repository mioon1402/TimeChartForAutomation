/**
 * 연습 문제 채점: 사용자가 그린 파형을 정답과 신호별로 비교한다.
 * - 처음 값(0초의 ON/OFF), 바뀌는 횟수, 바뀌는 시각(허용 오차 안)을 차례로 본다.
 * - 실린더 경사(ramp)는 보지 않고, 바뀌기 시작한 시각만 본다.
 */
import type { Project, Signal } from '../model/types';
import { effectivePoints } from '../model/wave';

export interface GradeItem {
  key: string;
  name: string;
  ok: boolean;
  message: string;
}

export interface GradeResult {
  items: GradeItem[];
  correct: number;
  total: number;
}

/** 신호를 찾는 열쇠: 주소가 있으면 주소, 없으면 이름 */
export function sigKey(s: Pick<Signal, 'address' | 'name'>): string {
  return s.address || s.name;
}

interface Level {
  initial: 0 | 1;
  edges: { t: number; v: 0 | 1 }[];
}

/** 차트 끝 가까이(눈금 한 칸 안)의 변화는 "끝까지 켜져 있음"을 그리다 생긴 것이므로 보지 않는다 */
function levels(sig: Signal, duration: number, tol: number): Level {
  const pts = effectivePoints(sig, duration).filter((p) => p.t < duration - tol - 1e-6 || p.t === 0);
  const bit = (v: unknown): 0 | 1 => (v === 1 || v === '1' ? 1 : 0);
  const initial = bit(pts[0]?.v ?? 0);
  const edges: Level['edges'] = [];
  let cur = initial;
  for (const p of pts.slice(1)) {
    const v = bit(p.v);
    if (v === cur) continue;
    // 아주 짧은 흔들림(같은 시각에 되돌아감)은 하나로
    const last = edges[edges.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-6) edges.pop();
    else edges.push({ t: p.t, v });
    cur = v;
  }
  return { initial, edges };
}

const onOff = (v: 0 | 1) => (v ? 'ON' : 'OFF');
/** 1500 → "1.5초" */
const sec = (t: number) => `${Math.round(t / 10) / 100}초`;

export function gradeSignal(user: Signal | undefined, answer: Signal, duration: number, tol: number): GradeItem {
  const key = sigKey(answer);
  const name = answer.address ? `${answer.address} ${answer.name}` : answer.name;
  if (!user) return { key, name, ok: false, message: '이 신호 줄이 없습니다. 지웠다면 "처음부터 다시"를 누르세요.' };
  const a = levels(answer, duration, tol);
  const u = levels(user, duration, tol);
  if (a.initial !== u.initial) return { key, name, ok: false, message: `시작할 때(0초) ${onOff(a.initial)} 이어야 합니다. 지금은 ${onOff(u.initial)} 입니다.` };
  if (a.edges.length !== u.edges.length) {
    const onA = a.edges.filter((e) => e.v === 1).length + (a.initial ? 1 : 0);
    const onU = u.edges.filter((e) => e.v === 1).length + (u.initial ? 1 : 0);
    if (!u.edges.length && a.edges.length) return { key, name, ok: false, message: '아직 그리지 않았습니다.' };
    if (onA !== onU) return { key, name, ok: false, message: `ON 구간이 ${onA}번 있어야 하는데 ${onU}번 그렸습니다.` };
    return { key, name, ok: false, message: `켜지고 꺼지는 횟수가 다릅니다 (정답 ${a.edges.length}번, 그린 것 ${u.edges.length}번).` };
  }
  for (let i = 0; i < a.edges.length; i++) {
    const ea = a.edges[i];
    const eu = u.edges[i];
    if (Math.abs(ea.t - eu.t) > tol + 1e-6) {
      return { key, name, ok: false, message: `${sec(ea.t)}에 ${onOff(ea.v)} 되어야 하는데 ${sec(eu.t)}에 ${onOff(eu.v)} 되었습니다.` };
    }
  }
  return { key, name, ok: true, message: a.edges.length ? `정답입니다. 바뀌는 ${a.edges.length}곳 모두 맞습니다.` : '정답입니다. 계속 그대로입니다.' };
}

/** 그려야 할 신호(draw) 전체 채점. 허용 오차 tol(ms) 기본은 눈금 한 칸 */
export function gradeChart(user: Project, answer: Project, draw: string[], tol = answer.settings.grid): GradeResult {
  const duration = answer.settings.duration;
  const items = draw
    .map((k) => answer.signals.find((s) => sigKey(s) === k))
    .filter((s): s is Signal => !!s)
    .map((ans) => gradeSignal(user.signals.find((s) => sigKey(s) === sigKey(ans)), ans, duration, tol));
  return { items, correct: items.filter((i) => i.ok).length, total: items.length };
}
