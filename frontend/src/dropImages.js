// Dropping a picture from another page or app into any editable field of the editor.
// Browsers drop "picture + a link to it + the link as text"; this keeps the picture and discards the link that came with it.
const IMAGE_URL = /^(data:image\/|https?:\/\/[^\s]+?\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?[^\s]*)?$)/i;

function caretAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const imageTag = (src) => `<img src="${escapeAttr(src)}" alt="" style="max-width:100%;height:auto;">`;

/** What the drop carries: the pictures, plus any real text that came with them (links to the pictures removed). */
export function readDroppedImages(dataTransfer) {
  const html = dataTransfer.getData('text/html');
  const plain = (dataTransfer.getData('text/plain') || '').trim();
  const uriLines = (dataTransfer.getData('text/uri-list') || '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const sources = [];
  let text = '';
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img').forEach(img => { const src = img.getAttribute('src'); if (src && !sources.includes(src)) sources.push(src); });
    const hrefs = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    // links that wrap a picture, or point at a picture file, are not wanted; links with real words are kept as text
    doc.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (a.querySelector('img') || IMAGE_URL.test(href) || sources.includes(href) || hrefs.length && a.textContent.trim() === href) a.remove();
    });
    doc.querySelectorAll('img, script, style').forEach(node => node.remove());
    text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    if (sources.includes(text) || IMAGE_URL.test(text) || uriLines.includes(text)) text = '';
  }
  if (!sources.length) {
    const url = [...uriLines, plain].find(line => IMAGE_URL.test(line));
    if (url) sources.push(url);
  }
  return { sources, text };
}

export function installImageDrop() {
  const onDragOver = (event) => {
    if (event.defaultPrevented) return;
    const editable = event.target?.closest?.('[contenteditable="true"], [contenteditable=""]');
    if (editable && [...(event.dataTransfer?.types || [])].some(type => type === 'Files' || type === 'text/html' || type === 'text/uri-list')) event.preventDefault();
  };
  const onDrop = (event) => {
    if (event.defaultPrevented) return; // a field with its own handler (card front/back, occlusion) already dealt with it
    const editable = event.target?.closest?.('[contenteditable="true"], [contenteditable=""]');
    const dt = event.dataTransfer;
    if (!editable || !dt) return;
    const files = [...(dt.files || [])].filter(file => file.type.startsWith('image/'));
    const { sources, text } = readDroppedImages(dt);
    if (!files.length && !sources.length) return; // plain text: let the browser drop it
    event.preventDefault();
    const range = caretAt(event.clientX, event.clientY);
    editable.focus();
    if (range && editable.contains(range.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const finish = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
    const insert = (html) => { document.execCommand('insertHTML', false, html); finish(); };
    if (files.length) {
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = () => insert(imageTag(reader.result));
        reader.readAsDataURL(file);
      });
    } else {
      insert(sources.map(imageTag).join('') + (text ? `<br>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}` : ''));
    }
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); };
}
