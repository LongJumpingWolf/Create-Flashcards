import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PILLS, PILL_COUNT, addPillToSettings, removeLastPillFromSettings, gptCss, loadSettings, saveSettings, pillCss, themeMedia, cleanPillHtml, stripThemeColors } from '../beerus';
import { chatgptFromClipboard, chatgptForce, chatgptHtmlToGpt } from '../chatgptFormat';
import { sanitizePastedHtml } from './editorHelpers';
import { shrinkImageFile } from '../imageUtils';
import { Pin } from './Icons';
import { setActionLabel } from '../fieldHistory';

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;
// The editor shows pills smaller than on the card (the card size is set on the Settings page).
const EDITOR_PILL_STYLE = { '--ics': 1, '--gs': 0.7, fontSize: '12.5px' };
// The editor's own stylesheet sets text colours on everything inside previews; keep the ChatGPT panel's text colour intact.
const gptKeepText = (scope, settings) => {
  const color = settings.chatgpt.day.text;
  // Text you colour with the toolbar (inline colour) keeps its colour; everything else stays the panel's text colour.
  const plain = ':not(.gpt-badge):not([class*="gpt-c-"]):not([color]):not([style*="color:"]):not([color] *):not([style*="color:"] *)';
  return `${scope} .gpt, ${scope} .gpt *${plain} { color: ${color} !important; } ${scope} .gpt ul { list-style: disc outside !important; } ${scope} .gpt ol { list-style: decimal outside !important; } ${scope} .gpt li { display: list-item !important; }`;
};
const FORMAT_LABEL = { auto: 'Auto', chatgpt: 'ChatGPT look', plain: 'Plain' };

function PillChip({ pill, index, settings, dim, compact }) {
  const icon = !settings.pillStyle.showIcons || pill.iconType === 'none' ? null
    : pill.iconType === 'emoji' ? (pill.icon ? <span className="bpill-em">{pill.icon}</span> : null)
      : <span className="bpill-ic" />;
  return (
    <div className={`bpill bpill-${index + 1}${pill.format === 'chatgpt' ? ' bpill-gpt' : ''}${dim ? ' pill-chip-dim' : ''}`}>
      <summary>{icon}{(!compact || !icon) && <span className="bpill-label">{compact ? pill.label.slice(0, 1) : pill.label}</span>}</summary>
    </div>
  );
}

/** The pills of a card exactly as the exported card shows them (answer side): only filled pills, real style, real content. */
export function PreviewPills({ pills, night }) {
  const settings = useMemo(() => loadSettings(), []);
  const css = useMemo(() => {
    let text = pillCss(settings) + gptCss(settings);
    themeMedia(settings).forEach(file => { text = text.split(file.name).join(file.dataUrl); });
    return text;
  }, [settings]);
  const shown = settings.pills.map((pill, index) => ({ pill, index, html: pills?.[index] || '' })).filter(item => cleanPillHtml(item.html) !== '');
  if (!shown.length) return null;
  const px = 0.6 * (settings.pillStyle.scale / 100) * 28;
  return (
    <div className={night ? 'nightMode' : ''}>
      <style>{css}{gptKeepText('.pv-pills', settings)}{`.pv-pills .bpill > summary { font-size: ${px.toFixed(1)}px; }`}</style>
      <div id="bpills" className={`pv-pills bs-${settings.pillStyle.style}`} style={{ fontSize: `${px.toFixed(1)}px` }}>
        {shown.map(({ pill, index, html }) => (
          <details key={index} className={`bpill bpill-${index + 1}${pill.format === 'chatgpt' || /^\s*<div class="gpt"/.test(html) ? ' bpill-gpt' : ''}`} open={pill.open}>
            <summary>
              {settings.pillStyle.showIcons && pill.iconType === 'emoji' && pill.icon ? <span className="bpill-em">{pill.icon}</span> : null}
              {settings.pillStyle.showIcons && (pill.iconType === 'image' || pill.iconType === 'url') ? <span className="bpill-ic" /> : null}
              <span className="bpill-label">{pill.label}</span>
            </summary>
            <div className="bpill-body" dangerouslySetInnerHTML={{ __html: stripThemeColors(html) }} />
          </details>
        ))}
      </div>
    </div>
  );
}

/**
 * The four pill fields of a card (Pill 1..4). Each field is headed by the real pill (exactly the button that will appear
 * on the card); a pill whose field is empty is dimmed and does not appear on the card at all.
 * Paste a screenshot, drop an image, add an image link, or paste a ChatGPT answer (formatting is kept).
 * `values` is the array of 4 HTML strings; `resetKey` changes whenever a different card is loaded.
 */
export default function PillFields({ values, onChange, resetKey, collapseKey = 0, pinned = {}, onTogglePin, onFocusBox, onSaveRange }) {
  const refs = useRef([]);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const timer = useRef(null);
  const pendingIndex = useRef(new Set());
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(null); // a pill chip was clicked: open its editing field and put the cursor in it
  const [renaming, setRenaming] = useState(null); // index of the pill whose name is being edited
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState({}); // per pill: what the last paste did
  const lastPaste = useRef({});
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => { setSettings(loadSettings()); }, [open, resetKey]); // pick up changes made on the Settings page
  const css = useMemo(() => {
    let text = pillCss(settings) + gptCss(settings);
    themeMedia(settings).forEach(file => { text = text.split(file.name).join(file.dataUrl); });
    return text;
  }, [settings]);
  const count = settings.pills.length;
  const pad = (list, size = count) => Array.from({ length: size }, (_, i) => list?.[i] ?? '');
  const lastRange = useRef({}); // last cursor position inside each pill box (kept when the toolbar or a button takes focus)

  // Push external changes (loading / clearing a card) into the editable boxes without fighting the caret.
  useEffect(() => {
    pad(values).forEach((html, index) => {
      const node = refs.current[index];
      if (!node || pendingIndex.current.has(index)) return; // typing in progress: the box is newer than the saved value
      if (node.innerHTML !== html) node.innerHTML = html;
    });
  }, [values, resetKey, open]);

  // Typing is sent to the editor in one go after a short pause (re-drawing the whole editor on every key made big
  // ChatGPT pills laggy). It is also sent on blur, Ctrl/Cmd+Enter and unmount, so nothing is ever lost.
  const flush = () => {
    window.clearTimeout(timer.current);
    if (!pendingIndex.current.size) return;
    const next = pad(valuesRef.current).map((value, i) => (pendingIndex.current.has(i) ? (refs.current[i]?.innerHTML ?? value) : value));
    pendingIndex.current.clear();
    onChange(next);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  useEffect(() => { pendingIndex.current.clear(); window.clearTimeout(timer.current); }, [resetKey]);

  useEffect(() => {
    if (focusIndex === null || !open) return undefined;
    const timer = window.setTimeout(() => {
      const node = refs.current[focusIndex];
      if (node) {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.focus({ preventScroll: true });
        const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }
      setFocusIndex(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusIndex, open]);
  useEffect(() => { if (collapseKey) { setOpen(false); setFocusIndex(null); } }, [collapseKey]);
  const editPill = (index) => { setOpen(true); setFocusIndex(index); };
  const addPill = () => {
    const next = addPillToSettings();
    if (!next) return;
    setSettings(next);
    onChange(pad(valuesRef.current, next.pills.length));
    editPill(next.pills.length - 1);
  };
  const removeLastPill = () => {
    if (!window.confirm('Remove the last pill? Cards that have content in it will lose that content on the next export.')) return;
    const next = removeLastPillFromSettings();
    if (!next) return;
    setSettings(next);
    onChange(pad(valuesRef.current, next.pills.length));
  };

  // Renaming applies to every card of the deck (the label is part of the exported note type) and is saved in Settings.
  const startRename = (index) => { setDraft(settings.pills[index].label); setRenaming(index); };
  const commitRename = () => {
    if (renaming === null) return;
    const label = draft.trim().slice(0, 24);
    if (label && label !== settings.pills[renaming].label) {
      const next = loadSettings();
      next.pills[renaming].label = label;
      saveSettings(next);
      setSettings(next);
    }
    setRenaming(null);
  };

  // "Convert anyway": redo the last paste in this pill as ChatGPT look, whatever the clipboard looked like.
  const convertLast = (index) => {
    const last = lastPaste.current[index];
    const out = last && chatgptForce(last);
    if (!out) return;
    const node = refs.current[index];
    replaceHtml(index, (last.before || '') + out);
    setNote(prev => ({ ...prev, [index]: 'converted' }));
  };

  // "Reformat": cleans the content that is already in the pill (e.g. pasted with an older version) into the ChatGPT look.
  const reformat = (index) => {
    const node = refs.current[index];
    const out = node && chatgptHtmlToGpt(node.innerHTML);
    if (!out) return;
    replaceHtml(index, out);
    setNote(prev => ({ ...prev, [index]: 'converted' }));
  };

  // "Paste as ChatGPT": reads the clipboard directly (the browser asks permission once).
  const pasteAsChatGpt = async (index) => {
    try {
      const items = await navigator.clipboard.read();
      let html = '';
      let text = '';
      for (const item of items) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      const out = chatgptForce({ html, text });
      if (!out) { setNote(prev => ({ ...prev, [index]: 'empty' })); return; }
      lastPaste.current[index] = { html, text, before: read(index) };
      insertHtml(index, out, true);
      setNote(prev => ({ ...prev, [index]: 'converted' }));
    } catch {
      setNote(prev => ({ ...prev, [index]: 'blocked' }));
    }
  };

  const set = (index, html) => { pendingIndex.current.delete(index); window.clearTimeout(timer.current); onChange(pad(valuesRef.current).map((value, i) => (i === index ? html : value))); };
  const typed = (index) => { pendingIndex.current.add(index); window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 350); };
  const read = (index) => refs.current[index]?.innerHTML || '';

  const saveRange = (index) => {
    const node = refs.current[index];
    const selection = window.getSelection();
    if (node && selection.rangeCount && node.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0).cloneRange();
      lastRange.current[index] = range;
      onSaveRange?.(range);
    }
  };
  // Inserting through execCommand (not innerHTML) keeps Ctrl+Z / Ctrl+Y working for the insertion; it goes where the cursor is
  // (inside a ChatGPT panel too), or at the end when the cursor was not in the box.
  const insertHtml = (index, html, atEnd = false) => {
    const node = refs.current[index];
    if (!node) return;
    const selection = window.getSelection();
    let range = null;
    if (!atEnd) {
      if (selection.rangeCount && node.contains(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange();
      else if (lastRange.current[index] && node.contains(lastRange.current[index].commonAncestorContainer)) range = lastRange.current[index];
    }
    if (!range) { range = document.createRange(); range.selectNodeContents(node); range.collapse(false); }
    node.focus({ preventScroll: true });
    selection.removeAllRanges(); selection.addRange(range);
    setActionLabel(/<img/i.test(html) ? 'Image' : 'Insert');
    document.execCommand('insertHTML', false, html);
    set(index, node.innerHTML);
  };
  const replaceHtml = (index, html) => {
    const node = refs.current[index];
    if (!node) return;
    node.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    setActionLabel('Reformat');
    document.execCommand('insertHTML', false, html);
    set(index, node.innerHTML);
  };
  const insertImage = async (index, source) => { insertHtml(index, `<img src="${source}">`); };

  // Snips dragged from the PDF panel: open the pills as drop targets as soon as a drag starts.
  useEffect(() => {
    const onStart = (event) => { if ([...(event.dataTransfer?.types || [])].includes('application/x-anki-study-snippet')) setOpen(true); };
    window.addEventListener('dragstart', onStart);
    return () => window.removeEventListener('dragstart', onStart);
  }, []);
  const dropSnippet = (event, index) => {
    const payload = event.dataTransfer?.getData('application/x-anki-study-snippet');
    if (!payload) return false;
    event.preventDefault(); event.stopPropagation();
    try { insertImage(index, JSON.parse(payload).image); } catch { /* unreadable capture */ }
    return true;
  };

  const addFile = async (index, file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const shrunk = await shrinkImageFile(file);
      await insertImage(index, shrunk || await readAsDataUrl(file));
    } catch { /* unreadable image: ignore */ }
  };

  const onPaste = (event, index) => {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      addFile(index, files[0]);
      return;
    }
    const text = event.clipboardData?.getData('text/plain')?.trim() || '';
    const html = event.clipboardData?.getData('text/html');
    if (IMAGE_URL.test(text)) {
      event.preventDefault();
      insertImage(index, text);
      return;
    }
    event.preventDefault();
    lastPaste.current[index] = { html, text, before: read(index) };
    const gpt = chatgptFromClipboard({ html, text }, settings.pills[index].format);
    document.execCommand('insertHTML', false, gpt || (html ? sanitizePastedHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')));
    set(index, read(index));
    setNote(prev => ({ ...prev, [index]: gpt ? 'converted' : (html || text.length > 40 ? 'plain' : null) }));
  };

  const filledFlags = pad(values).map(value => cleanPillHtml(value) !== '');
  const filled = filledFlags.filter(Boolean).length;

  return (
    <section className="pill-fields">
      <style>{css}{gptKeepText('.pill-field-box', settings)}</style>
      <button type="button" className="pill-fields-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>Pills <em>(toggle buttons under the answer)</em></span>
        <small>{filled ? `${filled} on the card` : 'optional'}</small>
      </button>
      {!open && (
        <div className={`pill-onCard pill-icons bs-${settings.pillStyle.style}`} style={{ '--ics': 1, '--gs': 0.62, fontSize: '11px' }} aria-label="Pills: click one to write its content">
          {settings.pills.map((pill, index) => (
            <button type="button" key={index} className={`pill-ic-btn${filledFlags[index] ? ' is-filled' : ''}`} onClick={() => editPill(index)} title={`${pill.label}${filledFlags[index] ? ' (on the card)' : ' (empty): click to write'}`} aria-label={`Edit the ${pill.label} pill`}><PillChip pill={pill} index={index} settings={settings} compact /></button>
          ))}
          {count < MAX_PILLS && <button type="button" className="pill-add-btn" onClick={addPill} title="Add another pill" aria-label="Add another pill">+</button>}
        </div>
      )}
      {open && (
        <div className="pill-fields-body">
          {Array.from({ length: count }, (_, index) => {
            const pill = settings.pills[index];
            return (
              <div className={`pill-field${filledFlags[index] ? '' : ' pill-field-empty'}`} key={index}>
                <div className="pill-field-head">
                  {renaming === index ? (
                    <input className="pill-rename" autoFocus value={draft} maxLength={24} aria-label={`Name of pill ${index + 1}`} onChange={e => setDraft(e.target.value)} onBlur={commitRename} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} />
                  ) : (
                  <div className="pill-head-wrap">
                    <div className={`pill-head-chip bs-${settings.pillStyle.style}`} style={EDITOR_PILL_STYLE}>
                      <button type="button" className="pill-chip-btn" onClick={() => refs.current[index]?.focus()} title={`Edit the ${pill.label} pill`} aria-label={`Edit the ${pill.label} pill`}><PillChip pill={pill} index={index} settings={settings} dim={!filledFlags[index]} /></button>
                    </div>
                    <button type="button" className="pill-edit" onClick={() => startRename(index)} aria-label={`Rename pill ${index + 1}`} title="Edit name">✎</button>
                  </div>
                  )}
                  <span className="pill-field-state">{filledFlags[index] ? 'on the card' : 'empty, hidden'}{pill.format !== 'auto' ? ` · ${FORMAT_LABEL[pill.format]}` : ''}</span>
                  <button type="button" className={`pill-field-btn pill-pin${pinned[`pill${index + 1}`] ? ' is-on' : ''}`} onClick={() => onTogglePin?.(index)} aria-pressed={Boolean(pinned[`pill${index + 1}`])} title={pinned[`pill${index + 1}`] ? 'Pinned: this pill keeps its content after you add a card' : 'Pin pill: keep its content after adding a card'}><Pin size={13} /></button>
                  {values[index] && <button type="button" className="pill-field-btn" onClick={() => reformat(index)} title="Clean up what is already in this pill into the ChatGPT look">Reformat</button>}
                  <button type="button" className="pill-field-btn" onClick={() => pasteAsChatGpt(index)} title="Paste what is on the clipboard as a ChatGPT-look panel">Paste as ChatGPT</button>
                  <label className="pill-field-btn">Add image<input type="file" accept="image/*" hidden onChange={e => { addFile(index, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  <button type="button" className="pill-field-btn" onClick={() => { const url = window.prompt('Image link (https://…)'); if (url && /^https?:\/\//i.test(url.trim())) insertImage(index, url.trim()); }}>Image link</button>
                  {values[index] && <button type="button" className="pill-field-btn" onClick={() => set(index, '')}>Clear</button>}
                  {index >= PILL_COUNT && index === count - 1 && <button type="button" className="pill-field-btn" onClick={removeLastPill} title="Remove this pill">Remove pill</button>}
                </div>
                {note[index] && (
                  <div className={`pill-note pill-note-${note[index]}`} role="status">
                    {note[index] === 'converted' && 'Converted to the ChatGPT look.'}
                    {note[index] === 'plain' && <>Kept as plain formatting. <button type="button" onClick={() => convertLast(index)}>Convert to ChatGPT look</button></>}
                    {note[index] === 'blocked' && 'The browser did not allow reading the clipboard. Allow it in the address bar, or paste with Ctrl+V.'}
                    {note[index] === 'empty' && 'Nothing to paste: the clipboard is empty.'}
                  </div>
                )}
                <div>
                  <div
                    ref={node => { refs.current[index] = node; }}
                    className="pill-field-box editable-content"
                    contentEditable
                    role="textbox"
                    aria-label={`Pill ${index + 1} content`}
                    data-placeholder="Paste a screenshot, an image link, a ChatGPT answer or type notes…"
                    suppressContentEditableWarning
                    onInput={() => typed(index)}
                    onFocus={() => onFocusBox?.(refs.current[index], () => set(index, refs.current[index]?.innerHTML || ''))}
                    onBlur={() => { saveRange(index); flush(); }}
                    onKeyUp={() => saveRange(index)}
                    onMouseUp={() => saveRange(index)}
                    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') flush(); }}
                    onPaste={event => onPaste(event, index)}
                    data-editor-drop-target={`pill${index + 1}`}
                    onDragOver={event => { if ([...(event.dataTransfer?.types || [])].includes('application/x-anki-study-snippet')) event.preventDefault(); }}
                    onDrop={event => {
                      const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
                      if (at && refs.current[index]?.contains(at.startContainer)) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(at); lastRange.current[index] = at.cloneRange(); }
                      if (dropSnippet(event, index)) return;
                      const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
                      if (file) { event.preventDefault(); addFile(index, file); }
                    }}
                  />
                </div>
              </div>
            );
          })}
          {count < MAX_PILLS && <button type="button" className="pill-add-row" onClick={addPill}>+ Add another pill</button>}
        </div>
      )}
    </section>
  );
}
