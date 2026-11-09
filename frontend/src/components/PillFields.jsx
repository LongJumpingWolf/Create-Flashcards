import { useEffect, useMemo, useRef, useState } from 'react';
import { PILL_COUNT, gptCss, loadSettings, saveSettings, pillCss, themeMedia, cleanPillHtml } from '../beerus';
import { chatgptFromClipboard } from '../chatgptFormat';
import { sanitizePastedHtml } from './editorHelpers';

const MAX_EDGE = 1100;

// Screenshots are shrunk on paste so a pill never adds megabytes to the deck.
async function shrinkImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size < 250_000 && /image\/(png|jpeg)/.test(file.type)) return null; // keep as is
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;
// The editor shows pills smaller than on the card (the card size is set on the Settings page).
const EDITOR_PILL_STYLE = { '--ics': 1, '--gs': 0.7, fontSize: '12.5px' };
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
      <style>{css}{`.pv-pills .bpill-body { font-size: ${(0.72 * 28).toFixed(1)}px; } .pv-pills .bpill > summary { font-size: ${px.toFixed(1)}px; }`}</style>
      <div id="bpills" className={`pv-pills bs-${settings.pillStyle.style}`} style={{ fontSize: `${px.toFixed(1)}px` }}>
        {shown.map(({ pill, index, html }) => (
          <details key={index} className={`bpill bpill-${index + 1}${pill.format === 'chatgpt' ? ' bpill-gpt' : ''}`} open={pill.open}>
            <summary>
              {settings.pillStyle.showIcons && pill.iconType === 'emoji' && pill.icon ? <span className="bpill-em">{pill.icon}</span> : null}
              {settings.pillStyle.showIcons && (pill.iconType === 'image' || pill.iconType === 'url') ? <span className="bpill-ic" /> : null}
              <span className="bpill-label">{pill.label}</span>
            </summary>
            <div className="bpill-body" dangerouslySetInnerHTML={{ __html: html }} />
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
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null); // index of the pill whose name is being edited
  const [draft, setDraft] = useState('');
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
      if (node && node.innerHTML !== html) node.innerHTML = html;
    });
  }, [values, resetKey, open]);

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

  const set = (index, html) => onChange(values.map((value, i) => (i === index ? html : value)));
  const read = (index) => refs.current[index]?.innerHTML || '';

  const insertImage = async (index, source) => {
    const node = refs.current[index];
    if (!node) return;
    node.insertAdjacentHTML('beforeend', `<img src="${source}">`);
    set(index, node.innerHTML);
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
    const gpt = chatgptFromClipboard({ html, text }, settings.pills[index].format);
    document.execCommand('insertHTML', false, gpt || (html ? sanitizePastedHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')));
    set(index, read(index));
  };

  const filledFlags = values.map(value => cleanPillHtml(value) !== '');
  const filled = filledFlags.filter(Boolean).length;

  return (
    <section className="pill-fields">
      <style>{css}</style>
      <button type="button" className="pill-fields-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>Pills <em>(toggle buttons under the answer)</em></span>
        <small>{filled ? `${filled} on the card` : 'optional'}</small>
      </button>
      {!open && (
        <div className={`pill-onCard bs-${settings.pillStyle.style}`} style={EDITOR_PILL_STYLE} aria-label="Pills that will appear on the card">
          {filled ? settings.pills.map((pill, index) => (filledFlags[index] ? <PillChip key={index} pill={pill} index={index} settings={settings} /> : null)) : <span className="pill-onCard-empty">Nothing here yet. A pill only appears on the card when its field has content.</span>}
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
                      <PillChip pill={pill} index={index} settings={settings} dim={!filledFlags[index]} />
                    </div>
                    <button type="button" className="pill-edit" onClick={() => startRename(index)} aria-label={`Rename pill ${index + 1}`} title="Edit name">✎</button>
                  </div>
                  )}
                  <span className="pill-field-state">{filledFlags[index] ? 'on the card' : 'empty, hidden'}{pill.format !== 'auto' ? ` · ${FORMAT_LABEL[pill.format]}` : ''}</span>
                  <label className="pill-field-btn">Add image<input type="file" accept="image/*" hidden onChange={e => { addFile(index, e.target.files?.[0]); e.target.value = ''; }} /></label>
                  <button type="button" className="pill-field-btn" onClick={() => { const url = window.prompt('Image link (https://…)'); if (url && /^https?:\/\//i.test(url.trim())) insertImage(index, url.trim()); }}>Image link</button>
                  {values[index] && <button type="button" className="pill-field-btn" onClick={() => set(index, '')}>Clear</button>}
                </div>
                <div className="nightMode">
                  <div
                    ref={node => { refs.current[index] = node; }}
                    className="pill-field-box editable-content"
                    contentEditable
                    role="textbox"
                    aria-label={`Pill ${index + 1} content`}
                    data-placeholder="Paste a screenshot, an image link, a ChatGPT answer or type notes…"
                    suppressContentEditableWarning
                    onInput={() => set(index, read(index))}
                    onPaste={event => onPaste(event, index)}
                    onDrop={event => {
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
