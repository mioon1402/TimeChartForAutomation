import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { formatTime, parseTime } from '../model/format';
import { useStore } from '../store/store';
import { tr } from '../i18n';

// ───────────────────────────── 아이콘 ─────────────────────────────

const PATHS: Record<string, string> = {
  select: 'M5 3l14 8-6 1.5L10 19z',
  pen: 'M4 20h4l10-10-4-4L4 16zM13.5 6.5l4 4',
  arrow: 'M4 18c6 0 8-12 14-12M14 3l4 3-3 4',
  dimension: 'M3 7v10M21 7v10M3 12h18M7 9l-4 3 4 3M17 9l4 3-4 3',
  note: 'M5 4h14v12H9l-4 4z',
  marker: 'M6 21V4M6 4h11l-2 4 2 4H6',
  step: 'M3 18h5v-5h5V8h5V4h3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  zoomIn: 'M11 5a6 6 0 110 12 6 6 0 010-12zM20 20l-4.5-4.5M11 8v6M8 11h6',
  zoomOut: 'M11 5a6 6 0 110 12 6 6 0 010-12zM20 20l-4.5-4.5M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  save: 'M5 3h11l4 4v14H5zM8 3v5h7M8 21v-7h8v7',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0122 12s-1.3 2.3-3.6 4.2M6.3 6.3C3.7 8.1 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1',
  magnet: 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4zM6 8h4M14 8h4',
  moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
  sun: 'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  chart: 'M3 17h4V9h5v6h4V5h5',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  report: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  play: 'M7 4l13 8-13 8z',
  check: 'M4 12l5 5L20 6',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  panel: 'M3 4h18v16H3zM15 4v16',
  bottom: 'M3 4h18v16H3zM3 15h18',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  wand: 'M4 20L16 8M14 4v3M18 6h3M19 11v2M11 3h2',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  globe: 'M12 3a9 9 0 110 18 9 9 0 010-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  help: 'M12 3a9 9 0 110 18 9 9 0 010-18zM9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17v.5',
  ruleCheck: 'M9 11l2 2 4-4M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.help} />
    </svg>
  );
}

// ───────────────────────────── 버튼 / 메뉴 ─────────────────────────────

export function IconButton({ icon, title, onClick, active, disabled, label, className, tour }: { icon: string; title: string; onClick?: () => void; active?: boolean; disabled?: boolean; label?: string; className?: string; tour?: string }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'active' : ''} ${label ? 'with-label' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled} data-tour={tour}>
      <Icon name={icon} />
      {label && <span>{label}</span>}
    </button>
  );
}

export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
  checked?: boolean;
}

export function Menu({ label, items, icon, tour }: { label: string; items: MenuItem[]; icon?: string; tour?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`menu-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} data-tour={tour}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="menu-div" />
            ) : (
              <button
                type="button"
                key={i}
                role="menuitem"
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                <span className="menu-ico">{it.checked ? <Icon name="check" size={14} /> : it.icon ? <Icon name={it.icon} size={14} /> : null}</span>
                <span className="menu-label">{it.label}</span>
                {it.shortcut && <span className="menu-sc">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── 입력 필드 ─────────────────────────────

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** 포커스를 잃거나 Enter 에서 커밋하는 텍스트 입력 */
export function TextInput({ value, onChange, placeholder, mono, onCommitKey, autoFocus, className }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; onCommitKey?: string; autoFocus?: boolean; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onChange(v);
  };
  return (
    <input
      className={`input ${mono ? 'mono' : ''} ${className ?? ''}`}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      data-commit={onCommitKey}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function NumberInput({ value, onChange, min, max, step, placeholder, allowEmpty }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string; allowEmpty?: boolean }) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  useEffect(() => setV(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (v.trim() === '' && allowEmpty) {
      if (value !== undefined) onChange(undefined);
      return;
    }
    let n = Number(v);
    if (!Number.isFinite(n)) {
      setV(value === undefined ? '' : String(value));
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onChange(n);
    else setV(String(n));
  };
  return (
    <input
      className="input num"
      type="number"
      value={v}
      step={step}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 시간 입력: "500", "1.5s", "T#2s" 등 허용, ms 로 저장 */
export function TimeInput({ value, onChange, allowEmpty, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; allowEmpty?: boolean; placeholder?: string }) {
  const unit = useStore((s) => s.project.settings.timeUnit);
  const show = (t: number | undefined) => (t === undefined ? '' : unit === 's' ? formatTime(t, 's').replace(' ', '') : String(Math.round(t * 1000) / 1000));
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (!v.trim()) {
      if (allowEmpty && value !== undefined) onChange(undefined);
      else setV(show(value));
      return;
    }
    const t = parseTime(v, unit === 's' ? 's' : 'ms');
    if (t === null || t < 0) {
      setV(show(value));
      return;
    }
    if (t !== value) onChange(t);
  };
  return (
    <input
      className="input num"
      value={v}
      placeholder={placeholder ?? (unit === 's' ? 's' : 'ms')}
      title={tr('예: 500, 1.5s, T#2s', 'e.g. 500, 1.5s, T#2s')}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export const SWATCHES = ['#2563eb', '#dc2626', '#059669', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#db2777', '#475569', '#65a30d', '#111827', '#0d9488'];

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button type="button" key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <input type="color" className="swatch-custom" value={value} onChange={(e) => onChange(e.target.value)} title={tr('사용자 색상', 'Custom color')} />
    </div>
  );
}

// ───────────────────────────── 모달 / 대화상자 ─────────────────────────────

export function Modal({ title, children, onClose, footer, width }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <IconButton icon="x" title={tr('닫기', 'Close')} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

interface PromptState {
  req: { title: string; label: string; value: string; resolve: (v: string | null) => void; multiline?: boolean; confirm?: boolean; okLabel?: string } | null;
  set(r: PromptState['req']): void;
}
const usePrompt = create<PromptState>((set) => ({ req: null, set: (req) => set({ req }) }));

/** window.prompt 대체 (비동기) */
export function askText(title: string, label: string, value = '', multiline = false): Promise<string | null> {
  return new Promise((resolve) => usePrompt.getState().set({ title, label, value, resolve, multiline }));
}

/** window.confirm 대체 (비동기) - 일부 내장 뷰어는 confirm() 을 막는다 */
export function askConfirm(title: string, message: string, okLabel?: string): Promise<boolean> {
  return new Promise((resolve) => usePrompt.getState().set({ title, label: message, value: '', confirm: true, okLabel, resolve: (v) => resolve(v !== null) }));
}

export function PromptHost() {
  const req = usePrompt((s) => s.req);
  const set = usePrompt((s) => s.set);
  const [v, setV] = useState('');
  useEffect(() => setV(req?.value ?? ''), [req]);
  if (!req) return null;
  const done = (val: string | null) => {
    req.resolve(val);
    set(null);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(null)}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={() => done(null)}>
            {tr('취소', 'Cancel')}
          </button>
          <button type="button" className="btn primary" autoFocus={req.confirm} onClick={() => done(v)}>
            {req.okLabel ?? tr('확인', 'OK')}
          </button>
        </>
      }
    >
      {req.confirm ? (
        <p className="confirm-msg">{req.label}</p>
      ) : (
      <Field label={req.label} wide>
        {req.multiline ? (
          <textarea className="input" rows={4} autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        ) : (
          <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && done(v)} />
        )}
      </Field>
      )}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <Icon name={t.kind === 'ok' ? 'check' : t.kind === 'info' ? 'help' : 'warn'} size={15} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
          <span className="caret">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        {right}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
