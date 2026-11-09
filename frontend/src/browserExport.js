// Browser glue for the local .apkg builder: SQLite (WASM) loader, image shrinking
// and file download. Loaded lazily so it costs nothing until the first export.
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { buildApkg } from './apkgBuilder';
import { normalizeSettings } from './beerus';

const SHRINK_ABOVE_BYTES = 500 * 1024;
// Set per export from the settings page (Export section).
let MAX_IMAGE_EDGE = 2000;
let JPEG_QUALITY = 0.86;

let sqlPromise = null;
const loadSql = () => {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl }).catch(error => { sqlPromise = null; throw error; });
  return sqlPromise;
};

const isTouchDevice = () => (navigator.maxTouchPoints || 0) > 0 && window.matchMedia?.('(pointer: coarse)').matches;

async function decodeImage(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch { /* fall through to <img> decoding */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasToBytes = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (!blob) { reject(new Error('Could not encode image')); return; }
    blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
  }, type, quality);
});

// Keeps cards sharp but stops multi-megabyte photos from bloating the deck (and
// from exhausting memory on phones). Small images pass through untouched.
async function prepareImage(bytes, mime, { forOcclusion }) {
  const type = mime.toLowerCase();
  const passthrough = type === 'image/svg+xml' || type === 'image/gif';
  if (passthrough && !forOcclusion) return { bytes, mime };

  const decoded = await decodeImage(bytes, mime);
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error('Image has no size');
    const longEdge = Math.max(width, height);
    const keepOriginal = bytes.length <= SHRINK_ABOVE_BYTES && longEdge <= MAX_IMAGE_EDGE
      && (!forOcclusion || type === 'image/png' || type === 'image/jpeg');
    if (keepOriginal) return { bytes, mime, width, height };

    const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outWidth, outHeight);
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, outWidth, outHeight);

    const small = bytes.length <= SHRINK_ABOVE_BYTES && scale === 1;
    const asPng = small; // small non-PNG/JPEG sources (webp, bmp) become lossless PNG
    const encoded = await canvasToBytes(canvas, asPng ? 'image/png' : 'image/jpeg', JPEG_QUALITY);
    canvas.width = 0; canvas.height = 0;
    if (!asPng && scale === 1 && encoded.length >= bytes.length && (type === 'image/png' || type === 'image/jpeg')) {
      return { bytes, mime, width, height };
    }
    return asPng
      ? { bytes: encoded, mime: 'image/png', ext: 'png', width: outWidth, height: outHeight }
      : { bytes: encoded, mime: 'image/jpeg', ext: 'jpg', width: outWidth, height: outHeight };
  } finally {
    decoded.release();
  }
}

// Pasted ChatGPT / web images: the picture host sends no CORS headers, so the site downloads them for us (/api/proxy-image).
async function fetchRemoteImage(url) {
  const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!mime.startsWith('image/')) throw new Error('not an image');
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime };
}

const safeFilename = (name) => name.trim().replace(/[^a-z0-9\s_-]/gi, '').replace(/\s+/g, '_').toLowerCase() || 'anki_deck';

const triggerDownload = (bytes, filename) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Builds the deck entirely on this device and downloads it.
 * Very large decks are split into several .apkg files that share one deck id and
 * name, so Anki merges them back into a single deck on import.
 */
export async function exportDeckLocally(payload, { onProgress } = {}) {
  const settings = normalizeSettings(payload.settings);
  MAX_IMAGE_EDGE = settings.export.maxImageEdge;
  JPEG_QUALITY = settings.export.jpegQuality;
  const result = await buildApkg(payload, {
    settings,
    initSql: loadSql,
    prepareImage,
    fetchRemoteImage,
    maxPartBytes: (isTouchDevice() ? 60 : 200) * 1024 * 1024,
    onProgress,
  });
  const base = safeFilename(payload.deck_name);
  const total = result.parts.length;
  for (let index = 0; index < total; index += 1) {
    const filename = total === 1 ? `${base}.apkg` : `${base}_part${index + 1}_of_${total}.apkg`;
    triggerDownload(result.parts[index], filename);
    if (index < total - 1) await new Promise(resolve => setTimeout(resolve, 700));
  }
  return { parts: total, noteCount: result.noteCount, cardCount: result.cardCount, warnings: result.warnings };
}

export { CardError } from './apkgBuilder';
