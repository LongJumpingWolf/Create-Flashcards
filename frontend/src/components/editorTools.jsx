// Anki-style editing tools for the card editor: toolbar popovers, per-field header
// controls (collapse / HTML view / pin), math + LaTeX helpers, audio capture,
// paste sanitising and duplicate detection. Kept out of FlashcardEditor.jsx so the
// logic stays testable and the editor file stays readable.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Code, Eye, EyeOff, Pin } from './Icons';
import { HIGHLIGHT_COLORS } from './editorHelpers';

// --- Toolbar popover ---------------------------------------------------------------
export function ToolbarMenu({ icon, title, children, disabled = false, active = false, className = '', onOpen }) {
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
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

  const toggle = () => {
    if (position) { close(); return; }
    onOpen?.();
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)), top: rect.bottom + 6 });
  };

  return (
    <>
      <button ref={buttonRef} type="button" onClick={toggle} disabled={disabled} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={Boolean(position)}
        className={`toolbar-button toolbar-menu-trigger ${active ? 'is-active' : ''} ${className}`}>
        {icon}<ChevronDown size={11} />
      </button>
      {position && <div data-toolbar-menu role="menu" className="toolbar-menu" style={{ left: position.left, top: position.top }} onClick={close}>{children}</div>}
    </>
  );
}

export const MenuItem = ({ icon, children, hint, onClick, disabled }) => (
  <button type="button" role="menuitem" className="toolbar-menu-item" onClick={onClick} disabled={disabled}>
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
