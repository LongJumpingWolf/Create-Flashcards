import { useEffect, useMemo, useState } from 'react';
import { loadSettings, saveSettings } from '../beerus';
import { decodeSettings, describeSettings, encodeSettings, shareLink } from '../shareSettings';

function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Modal({ title, onClose, children, actions }) {
  useEffect(() => {
    const esc = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="sd-back" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sd" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="sd-body">{children}</div>
        <div className="sd-actions">{actions}</div>
      </div>
    </div>
  );
}

/** A proper confirmation (instead of the browser's plain popup) for actions that cannot be taken back. */
export function ConfirmDialog({ title, children, confirmLabel, danger = true, onConfirm, onCancel, extra }) {
  return (
    <Modal title={title} onClose={onCancel} actions={<>
      {extra}
      <button type="button" className="sd-btn" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className={`sd-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </>}>
      {children}
    </Modal>
  );
}

/** Copy a link / code, download a file, or use the phone's share sheet. */
export function ShareDialog({ settings, onClose }) {
  const { code, droppedImages } = useMemo(() => encodeSettings(settings), [settings]);
  const link = useMemo(() => shareLink(code), [code]);
  const [note, setNote] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setNote(`${what} copied.`); }
    catch { setNote('Copy was blocked. Select the box and press Ctrl+C.'); }
  };
  return (
    <Modal title="Share your settings" onClose={onClose} actions={<button type="button" className="sd-btn primary" onClick={onClose}>Done</button>}>
      <p>Send this link to a friend. When they open it, the site shows what will change and asks before applying anything.</p>
      <input className="sd-field" readOnly value={link} onFocus={e => e.target.select()} aria-label="Share link" />
      <div className="sd-row">
        <button type="button" className="sd-btn primary" onClick={() => copy(link, 'Link')}>Copy link</button>
        <button type="button" className="sd-btn" onClick={() => copy(code, 'Code')}>Copy code</button>
        <button type="button" className="sd-btn" onClick={() => downloadJson(settings, 'beerus-settings.json')}>Download file</button>
        {canShare && <button type="button" className="sd-btn" onClick={() => navigator.share({ title: 'BeeRus settings', text: 'My Anki card look (BeeRus settings)', url: link }).catch(() => {})}>Share…</button>}
      </div>
      {droppedImages > 0 && <p className="sd-warn">{droppedImages} custom image{droppedImages === 1 ? '' : 's'} (pill icon or watermark) cannot fit in a link, so the link uses the default look for {droppedImages === 1 ? 'it' : 'them'}. Use “Download file” to include the pictures.</p>}
      {note && <p className="sd-note" role="status">{note}</p>}
      <p className="sd-small">The link contains only your settings, never your cards.</p>
    </Modal>
  );
}

/** Opened from a share link (#shared=…): shows what would change and applies it only after a yes. */
export function SharedSettingsPrompt({ onDone }) {
  const parsed = useMemo(() => { try { return { settings: decodeSettings(window.location.hash) }; } catch (error) { return { error: error.message || 'The link could not be read.' }; } }, []);
  const clear = () => { history.replaceState(null, '', window.location.pathname + window.location.search); onDone?.(); };
  if (parsed.error) {
    return <Modal title="Settings link" onClose={clear} actions={<button type="button" className="sd-btn primary" onClick={clear}>OK</button>}><p>{parsed.error}</p></Modal>;
  }
  const apply = () => { saveSettings(parsed.settings); history.replaceState(null, '', window.location.pathname + window.location.search); window.location.reload(); };
  return (
    <ConfirmDialog title="Apply shared settings?" confirmLabel="Apply settings" danger={false} onConfirm={apply} onCancel={clear}
      extra={<button type="button" className="sd-btn" onClick={() => downloadJson(loadSettings(), 'my-beerus-settings-backup.json')}>Save mine first</button>}>
      <p>Someone shared their card look with you. Applying it replaces your current settings (your cards are not touched):</p>
      <ul className="sd-list">{describeSettings(parsed.settings).map(line => <li key={line}>{line}</li>)}</ul>
    </ConfirmDialog>
  );
}
