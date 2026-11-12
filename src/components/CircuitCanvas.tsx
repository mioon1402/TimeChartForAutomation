import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Circuit, Part, Wire, WireColor } from '../circuit/types';
import { autoWireColor } from '../circuit/wires';
import { busSize, OPERATOR, panelSize, partBox, partPins, partWires, pinPositions, rotate, tbSize, type PaletteItem } from '../circuit/parts';
import { tagKey, type CircuitModel, type CircuitSim } from '../circuit/engine';
import { onWireInterior } from '../circuit/netlist';
import { uid } from '../model/wave';
import { CircuitLayer, circuitBounds, G, PartGlyph, partState, type CircuitColors, type LayerOptions } from '../render/CircuitSvg';
import { tr } from '../i18n';

export interface Sel {
  parts: string[];
  wires: string[];
}

export const NO_SEL: Sel = { parts: [], wires: [] };

type Pt = [number, number];

type Drag =
  | { kind: 'move'; start: Pt; orig: Circuit; parts: Set<string>; wires: Set<string>; dx: number; dy: number; key: string }
  | { kind: 'wire'; from: Pt; to: Pt; axis: 'h' | 'v' | null }
  | { kind: 'box'; from: Pt; to: Pt; base: Sel }
  | { kind: 'pan'; sx: number; sy: number; left: number; top: number }
  /** 선 위를 누름: 끌면 그 점에서 분기 선, 그냥 떼면 선 선택 */
  | { kind: 'wirePress'; wire: string; from: Pt; shift: boolean }
  /** 부스바 막대를 누름: 끌면 그 점에서 분기 선, 그냥 떼면 부스바 선택 */
  | { kind: 'busPress'; part: string; from: Pt; shift: boolean }
  /** 크기 손잡이 (분전반 모서리, 부스바 아래 끝, 단자대 오른쪽 끝) */
  | { kind: 'resize'; id: string; key: string }
  | { kind: 'op'; tag: string };

/** 크기를 끌어 바꿀 수 있는 부품의 손잡이 위치 (부품 기준 좌표, 돌리기 전) */
function resizeHandleLocal(p: Part): Pt | null {
  if (p.type === 'r_panel') return panelSize(p);
  if (p.type === 'r_bus') {
    const { bars, len } = busSize(p);
    return [bars - 1, len + 0.7];
  }
  if (p.type === 'r_tb') return [2 * (tbSize(p) - 1) + 1.6, 0];
  return null;
}

export function resizeHandle(p: Part): Pt | null {
  const l = resizeHandleLocal(p);
  if (!l) return null;
  const [dx, dy] = rotate(l[0], l[1], p.rot);
  return [p.x + dx, p.y + dy];
}

/** 손잡이를 g 로 끌었을 때 바뀌는 값 */
function resizeTo(p: Part, g: Pt): Partial<Part> {
  const back = ((360 - p.rot) % 360) as Part['rot'];
  const [lx, ly] = rotate(g[0] - p.x, g[1] - p.y, back);
  if (p.type === 'r_panel') return { w: Math.max(4, Math.round(lx)), h: Math.max(4, Math.round(ly)) };
  if (p.type === 'r_bus') return { h: Math.max(2, Math.round(ly - 0.7)) };
  if (p.type === 'r_tb') return { n: Math.min(40, Math.max(1, Math.round((lx - 1.6) / 2) + 1)) };
  return {};
}

const k = (p: Pt) => `${p[0]},${p[1]}`;

/** 고른 부품·선을 옮긴다. 옮긴 부품의 단자에 붙은 선 끝도 따라간다 */
export function moveSelection(c: Circuit, parts: Set<string>, wires: Set<string>, dx: number, dy: number): Circuit {
  if (!dx && !dy) return c;
  const pins = new Set<string>();
  for (const p of c.parts) if (parts.has(p.id)) pinPositions(p).forEach((q) => pins.add(k(q)));
  // 부스바를 옮기면 막대에 물린 분기선 끝도 함께. 막대 중간의 탭은 막대와 직각 방향으로만 따라가서
  // 분기선이 비스듬해지지 않는다 (막대를 위아래로 밀어도 탭은 그 자리에 물려 있다)
  const bars = c.parts.filter((p) => parts.has(p.id)).flatMap(partWires);
  const on = (b: Wire, q: Pt) => k(b.a) === k(q) || k(b.b) === k(q) || onWireInterior(b, q[0], q[1]);
  const moved = (b: Wire): Wire => ({ ...b, a: [b.a[0] + dx, b.a[1] + dy], b: [b.b[0] + dx, b.b[1] + dy] });
  const sh = (q: Pt): Pt => [q[0] + dx, q[1] + dy];
  const follow = (q: Pt): Pt | null => {
    if (pins.has(k(q))) return sh(q);
    const bar = bars.find((b) => on(b, q));
    if (!bar) return null;
    const along: Pt = bar.a[0] === bar.b[0] ? [q[0] + dx, q[1]] : [q[0], q[1] + dy];
    return on(moved(bar), along) ? along : sh(q);
  };
  return {
    ...c,
    parts: c.parts.map((p) => (parts.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    wires: c.wires.map((w) => {
      if (wires.has(w.id)) return { ...w, a: sh(w.a), b: sh(w.b) };
      const na = follow(w.a);
      const nb = follow(w.b);
      return na || nb ? { ...w, a: na ?? w.a, b: nb ?? w.b } : w;
    }),
  };
}

/** 두 점 사이에 꺾인 선 (가로→세로 또는 세로→가로), 이미 있는 선은 다시 넣지 않는다 */
export function addWire(c: Circuit, from: Pt, to: Pt, axis: 'h' | 'v' | null, color?: WireColor): Circuit {
  if (from[0] === to[0] && from[1] === to[1]) return c;
  const pts: Pt[] = from[0] === to[0] || from[1] === to[1] ? [from, to] : axis === 'v' ? [from, [from[0], to[1]], to] : [from, [to[0], from[1]], to];
  const wires = [...c.wires];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const dup = wires.some((w) => (k(w.a) === k(a) && k(w.b) === k(b)) || (k(w.a) === k(b) && k(w.b) === k(a)));
    if (!dup) wires.push({ id: uid('cw'), a, b, ...(color ? { color } : {}) });
  }
  return { ...c, wires };
}

function distToWire(w: Wire, x: number, y: number): number {
  const [ax, ay] = w.a;
  const [bx, by] = w.b;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

export interface CanvasProps {
  circuit: Circuit;
  model: CircuitModel;
  colors: CircuitColors;
  sel: Sel;
  setSel: (s: Sel) => void;
  tool: 'select' | 'wire';
  placing: PaletteItem | null;
  onPlace: (item: PaletteItem, x: number, y: number, keep: boolean) => void;
  zoom: number;
  setZoom: (z: number) => void;
  sim: CircuitSim | null;
  /** 시뮬레이션 중 부품 조작 (down: 누름, up: 뗌) */
  onOperate: (tag: string, phase: 'down' | 'up') => void;
  onCommit: (next: Circuit, mergeKey?: string, regen?: boolean) => void;
  onEndMerge: () => void;
  onEditPart: (p: Part) => void;
  flagged: Set<string>;
  ghostPart: (item: PaletteItem, x: number, y: number) => Part;
  /** 바뀌면 회로 전체가 보이게 확대·이동 */
  fitKey: number;
  /** 결선표에서 고른 전선 (강조, 화면 밖이면 그쪽으로 이동) */
  highlight?: LayerOptions['highlight'];
  wireNos?: LayerOptions['wireNos'];
  progress?: LayerOptions['progress'];
  /** 전기 해석 (시뮬레이션 중): 부하 · 차단기의 전류, 전선에 올리면 전류 */
  power?: LayerOptions['power'];
  currents?: LayerOptions['currents'];
  /** 부품 위에 마우스를 잠깐 올리면 보여 줄 정보 (이름 · 종류 · 정격 · 전류) */
  partInfo?: (p: Part) => string[];
}

export function CircuitCanvas(props: CanvasProps) {
  const { circuit, model, colors: c, sel, setSel, tool, placing, zoom, sim } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [hoverOp, setHoverOp] = useState(false);
  const [probe, setProbe] = useState<{ wire: string; at: Pt } | null>(null);
  // 부품 정보 카드: 같은 부품 위에 잠깐 머물면 뜬다 (화면을 줄여서 글자가 작을 때도 읽게)
  const [card, setCard] = useState<{ id: string; at: Pt } | null>(null);
  const cardTimer = useRef<{ id: string; timer: number } | null>(null);
  const hoverCard = (p: Part | null, at: Pt) => {
    if (cardTimer.current && cardTimer.current.id !== p?.id) {
      window.clearTimeout(cardTimer.current.timer);
      cardTimer.current = null;
    }
    if (!p) {
      if (card) setCard(null);
      return;
    }
    if (card?.id === p.id || cardTimer.current) return;
    if (card) setCard(null);
    const id = p.id;
    cardTimer.current = { id, timer: window.setTimeout(() => (setCard({ id, at }), (cardTimer.current = null)), 450) };
  };
  useEffect(() => () => void (cardTimer.current && window.clearTimeout(cardTimer.current.timer)), []);
  // 화면을 줄여도 글자표가 읽히게 (화면에서 0.85 배 아래로는 작아지지 않는다)
  const labelScale = Math.max(1, 0.85 / zoom);
  const zoomAnchor = useRef<{ gx: number; gy: number; cx: number; cy: number } | null>(null);
  const spaceDown = useRef(false);

  const bounds = useMemo(() => {
    const [bx0, by0, bx1, by1] = circuit.parts.length || circuit.wires.length ? circuitBounds(circuit) : [2, 0, 10, 10];
    return [Math.min(-4, Math.floor(bx0) - 6), Math.min(-6, Math.floor(by0) - 6), Math.max(70, Math.ceil(bx1) + 30), Math.max(46, Math.ceil(by1) + 20)] as const;
  }, [circuit]);
  const [x0, y0, x1, y1] = bounds;
  const scale = G * zoom;

  const toGrid = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale + x0, (e.clientY - r.top) / scale + y0];
  };
  const snap = (g: Pt): Pt => [Math.round(g[0]), Math.round(g[1])];

  const hitPin = (g: Pt): Pt | null => {
    let best: Pt | null = null;
    let bd = 0.5;
    for (const p of circuit.parts) {
      for (const q of pinPositions(p)) {
        const d = Math.hypot(q[0] - g[0], q[1] - g[1]);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    }
    return best;
  };
  const hitPart = (g: Pt): Part | null => {
    for (let i = circuit.parts.length - 1; i >= 0; i--) {
      const p = circuit.parts[i];
      if (p.type === 'r_panel' || p.type === 'r_bus') continue;
      const [a, b, cc, d] = partBox(p);
      if (g[0] >= a - 0.2 && g[0] <= cc + 0.2 && g[1] >= b - 0.2 && g[1] <= d + 0.2) return p;
    }
    // 부스바는 막대 위만 잡힌다 (막대 사이 · 위로 지나가는 분기선은 선으로)
    for (let i = circuit.parts.length - 1; i >= 0; i--) {
      const p = circuit.parts[i];
      if (p.type !== 'r_bus') continue;
      const onBar = partWires(p).some((b) => distToWire(b, g[0], g[1]) < 0.3);
      const [a, b, cc, d] = partBox(p);
      // 막대 위 끝의 상 표시 (L1 L2 …) 줄이나 아래 이름표를 잡아도 부스바
      const len = busSize(p).len;
      const inX = g[0] >= a - 0.2 && g[0] <= cc + 0.2;
      const onLabel = p.rot === 0 && inX && ((g[1] >= b - 0.2 && g[1] <= p.y - 0.3) || (g[1] >= p.y + len + 1.1 && g[1] <= d + 0.2));
      if ((onBar && !circuit.wires.some((w) => distToWire(w, g[0], g[1]) < 0.25)) || onLabel) return p;
    }
    // 분전반 테두리는 이름표 줄만 잡힌다 (안쪽은 그림을 그리는 자리)
    for (let i = circuit.parts.length - 1; i >= 0; i--) {
      const p = circuit.parts[i];
      if (p.type !== 'r_panel') continue;
      const [a, b, cc] = partBox(p);
      if (g[0] >= a - 0.2 && g[0] <= cc + 0.2 && g[1] >= b - 0.3 && g[1] <= b + 1.6) return p;
    }
    return null;
  };
  /** 손잡이를 누른 부품: 하나만 골랐을 때 */
  const resizeTarget = (g: Pt): Part | null => {
    if (sel.parts.length !== 1 || sel.wires.length) {
      // 분전반 이름표로 고르면 안의 부품도 함께 골라지므로, 그 안에 분전반이 하나면 그것
      const panels = circuit.parts.filter((p) => sel.parts.includes(p.id) && p.type === 'r_panel');
      if (panels.length !== 1) return null;
      const h = resizeHandle(panels[0])!;
      return Math.hypot(g[0] - h[0], g[1] - h[1]) < 0.7 * Math.max(1, 0.85 / zoom) ? panels[0] : null;
    }
    const p = circuit.parts.find((x) => x.id === sel.parts[0]);
    const h = p && resizeHandle(p);
    return p && h && Math.hypot(g[0] - h[0], g[1] - h[1]) < 0.7 * Math.max(1, 0.85 / zoom) ? p : null;
  };
  /** 분전반 안에 있는 부품과 선 (함께 옮긴다) */
  const panelContents = (p: Part): { parts: string[]; wires: string[] } => {
    const [a, b, cc, d] = partBox(p);
    const inside = (x: number, y: number) => x >= a && x <= cc && y >= b && y <= d;
    return {
      parts: circuit.parts.filter((q) => q.id !== p.id && q.type !== 'r_panel' && inside(q.x, q.y)).map((q) => q.id),
      wires: circuit.wires.filter((w) => inside(...w.a) && inside(...w.b)).map((w) => w.id),
    };
  };
  const hitWire = (g: Pt): Wire | null => {
    let best: Wire | null = null;
    let bd = 0.35;
    for (const w of circuit.wires) {
      const d = distToWire(w, g[0], g[1]);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  };
  const operable = (p: Part) => {
    const kind = model.tagKind.get(tagKey(p));
    return (kind === 'operator' || kind === 'thr') && (OPERATOR.has(p.type) || p.type === 'no' || p.type === 'nc');
  };

  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // 줌: 마우스 아래 점을 그대로 두고 확대
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = wrapRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollLeft = (a.gx - x0) * scale - a.cx;
    el.scrollTop = (a.gy - y0) * scale - a.cy;
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // 화면 맞춤: 회로 전체가 보이는 배율로, 왼쪽 위부터
  const fitRef = useRef(-1);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || fitRef.current === props.fitKey || !circuit.parts.length) return;
    const first = fitRef.current === -1;
    fitRef.current = props.fitKey;
    const [bx0, by0, bx1, by1] = circuitBounds(circuit);
    const z = Math.min(1.6, Math.max(0.3, Math.min((el.clientWidth - 24) / ((bx1 - bx0) * G), (el.clientHeight - 24) / ((by1 - by0) * G))));
    const z2 = first ? Math.min(z, Math.max(zoom, 0.3)) : z;
    zoomAnchor.current = { gx: bx0 - 0.5, gy: by0 - 0.5, cx: 0, cy: 0 };
    if (Math.abs(z2 - zoom) > 1e-3) props.setZoom(z2);
    else {
      el.scrollLeft = (bx0 - 0.5 - x0) * scale;
      el.scrollTop = (by0 - 0.5 - y0) * scale;
      zoomAnchor.current = null;
    }
  }, [props.fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 결선표에서 고른 전선이 화면 밖이면 그쪽으로
  useEffect(() => {
    const el = wrapRef.current;
    const h = props.highlight;
    if (!el || !h?.pts.length) return;
    const xs = [...h.pts, ...h.segs.flat()].map((p) => p[0]);
    const ys = [...h.pts, ...h.segs.flat()].map((p) => p[1]);
    const [ax, bx, ay, by] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v, i) => (v - (i < 2 ? x0 : y0)) * scale);
    const inView = ax >= el.scrollLeft && bx <= el.scrollLeft + el.clientWidth && ay >= el.scrollTop && by <= el.scrollTop + el.clientHeight;
    if (!inView) el.scrollTo({ left: (ax + bx) / 2 - el.clientWidth / 2, top: (ay + by) / 2 - el.clientHeight / 2, behavior: 'smooth' });
  }, [props.highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const g = toGrid(e);
      zoomAnchor.current = { gx: g[0], gy: g[1], cx: e.clientX - r.left, cy: e.clientY - r.top };
      props.setZoom(Math.min(3, Math.max(0.3, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,textarea,select')) spaceDown.current = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const g = toGrid(e);
    hoverCard(null, g);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || spaceDown.current) {
      const el = wrapRef.current!;
      setD({ kind: 'pan', sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop });
      return;
    }
    if (sim) {
      const p = hitPart(g);
      if (p && operable(p)) {
        const tag = tagKey(p);
        props.onOperate(tag, 'down');
        setD({ kind: 'op', tag });
      } else {
        const el = wrapRef.current!;
        setD({ kind: 'pan', sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop });
      }
      return;
    }
    if (placing) {
      const [x, y] = snap(g);
      props.onPlace(placing, x, y, e.shiftKey);
      return;
    }
    // 크기 손잡이 (고른 분전반 · 부스바 · 단자대 하나)
    const rp = resizeTarget(g);
    if (rp) {
      setD({ kind: 'resize', id: rp.id, key: uid('rs') });
      return;
    }
    // 단자에서 끌면 선, 몸통에서 끌면 이동
    const pin = hitPin(g);
    if (tool === 'wire' || pin) {
      const from = pin ?? snap(g);
      setD({ kind: 'wire', from, to: from, axis: null });
      return;
    }
    const part = hitPart(g);
    if (part && part.type === 'r_bus' && !sel.parts.includes(part.id)) {
      setD({ kind: 'busPress', part: part.id, from: snap(g), shift: e.shiftKey });
      return;
    }
    if (part) {
      let parts = sel.parts;
      if (e.shiftKey) parts = parts.includes(part.id) ? parts.filter((x) => x !== part.id) : [...parts, part.id];
      else if (!parts.includes(part.id)) parts = [part.id];
      let next = { parts, wires: e.shiftKey || sel.parts.includes(part.id) ? sel.wires : [] };
      // 분전반 이름표를 잡으면 안의 것도 함께
      if (part.type === 'r_panel' && !e.shiftKey && parts.length === 1) {
        const inner = panelContents(part);
        next = { parts: [part.id, ...inner.parts], wires: inner.wires };
      }
      setSel(next);
      setD({ kind: 'move', start: snap(g), orig: circuit, parts: new Set(next.parts), wires: new Set(next.wires), dx: 0, dy: 0, key: uid('mv') });
      return;
    }
    const w = hitWire(g);
    if (w && !sel.wires.includes(w.id)) {
      setD({ kind: 'wirePress', wire: w.id, from: snap(g), shift: e.shiftKey });
      return;
    }
    if (w) {
      let wires = sel.wires;
      if (e.shiftKey) wires = wires.includes(w.id) ? wires.filter((x) => x !== w.id) : [...wires, w.id];
      else if (!wires.includes(w.id)) wires = [w.id];
      const next = { parts: e.shiftKey || sel.wires.includes(w.id) ? sel.parts : [], wires };
      setSel(next);
      setD({ kind: 'move', start: snap(g), orig: circuit, parts: new Set(next.parts), wires: new Set(next.wires), dx: 0, dy: 0, key: uid('mv') });
      return;
    }
    const base = e.shiftKey ? sel : NO_SEL;
    if (!e.shiftKey) setSel(NO_SEL);
    setD({ kind: 'box', from: g, to: g, base });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = toGrid(e);
    const d = dragRef.current;
    setHover(snap(g));
    if (props.partInfo) hoverCard(d || placing || tool === 'wire' || hitPin(g) ? null : hitPart(g), g);
    if (sim && !d) {
      const p = hitPart(g);
      setHoverOp(!!p && operable(p));
      // 클램프 미터처럼: 전선 위에 올리면 그 선의 전류
      const w = props.power && !(p && p.type !== 'r_panel') ? hitWire(g) : null;
      setProbe(w ? { wire: w.id, at: g } : null);
    } else if (probe) setProbe(null);
    if (!d) return;
    if (d.kind === 'pan') {
      const el = wrapRef.current!;
      el.scrollLeft = d.left - (e.clientX - d.sx);
      el.scrollTop = d.top - (e.clientY - d.sy);
    } else if (d.kind === 'move') {
      const [sx, sy] = snap(g);
      const dx = sx - d.start[0];
      const dy = sy - d.start[1];
      if (dx === d.dx && dy === d.dy) return;
      setD({ ...d, dx, dy });
      props.onCommit(moveSelection(d.orig, d.parts, d.wires, dx, dy), d.key, false);
    } else if (d.kind === 'wire') {
      const to = hitPin(g) ?? snap(g);
      let axis = d.axis;
      if (!axis && (to[0] !== d.from[0] || to[1] !== d.from[1])) axis = Math.abs(g[0] - d.from[0]) >= Math.abs(g[1] - d.from[1]) ? 'h' : 'v';
      if (to[0] === d.from[0] && to[1] === d.from[1]) axis = null;
      setD({ ...d, to, axis });
    } else if (d.kind === 'box') setD({ ...d, to: g });
    else if (d.kind === 'wirePress' || d.kind === 'busPress') {
      const to = hitPin(g) ?? snap(g);
      if (to[0] !== d.from[0] || to[1] !== d.from[1]) setD({ kind: 'wire', from: d.from, to, axis: Math.abs(g[0] - d.from[0]) >= Math.abs(g[1] - d.from[1]) ? 'h' : 'v' });
    } else if (d.kind === 'resize') {
      const p = circuit.parts.find((x) => x.id === d.id);
      if (!p) return;
      const patch = resizeTo(p, g);
      if (Object.entries(patch).some(([key, v]) => p[key as keyof Part] !== v)) props.onCommit({ ...circuit, parts: circuit.parts.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) }, d.key, true);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    setD(null);
    if (!d) return;
    if (d.kind === 'op') props.onOperate(d.tag, 'up');
    else if (d.kind === 'wirePress') {
      const wires = d.shift ? (sel.wires.includes(d.wire) ? sel.wires.filter((x) => x !== d.wire) : [...sel.wires, d.wire]) : [d.wire];
      setSel({ parts: d.shift ? sel.parts : [], wires });
    } else if (d.kind === 'busPress') {
      setSel(d.shift ? { parts: [...sel.parts, d.part], wires: sel.wires } : { parts: [d.part], wires: [] });
    } else if (d.kind === 'resize') props.onEndMerge();
    else if (d.kind === 'move') {
      if (d.dx || d.dy) {
        props.onCommit(moveSelection(d.orig, d.parts, d.wires, d.dx, d.dy), d.key, true);
        props.onEndMerge();
      }
    } else if (d.kind === 'wire') {
      const next = addWire(circuit, d.from, d.to, d.axis, autoWireColor(circuit, model, d.from, d.to));
      if (next !== circuit) props.onCommit(next);
    } else if (d.kind === 'box') {
      const [ax, bx] = [Math.min(d.from[0], d.to[0]), Math.max(d.from[0], d.to[0])];
      const [ay, by] = [Math.min(d.from[1], d.to[1]), Math.max(d.from[1], d.to[1])];
      if (bx - ax < 0.2 && by - ay < 0.2) return;
      const inside = (x: number, y: number) => x >= ax && x <= bx && y >= ay && y <= by;
      const parts = circuit.parts.filter((p) => {
        const [pa, pb, pc, pd] = partBox(p);
        // 분전반 테두리는 통째로 둘러쌌을 때만
        if (p.type === 'r_panel') return pa >= ax && pc <= bx && pb >= ay && pd <= by;
        return pa < bx && pc > ax && pb < by && pd > ay;
      });
      const wires = circuit.wires.filter((w) => inside(...w.a) && inside(...w.b));
      setSel({ parts: [...new Set([...d.base.parts, ...parts.map((p) => p.id)])], wires: [...new Set([...d.base.wires, ...wires.map((w) => w.id)])] });
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (sim || placing) return;
    const p = hitPart(toGrid(e));
    if (p) props.onEditPart(p);
  };

  const selected = useMemo(() => new Set([...sel.parts, ...sel.wires]), [sel]);
  const W = (x1 - x0) * G;
  const H = (y1 - y0) * G;
  const pinHot = !sim && !placing && hover && (tool === 'wire' || circuit.parts.some((p) => pinPositions(p).some((q) => q[0] === hover[0] && q[1] === hover[1])));
  // 단자 위에 마우스를 올리면 어느 기기의 몇 번 단자인지 (MC1 13NO)
  const pinName = useMemo(() => {
    if (sim || placing || !hover) return '';
    for (const p of circuit.parts) {
      const i = pinPositions(p).findIndex((q) => q[0] === hover[0] && q[1] === hover[1]);
      if (i < 0) continue;
      const label = partPins(p)[i]?.label ?? '';
      const dev = p.tag.trim() || (p.type === 'src' || p.type === 'r_term' ? p.pole ?? 'L' : '');
      return [dev, p.type === 'src' || p.type === 'r_term' ? '' : label].filter(Boolean).join(' ');
    }
    return '';
  }, [circuit.parts, hover, sim, placing]);
  const onHandle = !sim && !placing && hover && !drag ? resizeTarget(hover) : null;
  const resizing = drag?.kind === 'resize' ? circuit.parts.find((x) => x.id === drag.id) : null;
  const handlePart = resizing ?? onHandle;
  const resizeCursor = handlePart ? (handlePart.type === 'r_panel' ? 'nwse-resize' : (handlePart.type === 'r_bus') === (handlePart.rot % 180 === 0) ? 'ns-resize' : 'ew-resize') : null;
  const cursor = sim ? (hoverOp ? 'pointer' : 'grab') : resizeCursor ?? (placing ? 'copy' : tool === 'wire' || pinHot ? 'crosshair' : 'default');
  // 고른 분전반 · 부스바 · 단자대의 크기 손잡이
  const handles = sim
    ? []
    : circuit.parts
        .filter((p) => sel.parts.includes(p.id) && (sel.parts.length === 1 ? true : p.type === 'r_panel' && circuit.parts.filter((q) => sel.parts.includes(q.id) && q.type === 'r_panel').length === 1))
        .map((p) => resizeHandle(p))
        .filter((h): h is Pt => !!h);

  let preview: Pt[] | null = null;
  if (drag?.kind === 'wire' && (drag.to[0] !== drag.from[0] || drag.to[1] !== drag.from[1])) {
    const { from, to, axis } = drag;
    preview = from[0] === to[0] || from[1] === to[1] ? [from, to] : axis === 'v' ? [from, [from[0], to[1]], to] : [from, [to[0], from[1]], to];
  }
  const ghost = placing && hover && !sim ? props.ghostPart(placing, hover[0], hover[1]) : null;

  return (
    <div className={`cc-canvas ${sim ? 'running' : ''}`} ref={wrapRef}>
      <svg
        ref={svgRef}
        width={W * zoom}
        height={H * zoom}
        viewBox={`${x0 * G} ${y0 * G} ${W} ${H}`}
        style={{ cursor, background: c.bg, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => (setHover(null), hoverCard(null, toGrid(e)))}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label={tr('회로도 편집 영역', 'Circuit drawing area')}
      >
        <defs>
          <pattern id="cc-grid" width={G} height={G} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={1.1} fill={c.grid} />
          </pattern>
          <pattern id="cc-grid5" width={G * 5} height={G * 5} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={1.8} fill={c.grid} />
          </pattern>
        </defs>
        <rect x={x0 * G} y={y0 * G} width={W} height={H} fill="url(#cc-grid)" />
        <rect x={x0 * G} y={y0 * G} width={W} height={H} fill="url(#cc-grid5)" />
        <CircuitLayer circuit={circuit} model={model} c={c} o={{ sim, selected, flagged: props.flagged, showPins: !sim, highlight: props.highlight, wireNos: props.wireNos, progress: sim ? null : props.progress, power: sim ? props.power : null, currents: props.currents, labelScale }} />
        {sim && probe && props.power && (() => {
          const w = circuit.wires.find((x) => x.id === probe.wire);
          if (!w) return null;
          const i = props.power.wireI.get(w.id) ?? 0;
          const v = props.power.voltAt(w.a[0], w.a[1]);
          const text = `${i >= 100 ? i.toFixed(0) : i.toFixed(2)} A${v !== null ? ` · ${v.toFixed(0)} V` : ''}`;
          const wd = text.length * 7.4 + 34;
          return (
            <g pointerEvents="none" transform={`translate(${probe.at[0] * G + 14 * labelScale},${probe.at[1] * G - 16 * labelScale}) scale(${labelScale})`}>
              <rect x={0} y={-15} width={wd} height={24} rx={6} fill="#111827" stroke="#facc15" strokeWidth={1.6} />
              <path d="M9,-10a6,6 0 1 0 8,0" stroke="#facc15" strokeWidth={2.2} fill="none" />
              <text x={26} y={2} fontSize={12.5} fontWeight={800} fill="#a7f3d0" fontFamily="ui-monospace, monospace">
                {text}
              </text>
            </g>
          );
        })()}
        {preview && <polyline points={preview.map((p) => `${p[0] * G},${p[1] * G}`).join(' ')} fill="none" stroke={c.accent} strokeWidth={2} strokeDasharray="5 4" />}
        {pinHot && hover && <circle cx={hover[0] * G} cy={hover[1] * G} r={6} fill="none" stroke={c.accent} strokeWidth={1.6} />}
        {pinName && hover && (
          <g pointerEvents="none" transform={`translate(${hover[0] * G + 10 * labelScale},${hover[1] * G - 12 * labelScale}) scale(${labelScale})`}>
            <rect x={0} y={-12} width={pinName.length * 7.2 + 12} height={17} rx={4} fill="#111827" opacity={0.92} />
            <text x={6} y={1} fontSize={11} fontWeight={700} fill="#f9fafb" fontFamily="ui-monospace, monospace">
              {pinName}
            </text>
          </g>
        )}
        {card && !probe && props.partInfo && (() => {
          const part = circuit.parts.find((x) => x.id === card.id);
          const lines = part ? props.partInfo(part).filter(Boolean) : [];
          if (!lines.length) return null;
          const width = Math.max(...lines.map((l) => [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 12 : 6.6), 0))) + 20;
          return (
            <g pointerEvents="none" transform={`translate(${card.at[0] * G + 16 * labelScale},${card.at[1] * G + 18 * labelScale}) scale(${labelScale})`}>
              <rect x={0} y={0} width={width} height={lines.length * 17 + 10} rx={6} fill="#111827" opacity={0.95} stroke="#475569" />
              {lines.map((l, i) => (
                <text key={i} x={10} y={19 + i * 17} fontSize={i === 0 ? 12.5 : 11.5} fontWeight={i === 0 ? 800 : 500} fill={i === 0 ? '#f9fafb' : '#cbd5e1'}>
                  {l}
                </text>
              ))}
            </g>
          );
        })()}
        {handles.map(([x, y], i) => {
          const s = 6 * Math.max(1, 0.85 / zoom);
          return <rect key={`h${i}`} x={x * G - s} y={y * G - s} width={2 * s} height={2 * s} rx={2} fill={c.bg} stroke={c.select} strokeWidth={2} pointerEvents="none" />;
        })}
        {ghost && (
          <g transform={`translate(${ghost.x * G},${ghost.y * G})${ghost.rot ? ` rotate(${ghost.rot})` : ''}`} opacity={0.55} fill="none" strokeWidth={1.6} pointerEvents="none">
            <PartGlyph part={ghost} st={partState(ghost, model, null)} c={c} />
          </g>
        )}
        {drag?.kind === 'box' && (
          <rect
            x={Math.min(drag.from[0], drag.to[0]) * G}
            y={Math.min(drag.from[1], drag.to[1]) * G}
            width={Math.abs(drag.to[0] - drag.from[0]) * G}
            height={Math.abs(drag.to[1] - drag.from[1]) * G}
            fill={c.accent}
            fillOpacity={0.08}
            stroke={c.accent}
            strokeDasharray="4 3"
          />
        )}
      </svg>
    </div>
  );
}
