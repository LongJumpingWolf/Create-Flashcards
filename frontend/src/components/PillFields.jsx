import { useEffect, useMemo, useRef, useState } from 'react';
import { PILL_COUNT, gptCss, loadSettings, saveSettings, pillCss, themeMedia, cleanPillHtml, stripThemeColors } from '../beerus';
import { chatgptFromClipboard, chatgptForce, chatgptHtmlToGpt } from '../chatgptFormat';
import { sanitizePastedHtml } from './editorHelpers';
import { shrinkImageFile } from '../imageUtils';

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
  return `${scope} .gpt, ${scope} .gpt *:not(.gpt-badge) { color: ${color} !important; } ${scope} .gpt ul { list-style: disc outside !important; } ${scope} .gpt ol { list-style: decimal outside !important; } ${scope} .gpt li { display: list-item !important; }`;
};
const FORMAT_LABEL = { auto: 'Auto', chatgpt: 'ChatGPT look', plain: 'Plain' };

function PillChip({ pill, index, settings, dim }) {
  const icon = !settings.pillStyle.showIcons || pill.iconType === 'none' ? null
    : pill.iconType === 'emoji' ? (pill.icon ? <span className="bpill-em">{pill.icon}</span> : null)
      : <span className="bpill-ic" />;
  return (
    <div className={`bpill bpill-${index + 1}${pill.format === 'chatgpt' ? ' bpill-gpt' : ''}${dim ? ' pill-chip-dim' : ''}`}>
      <summary>{icon}<span className="bpill-label">{pill.label}</span></summary>
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
export default function PillFields({ values, onChange, resetKey }) {
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

  // Push external changes (loading / clearing a card) into the editable boxes without fighting the caret.
  useEffect(() => {
    values.forEach((html, index) => {
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
    const next = valuesRef.current.map((value, i) => (pendingIndex.current.has(i) ? (refs.current[i]?.innerHTML ?? value) : value));
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
  const editPill = (index) => { setOpen(true); setFocusIndex(index); };

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
    node.innerHTML = (last.before || '') + out;
    set(index, node.innerHTML);
    setNote(prev => ({ ...prev, [index]: 'converted' }));
  };

  // "Reformat": cleans the content that is already in the pill (e.g. pasted with an older version) into the ChatGPT look.
  const reformat = (index) => {
    const node = refs.current[index];
    const out = node && chatgptHtmlToGpt(node.innerHTML);
    if (!out) return;
    node.innerHTML = out;
    set(index, node.innerHTML);
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
      const node = refs.current[index];
      node.insertAdjacentHTML('beforeend', out);
      set(index, node.innerHTML);
      setNote(prev => ({ ...prev, [index]: 'converted' }));
    } catch {
      setNote(prev => ({ ...prev, [index]: 'blocked' }));
    }
  };

  const set = (index, html) => { pendingIndex.current.delete(index); window.clearTimeout(timer.current); onChange(valuesRef.current.map((value, i) => (i === index ? html : value))); };
  const typed = (index) => { pendingIndex.current.add(index); window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 350); };
  const read = (index) => refs.current[index]?.innerHTML || '';

  const insertImage = async (index, source) => {
    const node = refs.current[index];
    if (!node) return;
    node.insertAdjacentHTML('beforeend', `<img src="${source}">`);
    set(index, node.innerHTML);
  };

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

  const filledFlags = values.map(value => cleanPillHtml(value) !== '');
  const filled = filledFlags.filter(Boolean).length;

  return (
    <section className="pill-fields">
      <style>{css}{gptKeepText('.pill-field-box', settings)}</style>
      <button type="button" className="pill-fields-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>Pills <em>(toggle buttons under the answer)</em></span>
        <small>{filled ? `${filled} on the card` : 'optional'}</small>
      </button>
      {!open && (
        <div className={`pill-onCard bs-${settings.pillStyle.style}`} style={EDITOR_PILL_STYLE} aria-label="Pills that will appear on the card">
          {filled ? settings.pills.map((pill, index) => (filledFlags[index] ? <button type="button" key={index} className="pill-chip-btn" onClick={() => editPill(index)} title={`Edit the ${pill.label} pill`} aria-label={`Edit the ${pill.label} pill`}><PillChip pill={pill} index={index} settings={settings} /></button> : null)) : <span className="pill-onCard-empty">Nothing here yet. A pill only appears on the card when its field has content.</span>}
        </div>
      )}
      {open && (
        <div className="pill-fields-body">
          {Array.from({ length: PILL_COUNT }, (_, index) => {
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
                  {values[index] && <button type="button" className="pill-field-btn" onClick={() => reformat(index)} title="Clean up what is already in this pill into the ChatGPT look">Reformat</button>}
                  <button type="button" className="pill-field-btn" onClick={() => pasteAsChatGpt(index)} title="Paste what is on the clipboard as a ChatGPT-look panel">Paste as ChatGPT</button>
                  <label className="pill-field-btn">Add image<input type="file" accept="image/*" hidden onChange={e => { addFile(index, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  <button type="button" className="pill-field-btn" onClick={() => { const url = window.prompt('Image link (https://…)'); if (url && /^https?:\/\//i.test(url.trim())) insertImage(index, url.trim()); }}>Image link</button>
                  {values[index] && <button type="button" className="pill-field-btn" onClick={() => set(index, '')}>Clear</button>}
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
                    onBlur={flush}
                    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') flush(); }}
                    onPaste={event => onPaste(event, index)}
                    data-editor-drop-target={`pill${index + 1}`}
                    onDragOver={event => { if ([...(event.dataTransfer?.types || [])].includes('application/x-anki-study-snippet')) event.preventDefault(); }}
                    onDrop={event => {
                      if (dropSnippet(event, index)) return;
                      const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
                      if (file) { event.preventDefault(); addFile(index, file); }
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
