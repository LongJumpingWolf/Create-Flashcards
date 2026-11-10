// Anki-style editing tools for the card editor: toolbar popovers, per-field header
// controls (collapse / HTML view / pin), math + LaTeX helpers, audio capture,
// paste sanitising and duplicate detection. Kept out of FlashcardEditor.jsx so the
// logic stays testable and the editor file stays readable.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Code, Eye, EyeOff, Pin } from './Icons';
import { HIGHLIGHT_COLORS } from './editorHelpers';

// --- Toolbar popover ---------------------------------------------------------------
export function ToolbarMenu({ icon, title, children, disabled = false, active = false, className = '', onOpen }) {
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const close = useCallback(() => setPosition(null), []);

  useEffect(() => {
    if (!position) return undefined;
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || event.target.closest?.('[data-toolbar-menu]')) return;
      close();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [position, close]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - position.anchorBottom - margin;
    const above = position.anchorTop - margin;
    let top = position.anchorBottom + 6;
    let maxHeight = Math.max(160, below - 6);
    if (height > below && above > below) { maxHeight = Math.max(160, above - 6); top = Math.max(margin, position.anchorTop - 6 - Math.min(height, maxHeight)); }
    const left = Math.max(margin, Math.min(position.left, window.innerWidth - width - margin));
    if (top !== position.top || left !== position.left || maxHeight !== position.maxHeight) setPosition(current => (current ? { ...current, top, left, maxHeight } : current));
  }, [position]);

  const toggle = () => {
    if (position) { close(); return; }
    onOpen?.();
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 6, anchorTop: rect.top, anchorBottom: rect.bottom, maxHeight: window.innerHeight - rect.bottom - 14 });
  };

  return (
    <>
      <button ref={buttonRef} type="button" onClick={toggle} disabled={disabled} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={Boolean(position)}
        className={`toolbar-button toolbar-menu-trigger ${active ? 'is-active' : ''} ${className}`}>
        {icon}<ChevronDown size={11} />
      </button>
      {position && createPortal(<div ref={menuRef} data-toolbar-menu role="menu" className="toolbar-menu" style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }} onClick={close}>{children}</div>, document.body)}
    </>
  );
}

export const MenuItem = ({ icon, children, hint, onClick, disabled, danger = false }) => (
  <button type="button" role="menuitem" className={`toolbar-menu-item ${danger ? 'is-danger' : ''}`} onClick={onClick} disabled={disabled}>
    <span className="toolbar-menu-icon">{icon}</span><span className="toolbar-menu-label">{children}</span>{hint && <kbd>{hint}</kbd>}
  </button>
);


export function HighlightSwatches({ onPick, onClear }) {
  return (
    <div className="toolbar-swatches">
      {HIGHLIGHT_COLORS.map(color => <button key={color} type="button" className="toolbar-swatch" style={{ backgroundColor: color }} title={`Highlight ${color}`} aria-label={`Highlight ${color}`} onClick={() => onPick(color)} />)}
      <button type="button" className="toolbar-swatch toolbar-swatch-clear" title="Remove highlight" aria-label="Remove highlight" onClick={onClear}>×</button>
    </div>
  );
}

// --- Field header (Anki's collapse / HTML / pin icons) --------------------------------
export function FieldHeader({ title, collapsed, onCollapse, htmlOpen, onHtml, pinned, onPin, hideHtml = false }) {
  return (
    <div className="field-header">
      <h3 className="text-sm font-medium block">{title}</h3>
      <div className="field-header-tools" onPointerDown={event => event.preventDefault()}>
        <button type="button" className={`field-tool ${collapsed ? 'is-on' : ''}`} onClick={onCollapse} title={collapsed ? 'Expand field' : 'Collapse field'} aria-pressed={collapsed}>{collapsed ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        {!hideHtml && <button type="button" className={`field-tool ${htmlOpen ? 'is-on' : ''}`} onClick={onHtml} title="Edit HTML (Ctrl+Shift+X)" aria-pressed={htmlOpen}><Code size={15} /></button>}
        <button type="button" className={`field-tool field-pin ${pinned ? 'is-on' : ''}`} onClick={onPin} title={pinned ? 'Pinned: this field keeps its content after you add a card' : 'Pin field: keep its content after adding a card'} aria-pressed={pinned}><Pin size={15} /></button>
      </div>
    </div>
  );
}

export function HtmlView({ field, value, onChange, label }) {
  return (
    <textarea className="field-html-view" data-html-field={field} spellCheck={false} aria-label={label} value={value} onChange={event => onChange(event.target.value)} rows={Math.min(14, Math.max(5, value.split('\n').length + 1))} />
  );
}

// Hover grid for choosing a table size (like Word / Docs).
export function TableGridPicker({ onPick, max = 6 }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  return (
    <div className="table-picker">
      <div className="table-picker-grid" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
        {Array.from({ length: max * max }, (_, index) => {
          const row = Math.floor(index / max) + 1;
          const col = (index % max) + 1;
          const on = row <= hover.rows && col <= hover.cols;
          return <button key={index} type="button" className={`table-picker-cell ${on ? 'is-on' : ''}`} aria-label={`${row} rows by ${col} columns`} onMouseEnter={() => setHover({ rows: row, cols: col })} onFocus={() => setHover({ rows: row, cols: col })} onClick={() => onPick(row, col)} />;
        })}
      </div>
      <div className="table-picker-label">{hover.rows ? `${hover.rows} × ${hover.cols} table` : 'Choose a size'}</div>
    </div>
  );
}


// --- Word-style colour button: click applies the last colour, the arrow opens the palette ------------
const THEME_BASE = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];
const STANDARD_COLORS = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
const HIGHLIGHTS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0', '#000000'];
const mixHex = (hex, target, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.round(c + (target - c) * amount));
  return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};
// Word's palette: the base row, then 80% / 60% / 40% lighter and 25% / 50% darker for every column
const WHITE_COL = ['#FFFFFF', '#F2F2F2', '#D8D8D8', '#BFBFBF', '#A5A5A5', '#7F7F7F'];
const BLACK_COL = ['#000000', '#7F7F7F', '#595959', '#3F3F3F', '#262626', '#0C0C0C'];
const themeRows = () => [0, 1, 2, 3, 4, 5].map(r => THEME_BASE.map((c, i) => (r === 0 ? c : i === 0 ? WHITE_COL[r] : i === 1 ? BLACK_COL[r] : r <= 3 ? mixHex(c, 255, [0.8, 0.6, 0.4][r - 1]) : mixHex(c, 0, [0.25, 0.5][r - 4]))));
const readStore = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } };
const writeStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

export function WordColorTool({ kind = 'text', icon, onApply, onClear }) {
  const highlight = kind === 'highlight';
  const lastKey = `beerus-last-${kind}-color`;
  const [last, setLast] = useState(() => readStore(lastKey, highlight ? '#FFFF00' : '#C00000'));
  const [recent, setRecent] = useState(() => readStore('beerus-recent-colors', []));
  const [position, setPosition] = useState(null);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);
  const pickerRef = useRef(null);
  const close = useCallback(() => setPosition(null), []);

  useEffect(() => {
    if (!position) return undefined;
    const onDown = (event) => { if (anchorRef.current?.contains(event.target) || event.target.closest?.('[data-wc-menu]')) return; close(); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); };
  }, [position, close]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const below = window.innerHeight - position.anchorBottom - 14;
    let top = position.anchorBottom + 6;
    if (height > below && position.anchorTop > below) top = Math.max(8, position.anchorTop - 6 - height);
    const left = Math.max(8, Math.min(position.left, window.innerWidth - width - 8));
    if (top !== position.top || left !== position.left) setPosition(current => (current ? { ...current, top, left } : current));
  }, [position]);

  const choose = (color) => {
    setLast(color); writeStore(lastKey, color);
    const next = [color, ...recent.filter(c => c.toLowerCase() !== color.toLowerCase())].slice(0, 10);
    setRecent(next); writeStore('beerus-recent-colors', next);
    onApply(color);
  };
  const open = () => {
    if (position) { close(); return; }
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 6, anchorTop: rect.top, anchorBottom: rect.bottom });
  };
  const label = highlight ? 'Text Highlight Color' : 'Font Color';
  const swatch = (color, key) => <button key={key} type="button" className="wc-cell" style={{ backgroundColor: color }} title={color} aria-label={color} onClick={() => choose(color)} />;

  return (
    <span className="wc" ref={anchorRef} style={{ '--wc': last }}>
      <button type="button" className="toolbar-button wc-main" title={`${label} (${last})`} aria-label={label} onClick={() => choose(last)}>
        {icon || <span className="wc-a">A</span>}
        <span className="wc-bar" />
      </button>
      <button type="button" className="toolbar-button wc-drop" title={`${label} palette`} aria-label={`${label} palette`} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={open}><ChevronDown size={11} /></button>
      <input ref={pickerRef} type="color" className="wc-native" tabIndex={-1} aria-hidden="true" value={/^#[0-9a-f]{6}$/i.test(last) ? last : '#000000'} onChange={event => choose(event.target.value.toUpperCase())} />
      {position && createPortal(
        <div ref={menuRef} data-wc-menu role="menu" className="toolbar-menu wc-menu" style={{ left: position.left, top: position.top }}>
          <button type="button" className="wc-auto" onClick={() => { onClear(); close(); }}><span className="wc-auto-chip" style={{ background: highlight ? 'transparent' : 'currentColor' }} />{highlight ? 'No Color' : 'Automatic'}</button>
          {highlight ? (
            <>
              <div className="wc-title">Highlight Colors</div>
              <div className="wc-grid wc-grid-5">{HIGHLIGHTS.map((c, i) => <button key={c} type="button" className="wc-cell wc-cell-big" style={{ backgroundColor: c }} title={c} aria-label={`Highlight ${c}`} onClick={() => { choose(c); close(); }} />)}</div>
            </>
          ) : (
            <>
              <div className="wc-title">Theme Colors</div>
              <div className="wc-grid">{themeRows().flat().map((c, i) => <button key={`t${i}`} type="button" className="wc-cell" style={{ backgroundColor: c }} title={c} aria-label={c} onClick={() => { choose(c); close(); }} />)}</div>
              <div className="wc-title">Standard Colors</div>
              <div className="wc-grid">{STANDARD_COLORS.map((c, i) => <button key={`s${i}`} type="button" className="wc-cell" style={{ backgroundColor: c }} title={c} aria-label={c} onClick={() => { choose(c); close(); }} />)}</div>
            </>
          )}
          {recent.length > 0 && <><div className="wc-title">Recent Colors</div><div className="wc-grid">{recent.map((c, i) => <button key={`r${i}`} type="button" className="wc-cell" style={{ backgroundColor: c }} title={c} aria-label={c} onClick={() => { choose(c); close(); }} />)}</div></>}
          <button type="button" className="wc-more" onClick={() => { close(); window.setTimeout(() => pickerRef.current?.click(), 0); }}><span className="wc-more-chip" />More Colors…</button>
        </div>, document.body)}
    </span>
  );
}
