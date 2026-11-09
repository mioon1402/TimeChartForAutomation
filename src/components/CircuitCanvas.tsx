import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Circuit, Part, Wire, WireColor } from '../circuit/types';
import { autoWireColor } from '../circuit/wires';
import { OPERATOR, partBox, pinPositions, type PaletteItem } from '../circuit/parts';
import { tagKey, type CircuitModel, type CircuitSim } from '../circuit/engine';
import { uid } from '../model/wave';
import { CircuitLayer, circuitBounds, G, PartGlyph, partState, type CircuitColors } from '../render/CircuitSvg';
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
  | { kind: 'op'; tag: string };

const k = (p: Pt) => `${p[0]},${p[1]}`;

/** 고른 부품·선을 옮긴다. 옮긴 부품의 단자에 붙은 선 끝도 따라간다 */
export function moveSelection(c: Circuit, parts: Set<string>, wires: Set<string>, dx: number, dy: number): Circuit {
  if (!dx && !dy) return c;
  const pins = new Set<string>();
  for (const p of c.parts) if (parts.has(p.id)) pinPositions(p).forEach((q) => pins.add(k(q)));
  const sh = (q: Pt): Pt => [q[0] + dx, q[1] + dy];
  return {
    ...c,
    parts: c.parts.map((p) => (parts.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    wires: c.wires.map((w) => {
      if (wires.has(w.id)) return { ...w, a: sh(w.a), b: sh(w.b) };
      const ma = pins.has(k(w.a));
      const mb = pins.has(k(w.b));
      return ma || mb ? { ...w, a: ma ? sh(w.a) : w.a, b: mb ? sh(w.b) : w.b } : w;
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
}

export function CircuitCanvas(props: CanvasProps) {
  const { circuit, model, colors: c, sel, setSel, tool, placing, zoom, sim } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [hoverOp, setHoverOp] = useState(false);
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
      const [a, b, cc, d] = partBox(p);
      if (g[0] >= a - 0.2 && g[0] <= cc + 0.2 && g[1] >= b - 0.2 && g[1] <= d + 0.2) return p;
    }
    return null;
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
    // 단자에서 끌면 선, 몸통에서 끌면 이동
    const pin = hitPin(g);
    if (tool === 'wire' || pin) {
      const from = pin ?? snap(g);
      setD({ kind: 'wire', from, to: from, axis: null });
      return;
    }
    const part = hitPart(g);
    if (part) {
      let parts = sel.parts;
      if (e.shiftKey) parts = parts.includes(part.id) ? parts.filter((x) => x !== part.id) : [...parts, part.id];
      else if (!parts.includes(part.id)) parts = [part.id];
      const next = { parts, wires: e.shiftKey || sel.parts.includes(part.id) ? sel.wires : [] };
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
    if (sim && !d) {
      const p = hitPart(g);
      setHoverOp(!!p && operable(p));
    }
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
    else if (d.kind === 'wirePress') {
      const to = hitPin(g) ?? snap(g);
      if (to[0] !== d.from[0] || to[1] !== d.from[1]) setD({ kind: 'wire', from: d.from, to, axis: Math.abs(g[0] - d.from[0]) >= Math.abs(g[1] - d.from[1]) ? 'h' : 'v' });
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
    }
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
  const cursor = sim ? (hoverOp ? 'pointer' : 'grab') : placing ? 'copy' : tool === 'wire' || pinHot ? 'crosshair' : 'default';

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
        onPointerLeave={() => setHover(null)}
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
        <CircuitLayer circuit={circuit} model={model} c={c} o={{ sim, selected, flagged: props.flagged, showPins: !sim }} />
        {preview && <polyline points={preview.map((p) => `${p[0] * G},${p[1] * G}`).join(' ')} fill="none" stroke={c.accent} strokeWidth={2} strokeDasharray="5 4" />}
        {pinHot && hover && <circle cx={hover[0] * G} cy={hover[1] * G} r={6} fill="none" stroke={c.accent} strokeWidth={1.6} />}
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
