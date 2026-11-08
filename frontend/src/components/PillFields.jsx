import { useEffect, useRef, useState } from 'react';
import { PILL_COUNT, loadSettings } from '../beerus';
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

/**
 * The four pill fields of a card (Pill 1..4). Each is a small rich box: paste or drop a screenshot,
 * add an image link, or type notes. Empty pills do not appear on the exported card.
 * `values` is the array of 4 HTML strings; `resetKey` changes whenever a different card is loaded.
 */
export default function PillFields({ values, onChange, resetKey }) {
  const refs = useRef([]);
  const [open, setOpen] = useState(false);
  const labels = loadSettings().pills.map(pill => pill.label);

  // Push external changes (loading / clearing a card) into the editable boxes without fighting the caret.
  useEffect(() => {
    values.forEach((html, index) => {
      const node = refs.current[index];
      if (node && node.innerHTML !== html) node.innerHTML = html;
    });
  }, [values, resetKey, open]);

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
    if (IMAGE_URL.test(text)) {
      event.preventDefault();
      insertImage(index, text);
      return;
    }
    const html = event.clipboardData?.getData('text/html');
    event.preventDefault();
    document.execCommand('insertHTML', false, html ? sanitizePastedHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
    set(index, read(index));
  };

  const filled = values.filter(value => value.replace(/<[^>]*>/g, '').trim() || /<img/i.test(value)).length;

  return (
    <section className="pill-fields">
      <button type="button" className="pill-fields-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>Pills (toggle buttons under the answer)</span>
        <small>{filled ? `${filled} filled` : 'optional'}</small>
      </button>
      {open && (
        <div className="pill-fields-body">
          {Array.from({ length: PILL_COUNT }, (_, index) => (
            <div className="pill-field" key={index}>
              <div className="pill-field-head">
                <strong>{`Pill ${index + 1}`}</strong><span>{labels[index]}</span>
                <label className="pill-field-btn">Add image<input type="file" accept="image/*" hidden onChange={e => { addFile(index, e.target.files?.[0]); e.target.value = ''; }} /></label>
                <button type="button" className="pill-field-btn" onClick={() => { const url = window.prompt('Image link (https://…)'); if (url && /^https?:\/\//i.test(url.trim())) insertImage(index, url.trim()); }}>Image link</button>
                {values[index] && <button type="button" className="pill-field-btn" onClick={() => set(index, '')}>Clear</button>}
              </div>
              <div
                ref={node => { refs.current[index] = node; }}
                className="pill-field-box editable-content"
                contentEditable
                role="textbox"
                aria-label={`Pill ${index + 1} content`}
                data-placeholder="Paste a screenshot, an image link or type notes…"
                suppressContentEditableWarning
                onInput={() => set(index, read(index))}
                onPaste={event => onPaste(event, index)}
                onDrop={event => {
                  const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
                  if (file) { event.preventDefault(); addFile(index, file); }
                }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
