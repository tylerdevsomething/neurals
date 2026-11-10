// Shared layout pieces for the v2 layout preview: pop-up, tabs, a fold-out question.
import { useEffect, useState, type ReactNode , useRef } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head menu-head"><span>{title}</span><button type="button" className="menu-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2 L10 10 M10 2 L2 10" /></svg></button></div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, on, set }: { tabs: [T, string][]; on: T; set: (t: T) => void }) {
  return (
    <div className="toggle" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={on === k} className={on === k ? 'on' : ''} onClick={() => set(k)}>{label}</button>)}
    </div>
  );
}

export function Fold({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fold ${open ? 'open' : ''}`}>
      <button className="fold-q" onClick={() => setOpen(!open)}><span>{q}</span><b>{open ? '−' : '+'}</b></button>
      {open && <div className="fold-a">{children}</div>}
    </div>
  );
}

/** Sequents-style page head: title and one line on the left, the headline numbers in a box on the right. */
export function PageHead({ title, sub, stats }: { title: ReactNode; sub?: ReactNode; stats?: [ReactNode, string][] }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted page-sub">{sub}</p>}
      </div>
      {stats && stats.length > 0 && (
        <div className="stat-box">
          {stats.map(([v, l]) => <div key={l}><strong>{v}</strong><span className="muted">{l}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Tabs that sit on top of a panel, as on Sequents. */
export function PanelTabs<T extends string>({ tabs, on, set }: { tabs: [T, string][]; on: T; set: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={on === k} className={on === k ? 'tab on' : 'tab'} onClick={() => set(k)}>{label}</button>)}
    </div>
  );
}

/** Any whole-page wait: the word sits dead centre of the main area and only the dots after it count up, so nothing shifts. */
export function Loading({ text = 'Loading' }: { text?: string }) {
  return <p className="muted page-loading" style={{ width: `${text.length + 3}ch` }}>{text}<span className="dots" /></p>;
}

/** Our own dropdown: the closed box matches the inputs, and the open list is drawn by us (a native select opens in the system's style). */
export function Dropdown({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: ([string, string] | [string, string, string])[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', off); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', esc); };
  }, []);
  const cur = options.find(([v]) => v === value) ?? options[0], current = cur?.[1];
  const icon = (svg?: string) => (svg ? <i className="dd-ic" dangerouslySetInnerHTML={{ __html: svg }} /> : null);
  return (
    <div className={`dd ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="dd-box" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="dd-cur">{icon(cur?.[2])}{current}</span>
        <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 4.5 L6 8 L9.5 4.5" /></svg>
      </button>
      {open && (
        <ul className="dd-list" role="listbox">
          {options.map(([v, n, svg]) => <li key={v} role="option" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => { onChange(v); setOpen(false); }}>{icon(svg)}{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A neuron count drawn as small neuron heads, one per neuron, the last one cut to its fraction (3.33 shows three and a third). */
export function NeuronCount({ n, max = 12 }: { n: number; max?: number }) {
  const full = Math.floor(n + 1e-9), frac = n - full, shown = Math.min(full, max);
  const head = '<svg viewBox="0 0 16 16" width="14" height="14"><g stroke="#111111" stroke-width="0.8" fill="#ff3fa4"><path d="M8 8 L3.2 3.6 M8 8 L12.6 3.4 M8 8 L8 2.2 M8 8 L2.6 9.4 M8 8 L13.2 10" stroke-width="2.6" stroke="#111111" stroke-linecap="round"/><path d="M8 8 L3.2 3.6 M8 8 L12.6 3.4 M8 8 L8 2.2 M8 8 L2.6 9.4 M8 8 L13.2 10" stroke-width="1.4" stroke="#ff3fa4" stroke-linecap="round"/><circle cx="3.2" cy="3.6" r="1.4"/><circle cx="12.6" cy="3.4" r="1.4"/><circle cx="8" cy="2.2" r="1.4"/><circle cx="2.6" cy="9.4" r="1.4"/><circle cx="13.2" cy="10" r="1.4"/><circle cx="8" cy="8" r="3.2"/></g><circle cx="8" cy="8" r="1" fill="#ffffff"/></svg>';
  return (
    <span className="ncount" title={`${n} neurons`}>
      {Array.from({ length: shown }, (_, i) => <i key={i} dangerouslySetInnerHTML={{ __html: head }} />)}
      {full < max && frac > 0.005 && <i className="ncount-part" style={{ width: `${Math.round(frac * 14)}px` }} dangerouslySetInnerHTML={{ __html: head }} />}
      {full > max && <b>+{full - max}</b>}
      <span className="ncount-n">{Number.isInteger(n) ? n : n.toFixed(2)}</span>
    </span>
  );
}
