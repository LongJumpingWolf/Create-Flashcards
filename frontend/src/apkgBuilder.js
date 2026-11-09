// In-browser Anki package (.apkg) builder.
//
// A faithful port of the Python backend (genanki + the Image Occlusion Enhanced
// note layout) so decks of any size can be exported without uploading anything.
// The environment specific parts (SQLite loader, image shrinking) are injected,
// which keeps this module testable in Node and byte-for-byte comparable with the
// backend output.
import { zipSync } from 'fflate';
import { buildModels, normalizeSettings, normalizePills, themeMedia } from './beerus.js';
import { isProxyableImageUrl } from './imageHosts.js';

// Problems with the user's card content (as opposed to browser/runtime failures).
export class CardError extends Error {}

const FIELD_SEPARATOR = '\x1f';
const MAX_DECK_NAME = 100;

// Note types (BeeRus) are built from the user's settings in beerus.js.

const LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
const LATEX_POST = '\\end{document}';

// --- SQLite schema (identical to genanki) --------------------------------------
const APKG_SCHEMA = `
CREATE TABLE col (
    id              integer primary key,
    crt             integer not null,
    mod             integer not null,
    scm             integer not null,
    ver             integer not null,
    dty             integer not null,
    usn             integer not null,
    ls              integer not null,
    conf            text not null,
    models          text not null,
    decks           text not null,
    dconf           text not null,
    tags            text not null
);
CREATE TABLE notes (
    id              integer primary key,
    guid            text not null,
    mid             integer not null,
    mod             integer not null,
    usn             integer not null,
    tags            text not null,
    flds            text not null,
    sfld            integer not null,
    csum            integer not null,
    flags           integer not null,
    data            text not null
);
CREATE TABLE cards (
    id              integer primary key,
    nid             integer not null,
    did             integer not null,
    ord             integer not null,
    mod             integer not null,
    usn             integer not null,
    type            integer not null,
    queue           integer not null,
    due             integer not null,
    ivl             integer not null,
    factor          integer not null,
    reps            integer not null,
    lapses          integer not null,
    left            integer not null,
    odue            integer not null,
    odid            integer not null,
    flags           integer not null,
    data            text not null
);
CREATE TABLE revlog (
    id              integer primary key,
    cid             integer not null,
    usn             integer not null,
    ease            integer not null,
    ivl             integer not null,
    lastIvl         integer not null,
    factor          integer not null,
    time            integer not null,
    type            integer not null
);
CREATE TABLE graves (
    usn             integer not null,
    oid             integer not null,
    type            integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const COL_CONF = {
  activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: '1425279151691',
  dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: 1, sortBackwards: false,
  sortType: 'noteFld', timeLim: 0,
};
const COL_DECKS_DEFAULT = {
  1: {
    collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 10, extendRev: 50, id: 1,
    lrnToday: [0, 0], mod: 1425279151, name: 'Default', newToday: [0, 0], revToday: [0, 0],
    timeToday: [0, 0], usn: 0,
  },
};
const COL_DCONF = {
  1: {
    autoplay: true, id: 1,
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    maxTaken: 60, mod: 0, name: 'Default',
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    replayq: true,
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
    timer: 0, usn: 0,
  },
};

// --- Small utilities -----------------------------------------------------------
const encoder = new TextEncoder();
const utf8 = (text) => encoder.encode(text);

export function randomHex(bytes) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomInt(min, max) {
  const data = new Uint32Array(1);
  crypto.getRandomValues(data);
  return min + (data[0] % (max - min + 1));
}

export function uuidHex() {
  return randomHex(16);
}

export function htmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Synchronous SHA-256 (crypto.subtle is unavailable on plain-http pages, e.g. a
// dev server opened from a phone). Only used to derive stable note GUIDs.
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(message) {
  const bytes = message instanceof Uint8Array ? message : utf8(message);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotr = (value, amount) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA_K[index] + words[index]) >>> 0;
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  hash.forEach((word, index) => outView.setUint32(index * 4, word));
  return out;
}

const BASE91_TABLE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

// Same GUID scheme as genanki, so re-importing an unchanged deck updates notes
// instead of duplicating them.
export function guidFor(...values) {
  const digest = sha256(values.map(String).join('__'));
  let hashInt = 0n;
  for (let index = 0; index < 8; index += 1) hashInt = (hashInt << 8n) | BigInt(digest[index]);
  const base = BigInt(BASE91_TABLE.length);
  const reversed = [];
  while (hashInt > 0n) {
    reversed.push(BASE91_TABLE[Number(hashInt % base)]);
    hashInt /= base;
  }
  return reversed.reverse().join('');
}

export function cleanTags(tags) {
  return (tags || []).filter(tag => tag && String(tag).trim()).map(tag => String(tag).trim().replace(/\s+/g, '_'));
}

// --- Embedded <img src="data:..."> extraction ----------------------------------
const EMBEDDED_IMAGE = /<img[^>]+src="data:(image\/[^;]+);base64,([^"]+)"[^>]*>/gi;
// <audio src="data:audio/mp4;codecs=...;base64,..."> from the editor's attach / record tools.
const EMBEDDED_AUDIO = /<audio\b[^>]*?\ssrc="data:(audio\/[^;"]+)[^",]*;base64,([^"]+)"[^>]*>(?:\s*<\/audio>)?/gi;
const AUDIO_EXT = { mpeg: 'mp3', mp3: 'mp3', mp4: 'm4a', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac', wav: 'wav', 'x-wav': 'wav', webm: 'webm', ogg: 'ogg', opus: 'opus', flac: 'flac' };
const EXTENSIONS = { jpeg: 'jpg', 'svg+xml': 'svg' };

function extensionFor(mime) {
  const subtype = mime.split('/')[1].toLowerCase();
  const ext = EXTENSIONS[subtype] || subtype;
  return /^[a-z0-9]{1,4}$/.test(ext) ? ext : 'png';
}

// <img src="https://..."> from ChatGPT / the web -> downloaded once and stored in the deck (works offline), when the exporter
// was given fetchRemoteImage. A failed download keeps the web link and warns.
const REMOTE_IMAGE = /<img\b[^>]*?\ssrc="(https:\/\/[^"]+)"[^>]*>/gi;
async function embedRemoteImages(html, ctx) {
  if (!ctx.fetchRemoteImage || !/<img\b[^>]*\ssrc="https:/i.test(html)) return html;
  let result = '';
  let cursor = 0;
  for (const match of html.matchAll(REMOTE_IMAGE)) {
    result += html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const url = match[1].replace(/&amp;/g, '&');
    if (!isProxyableImageUrl(url)) { result += match[0]; continue; }
    try {
      const filename = await ctx.addRemoteImage(url);
      result += match[0].replace(match[1], filename);
    } catch (error) {
      ctx.warn(`A pasted web image could not be saved in the deck and stays a web link (${error.message}).`);
      result += match[0];
    }
  }
  return result + html.slice(cursor);
}

async function extractMedia(html, ctx) {
  if (!html) return html;
  html = await embedRemoteImages(html, ctx);
  // Audio first: Anki references sound files as [sound:file.mp3] inside the field text.
  if (/<audio\b/i.test(html)) {
    const audio = [...html.matchAll(EMBEDDED_AUDIO)];
    let converted = '';
    let position = 0;
    for (const match of audio) {
      converted += html.slice(position, match.index);
      position = match.index + match[0].length;
      try {
        const subtype = match[1].split('/')[1].toLowerCase();
        converted += `[sound:${ctx.addAudio(match[2], AUDIO_EXT[subtype] || 'mp3')}]`;
      } catch (error) {
        ctx.warn(`Skipped an audio clip: ${error.message}`);
      }
    }
    html = converted + html.slice(position);
  }
  const matches = [...html.matchAll(EMBEDDED_IMAGE)];
  if (!matches.length) return html;
  let result = '';
  let cursor = 0;
  for (const match of matches) {
    result += html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    try {
      const filename = await ctx.addImage(match[2], match[1], false);
      result += `<img src="${filename}" style="max-width:100%; height:auto;">`;
    } catch (error) {
      ctx.warn(`Skipped an embedded image: ${error.message}`);
      result += match[0];
    }
  }
  return result + html.slice(cursor);
}

// --- Image occlusion SVG (port of _ioe_svg_shape / _ioe_mask_svg) --------------
function ioeSvgShape(mask, width, height, fill, shapeId) {
  const x = Number(mask.x) * width;
  const y = Number(mask.y) * height;
  const w = Number(mask.width) * width;
  const h = Number(mask.height) * height;
  const common = `id="${htmlEscape(shapeId)}" fill="${fill}" stroke="#2D2D2D" stroke-width="2"`;
  if (mask.shape === 'ellipse') {
    return `<ellipse ${common} cx="${(x + w / 2).toFixed(3)}" cy="${(y + h / 2).toFixed(3)}" rx="${(w / 2).toFixed(3)}" ry="${(h / 2).toFixed(3)}" />`;
  }
  if (mask.shape === 'polygon') {
    const points = (mask.points || []).map(point => `${(Number(point.x) * width).toFixed(3)},${(Number(point.y) * height).toFixed(3)}`).join(' ');
    return `<polygon ${common} points="${points}" />`;
  }
  return `<rect ${common} x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${w.toFixed(3)}" height="${h.toFixed(3)}" />`;
}

export function ioeMaskSvg(width, height, groups, mode, targetIndex, side, sessionId) {
  const elements = [];
  groups.forEach((group, index) => {
    if (side === 'A' && (mode === 'oa' || index === targetIndex)) return;
    if (side === 'Q' && mode === 'oa' && index !== targetIndex) return;
    const fill = index === targetIndex ? '#FF7E7E' : '#FFEBA2';
    const shapeId = `${sessionId}-${mode}-${index + 1}`;
    if (group.length > 1) {
      const children = group.map((mask, child) => ioeSvgShape(mask, width, height, fill, `${shapeId}-${child + 1}`)).join('');
      elements.push(`<g id="${shapeId}">${children}</g>`);
    } else {
      elements.push(ioeSvgShape(group[0], width, height, fill, shapeId));
    }
  });
  const svgId = htmlEscape(`${sessionId}-${mode}-${side}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" id="${svgId}">`
    + `<g inkscape:groupmode="layer" inkscape:label="Masks" id="ioe-mask-layer">${elements.join('')}</g></svg>`;
}

// One-by-one image occlusion keeps every region on a single card: an inline SVG whose
// regions (grouped shapes) the card's JavaScript reveals one at a time.
export function sequentialMasksSvg(width, height, groups) {
  const body = groups.map((group, index) => `<g class="sq-m" data-i="${index}">${group.map((mask, child) => ioeSvgShape(mask, width, height, '#FFEBA2', `m${index}-${child}`)).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`;
}

// {{c1::answer::hint}} -> <span class="sc" data-n="1" data-hint="hint">answer</span>, which the
// sequential cloze template hides and reveals in cloze-number order.
export function clozeToSequentialHtml(html) {
  let count = 0;
  const converted = html.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_match, number, text, hint) => {
    count += 1;
    const hintAttribute = hint ? ` data-hint="${htmlEscape(hint.replace(/<[^>]*>/g, '').trim())}"` : '';
    return `<span class="sc" data-n="${Number(number)}"${hintAttribute}>${text}</span>`;
  });
  return { html: converted, count };
}

const escHeader = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ioHeader(cardHeader, group = []) {
  const hint = group.find(mask => mask.hint)?.hint;
  return [cardHeader, hint].filter(part => part && String(part).trim()).map(part => escHeader(String(part).trim())).join('<br>');
}

function normalizeMasks(masks) {
  const normalized = [];
  const groups = new Map();
  masks.forEach((source, index) => {
    const mask = { ...source };
    const shape = mask.shape || 'rect';
    if (!['rect', 'ellipse', 'polygon'].includes(shape)) throw new CardError('Unsupported occlusion shape');
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = mask[key];
      if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new CardError('Mask coordinates must be normalized between 0 and 1');
    }
    if (shape === 'polygon') {
      const points = mask.points || [];
      if (points.length < 3) throw new CardError('Polygon masks need at least three points');
      for (const point of points) {
        const px = Number(point?.x ?? -1);
        const py = Number(point?.y ?? -1);
        if (!(px >= 0 && px <= 1 && py >= 0 && py <= 1)) throw new CardError('Polygon points must be normalized between 0 and 1');
      }
    }
    const maskId = String(mask.id || `mask-${index + 1}`);
    const group = String(mask.group || maskId);
    mask.id = maskId;
    mask.group = group;
    normalized.push(mask);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(mask);
  });
  return { normalized, groups: [...groups.values()] };
}

// --- Note planning -------------------------------------------------------------
// Converts payload cards into notes + media without touching SQLite, so the work
// can be split across several packages when a deck is very large.
async function planNotes(payload, { prepareImage, warn, onProgress, models, fetchRemoteImage }) {
  const planned = [];
  const imageCache = new Map();
  const remoteCache = new Map(); // url -> data needed to add the file to any note's media

  for (let cardIndex = 0; cardIndex < payload.cards.length; cardIndex += 1) {
    const card = payload.cards[cardIndex];
    const media = new Map();
    const notes = [];
    const tags = cleanTags(card.tags);
    const ctx = {
      warn,
      fetchRemoteImage,
      async addRemoteImage(url) {
        let pending = remoteCache.get(url);
        if (!pending) {
          pending = fetchRemoteImage(url).then(({ bytes, mime }) => {
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { base64: btoa(binary), mime };
          });
          remoteCache.set(url, pending);
        }
        const { base64, mime } = await pending;
        return this.addImage(base64, mime, false);
      },
      addAudio(base64, ext) {
        const name = `media_${randomInt(1000, 9999)}_${randomHex(4)}.${ext}`;
        media.set(name, base64ToBytes(base64));
        return name;
      },
      async addImage(base64, mime, forOcclusion) {
        const cacheKey = `${forOcclusion ? 'o' : 'n'}:${mime}:${base64.length}:${base64.slice(0, 64)}:${base64.slice(-64)}`;
        let entry = imageCache.get(cacheKey);
        if (!entry) {
          const raw = base64ToBytes(base64);
          const prepared = await prepareImage(raw, mime, { forOcclusion });
          const ext = prepared.ext || extensionFor(prepared.mime || mime);
          entry = { name: `media_${randomInt(1000, 9999)}_${randomHex(4)}.${ext}`, bytes: prepared.bytes, width: prepared.width, height: prepared.height };
          imageCache.set(cacheKey, entry);
        }
        media.set(entry.name, entry.bytes);
        ctx.last = entry;
        return entry.name;
      },
    };

    const pills = [];
    for (const pillHtml of normalizePills(card.pills, models.basic.fields.length - 2)) pills.push(await extractMedia(pillHtml, ctx));

    if (card.type === 'Image Occlusion') {
      if (!card.image_data || !card.image_data.startsWith('data:image/') || !card.masks?.length) {
        throw new CardError('Image Occlusion cards need a source image and at least one mask');
      }
      const separator = card.image_data.indexOf(';base64,');
      if (separator < 0) throw new CardError('Invalid image data for Image Occlusion');
      const mime = card.image_data.slice(5, separator);
      let imageName;
      try {
        imageName = await ctx.addImage(card.image_data.slice(separator + 8), mime, true);
      } catch {
        throw new CardError('Invalid image data for Image Occlusion');
      }
      const image = ctx.last;
      if (!image.width || !image.height) throw new CardError('Invalid image data for Image Occlusion');
      if (image.width * image.height > 40_000_000) throw new CardError('Image Occlusion source image is too large');

      const { groups } = normalizeMasks(card.masks);
      const oneByOne = card.occlusion_mode === 'sequential' || card.occlusion_mode === 'random';
      if (oneByOne) {
        const widthSetting = Number.isFinite(card.image_width) ? Math.min(1800, Math.max(180, Math.round(card.image_width))) : 720;
        const answerHtml = await extractMedia(card.answer || '', ctx);
        notes.push({
          model: card.occlusion_mode === 'random' ? models.ioRandom : models.ioSeq,
          fields: [ioHeader(card.header), `<img src="${imageName}" style="width:${widthSetting}px;max-width:100%;height:auto">`, sequentialMasksSvg(image.width, image.height, groups), answerHtml, card.occlusion_mode, ...pills],
          tags,
          cards: [0],
        });
      } else {
      const mode = card.occlusion_mode === 'hide-one' ? 'oa' : 'ao';
      const sessionId = uuidHex();
      const originalMaskName = `${sessionId}-${mode}-O.svg`;
      media.set(originalMaskName, utf8(ioeMaskSvg(image.width, image.height, groups, mode, null, 'O', sessionId)));
      const imageWidth = Number.isFinite(card.image_width) ? Math.min(1800, Math.max(180, Math.round(card.image_width))) : 720;
      const ioAnswer = await extractMedia(card.answer || '', ctx);
      groups.forEach((_, targetIndex) => {
        const noteId = `${sessionId}-${mode}-${targetIndex + 1}`;
        const questionMaskName = `${noteId}-Q.svg`;
        const answerMaskName = `${noteId}-A.svg`;
        media.set(questionMaskName, utf8(ioeMaskSvg(image.width, image.height, groups, mode, targetIndex, 'Q', sessionId)));
        media.set(answerMaskName, utf8(ioeMaskSvg(image.width, image.height, groups, mode, targetIndex, 'A', sessionId)));
        const maskStyle = 'style="display:block;width:100%;height:100%"';
        notes.push({
          model: models.io,
          fields: [
            noteId, ioHeader(card.header, groups[targetIndex]),
            `<img src="${imageName}" style="width:${imageWidth}px;max-width:100%;height:auto">`,
            `<img src="${questionMaskName}" ${maskStyle}>`,
            '', '', '',
            ioAnswer,
            '',
            `<img src="${answerMaskName}" ${maskStyle}>`,
            `<img src="${originalMaskName}">`,
            ...pills,
          ],
          tags,
          cards: [0],
        });
      });
      }
    } else if (card.type === 'Basic' || card.type === 'Cloze') {
      if (!String(card.question || '').trim()) throw new CardError('Question cannot be empty');
      const question = await extractMedia(card.question || '', ctx);
      const answer = await extractMedia(card.answer || '', ctx);
      const isCloze = card.type === 'Cloze';
      if (isCloze && card.sequential) {
        const sequential = clozeToSequentialHtml(question);
        if (!sequential.count) throw new CardError('Add at least one cloze deletion, such as {{c1::key term}}.');
        notes.push({ model: models.clozeSeq, fields: [sequential.html, answer, ...pills], tags, cards: [0] });
      } else {
        let ords = [0];
        if (isCloze) {
          const found = new Set();
          for (const match of question.matchAll(/{{c(\d+)::.+?}}/gs)) if (Number(match[1]) > 0) found.add(Number(match[1]) - 1);
          ords = found.size ? [...found] : [0];
        }
        notes.push({ model: isCloze ? models.cloze : models.basic, fields: [question, answer, ...pills], tags, cards: ords });
      }
    } else {
      throw new CardError(`Unsupported card type: ${card.type}`);
    }

    let mediaBytes = 0;
    media.forEach(bytes => { mediaBytes += bytes.length; });
    planned.push({ notes, media, mediaBytes });
    onProgress?.(cardIndex + 1, payload.cards.length);
  }
  return planned;
}

// --- Package assembly ----------------------------------------------------------
function writePackage({ SQL, deckId, deckName, items, timestamp }) {
  const db = new SQL.Database();
  try {
    db.exec(APKG_SCHEMA);
    const usedModels = new Map();
    items.forEach(item => item.notes.forEach(note => usedModels.set(note.model.id, note.model)));
    const models = {};
    usedModels.forEach(model => {
      models[String(model.id)] = {
        css: model.css,
        did: deckId,
        flds: model.fields.map((name, ord) => ({ name, ord, font: 'Liberation Sans', media: [], rtl: false, size: 20, sticky: false })),
        id: String(model.id),
        latexPost: LATEX_POST,
        latexPre: LATEX_PRE,
        latexsvg: false,
        mod: Math.floor(timestamp),
        name: model.name,
        req: model.req,
        sortf: model.sortField,
        tags: [],
        tmpls: model.templates.map((template, ord) => ({ ...template, ord, bafmt: '', bqfmt: '', bfont: '', bsize: 0, did: null })),
        type: model.type,
        usn: -1,
        vers: [],
      };
    });
    const decks = {
      ...COL_DECKS_DEFAULT,
      [String(deckId)]: {
        collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 0, extendRev: 50, id: deckId,
        lrnToday: [163, 2], mod: 1425278051, name: deckName, newToday: [163, 2], revToday: [163, 0],
        timeToday: [163, 23598], usn: -1,
      },
    };
    db.run('INSERT INTO col VALUES(null,?,?,?,?,?,?,?,?,?,?,?,?)', [
      1411124400, 1425279151694, 1425279151690, 11, 0, 0, 0,
      JSON.stringify(COL_CONF), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(COL_DCONF), '{}',
    ]);

    let nextId = Math.floor(timestamp * 1000);
    const insertNote = db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const insertCard = db.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (const item of items) {
      for (const note of item.notes) {
        const noteId = nextId; nextId += 1;
        insertNote.run([
          noteId, guidFor(...note.fields), note.model.id, Math.floor(timestamp), -1,
          ` ${note.tags.join(' ')} `, note.fields.join(FIELD_SEPARATOR), note.fields[note.model.sortField], 0, 0, '',
        ]);
        for (const ord of note.cards) {
          const cardId = nextId; nextId += 1;
          insertCard.run([cardId, noteId, deckId, ord, Math.floor(timestamp), -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '']);
        }
      }
    }
    db.exec('COMMIT');
    insertNote.free();
    insertCard.free();
    return db.export();
  } finally {
    db.close();
  }
}

function zipPackage(database, items, themeFiles = []) {
  const files = { 'collection.anki2': [database, { level: 6 }] };
  const mediaMap = {};
  let index = 0;
  const seen = new Set();
  for (const file of themeFiles) {
    seen.add(file.name);
    mediaMap[index] = file.name;
    files[String(index)] = [file.bytes, { level: /\.(svg)$/i.test(file.name) ? 6 : 0 }];
    index += 1;
  }
  for (const item of items) {
    for (const [name, bytes] of item.media) {
      if (seen.has(name)) continue;
      seen.add(name);
      mediaMap[index] = name;
      // Images are already compressed; only the small SVG/text files benefit.
      files[String(index)] = [bytes, { level: /\.(svg|txt|html)$/i.test(name) ? 6 : 0 }];
      index += 1;
    }
  }
  files.media = utf8(JSON.stringify(mediaMap));
  return zipSync(files);
}

/**
 * Build one or more .apkg packages for a deck payload.
 *
 * @param payload  { deck_name, cards:[{type,question,answer,tags,image_data,image_width,masks,occlusion_mode}] }
 * @param options.initSql        async () => sql.js module (required)
 * @param options.prepareImage   async (bytes, mime, {forOcclusion}) => {bytes, mime?, ext?, width?, height?}
 * @param options.maxPartBytes   split into several packages above this much media (default 200MB)
 * @param options.onProgress     (stage, done, total) => void
 * @returns Promise<{ parts: Uint8Array[], deckId, warnings: string[], noteCount, cardCount }>
 */
export async function buildApkg(payload, options) {
  const { initSql, prepareImage = async (bytes, mime) => ({ bytes, mime }), maxPartBytes = 200 * 1024 * 1024, onProgress, fetchRemoteImage } = options;
  const deckName = String(payload.deck_name || '').trim();
  if (!deckName) throw new CardError('Deck name cannot be empty');
  if (deckName.length > MAX_DECK_NAME) throw new CardError(`Deck name must be ${MAX_DECK_NAME} characters or fewer`);
  if (!payload.cards?.length) throw new CardError('Add at least one card before exporting.');

  const settings = normalizeSettings(options.settings ?? payload.settings);
  const models = buildModels(settings);
  const themeFiles = themeMedia(settings).map(file => ({ name: file.name, bytes: base64ToBytes(file.base64) }));

  const warnings = [];
  const planned = await planNotes(payload, {
    models,
    fetchRemoteImage,
    prepareImage,
    warn: message => warnings.push(message),
    onProgress: (done, total) => onProgress?.('prepare', done, total),
  });

  // Split into parts so a huge deck never exceeds the browser's memory budget.
  const groups = [];
  let current = [];
  let currentBytes = 0;
  for (const item of planned) {
    if (current.length && currentBytes + item.mediaBytes > maxPartBytes) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.mediaBytes;
  }
  if (current.length) groups.push(current);

  const SQL = await initSql();
  const deckId = randomInt(1_000_000_000, 9_999_999_999);
  const parts = [];
  for (let index = 0; index < groups.length; index += 1) {
    onProgress?.('package', index + 1, groups.length);
    const timestamp = Date.now() / 1000;
    const database = writePackage({ SQL, deckId, deckName, items: groups[index], timestamp });
    parts.push(zipPackage(database, groups[index], themeFiles));
    groups[index] = null;
    // Let the UI breathe between large packages.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const noteCount = planned.reduce((total, item) => total + item.notes.length, 0);
  const cardCount = planned.reduce((total, item) => total + item.notes.reduce((sum, note) => sum + note.cards.length, 0), 0);
  return { parts, deckId, warnings, noteCount, cardCount };
}
