// BeeRus card types: settings, themes (CSS + templates) and the six note types every export uses.
//
//   Basic - BeeRus                       Image Occlusion - BeeRus
//   Cloze - BeeRus                       Image Occlusion (Sequential) - BeeRus
//   Cloze (Sequential) - BeeRus          Image Occlusion (Random) - BeeRus
//
// Every note type carries four "pill" fields (Pill 1..4). On the answer side each non-empty pill shows
// as a button; tapping it expands the reference image / text (the way AnKing shows First Aid, Pathoma ...).
// Pills are plain <details> elements, so they work in Anki desktop, AnkiDroid and AnkiMobile without add-ons.
//
// Everything here is pure (no DOM, no network) so the browser exporter, the settings-page preview and the
// Python backend (which receives the built models in the export payload) all use the same strings.
import {
  ANKING_CARD_CSS, BASIC_QFMT, BASIC_AFMT, CLOZE_QFMT, CLOZE_AFMT,
  SEQ_CLOZE_CSS_EXTRA, SEQ_CLOZE_QFMT, SEQ_CLOZE_AFMT, SEQ_IO_CSS, SEQ_IO_QFMT, SEQ_IO_AFMT,
} from './sequentialTemplates.js';

export const SETTINGS_KEY = 'beerus-settings-v1';
export const PILL_COUNT = 4;
export const THEME_MEDIA_PREFIX = '_beerus_'; // leading underscore: Anki never deletes it as "unused media"

export const PILL_STYLES = ['bubble', 'solid', 'gradient', 'glass', 'outline', 'neon'];
export const PILL_PATTERNS = ['none', 'dots', 'stripes', 'grid', 'zigzag'];

export const FONT_FAMILIES = {
  arial: { label: 'Arial (AnKing)', css: '"Arial Greek", Arial, sans-serif' },
  system: { label: 'System UI', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  readable: { label: 'Verdana (easy to read)', css: 'Verdana, Tahoma, sans-serif' },
  serif: { label: 'Georgia (serif)', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Monospace', css: 'Consolas, "Courier New", monospace' },
};

export const DEFAULT_SETTINGS = {
  version: 1,
  appearance: {
    fontFamily: 'arial',
    fontSize: 28,           // px, one number scales the whole card (AnKing default 28)
    lineHeight: 1.35,
    align: 'center',        // center | left
    day: { bg: '#D1CFCE', text: '#000000', cloze: '#0000FF', extra: '#000080', accent: '#F39C12' },
    night: { bg: '#272828', text: '#FFFAFA', cloze: '#4297F9', extra: '#FF00FF', accent: '#F39C12' },
    extraItalic: true,
    imageMaxWidth: 85,      // % of the card width
    listMaxWidth: 50,       // % - bullet lists stay a compact block inside the centred card
  },
  behavior: {
    autoFlip: true,         // one-by-one cards flip to the answer after the last reveal
    nextKey: 'n',
    allKey: ',',
    showHelp: true,         // the small "press N to reveal" line
    pillShortcut: 'shift',  // shift | alt | off  (Shift+1..4 toggles a pill, Shift+0 toggles all)
    rememberPills: true,    // keep opened pills open on the next card (while the review session lasts)
    showTags: false,        // tags under the answer
  },
  pillStyle: { shape: 'pill', size: 'md', showIcons: true, style: 'bubble', pattern: 'none' },
  pills: [
    { label: 'Reference', color: '#3B82F6', iconType: 'emoji', icon: '📖', iconData: '', iconUrl: '', open: false },
    { label: 'Compare', color: '#10B981', iconType: 'emoji', icon: '⚖️', iconData: '', iconUrl: '', open: false },
    { label: 'Lecture notes', color: '#F59E0B', iconType: 'emoji', icon: '📝', iconData: '', iconUrl: '', open: false },
    { label: 'My notes', color: '#A855F7', iconType: 'emoji', icon: '⭐', iconData: '', iconUrl: '', open: false },
  ],
  watermark: { enabled: false, iconType: 'default', iconData: '', iconUrl: '', size: 22, opacity: 0.45, corner: 'bottom-right' },
  export: { maxImageEdge: 2000, jpegQuality: 0.86 },
};

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function mergeInto(base, saved) {
  if (!isObject(base)) return saved === undefined ? base : saved;
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObject(saved)) return out;
  Object.keys(base).forEach(key => {
    if (saved[key] === undefined) return;
    if (isObject(base[key])) out[key] = mergeInto(base[key], saved[key]);
    else if (Array.isArray(base[key]) && Array.isArray(saved[key])) {
      out[key] = base[key].map((item, index) => (isObject(item) ? mergeInto(item, saved[key][index]) : saved[key][index] ?? item));
    } else out[key] = saved[key];
  });
  return out;
}

/** Fills any missing/old keys from DEFAULT_SETTINGS and clamps the numbers. */
export function normalizeSettings(saved) {
  const settings = mergeInto(DEFAULT_SETTINGS, saved);
  const a = settings.appearance;
  a.fontSize = clamp(Number(a.fontSize), 14, 56, 28);
  a.lineHeight = clamp(Number(a.lineHeight), 1, 2, 1.35);
  a.imageMaxWidth = clamp(Number(a.imageMaxWidth), 20, 100, 85);
  a.listMaxWidth = clamp(Number(a.listMaxWidth), 20, 100, 50);
  if (!FONT_FAMILIES[a.fontFamily]) a.fontFamily = 'arial';
  if (!['center', 'left'].includes(a.align)) a.align = 'center';
  const b = settings.behavior;
  b.nextKey = singleKey(b.nextKey, 'n');
  b.allKey = singleKey(b.allKey, ',');
  if (!['shift', 'alt', 'off'].includes(b.pillShortcut)) b.pillShortcut = 'shift';
  const w = settings.watermark;
  w.size = clamp(Number(w.size), 12, 64, 22);
  w.opacity = clamp(Number(w.opacity), 0.1, 1, 0.45);
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(w.corner)) w.corner = 'bottom-right';
  settings.pills.forEach(pill => {
    pill.label = String(pill.label || '').slice(0, 24) || 'Pill';
    if (!['emoji', 'image', 'url', 'none'].includes(pill.iconType)) pill.iconType = 'emoji';
    if (!/^#[0-9a-f]{6}$/i.test(pill.color)) pill.color = '#3B82F6';
  });
  const ps = settings.pillStyle;
  if (!PILL_STYLES.includes(ps.style)) ps.style = 'bubble';
  if (!PILL_PATTERNS.includes(ps.pattern)) ps.pattern = 'none';
  const e = settings.export;
  e.maxImageEdge = clamp(Number(e.maxImageEdge), 600, 4000, 2000);
  e.jpegQuality = clamp(Number(e.jpegQuality), 0.5, 1, 0.86);
  return settings;
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function singleKey(value, fallback) {
  const text = String(value ?? '');
  return /^[a-z0-9,.;/=\-[\]]$/i.test(text) ? text : fallback;
}

export function loadSettings() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cssUrl = (url) => `url("${String(url).replace(/["\\\n\r]/g, '')}")`;

// ---------------------------------------------------------------------------------------------
// Media referenced only from templates / CSS (pill icons, watermark). Names start with "_".
// ---------------------------------------------------------------------------------------------
function dataUrlParts(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(String(dataUrl || ''));
  if (!match) return null;
  const subtype = match[1].split('/')[1].toLowerCase();
  const ext = subtype === 'jpeg' ? 'jpg' : subtype === 'svg+xml' ? 'svg' : /^[a-z0-9]{1,4}$/.test(subtype) ? subtype : 'png';
  return { mime: match[1], base64: match[2], ext };
}

/** [{ name, base64, dataUrl }] for every uploaded icon that the exported templates reference. */
export function themeMedia(settings) {
  const files = [];
  settings.pills.forEach((pill, index) => {
    if (pill.iconType !== 'image') return;
    const parts = dataUrlParts(pill.iconData);
    if (parts) files.push({ name: `${THEME_MEDIA_PREFIX}pill${index + 1}.${parts.ext}`, base64: parts.base64, dataUrl: pill.iconData });
  });
  const w = settings.watermark;
  if (w.enabled && w.iconType === 'image') {
    const parts = dataUrlParts(w.iconData);
    if (parts) files.push({ name: `${THEME_MEDIA_PREFIX}watermark.${parts.ext}`, base64: parts.base64, dataUrl: w.iconData });
  }
  return files;
}

const DEFAULT_MARK_SVG = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#7c3aed"/><path d="M14 30 20 10l12 12 12-12 6 20z" fill="#fff"/><circle cx="24" cy="38" r="3.2" fill="#fff"/><circle cx="40" cy="38" r="3.2" fill="#fff"/><path d="M26 47q6 5 12 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>');

function pillIconCss(pill, index, files) {
  if (!['image', 'url'].includes(pill.iconType)) return '';
  const source = pill.iconType === 'url'
    ? (/^https?:\/\//i.test(pill.iconUrl) ? pill.iconUrl : '')
    : files.find(file => file.name.startsWith(`${THEME_MEDIA_PREFIX}pill${index + 1}.`))?.name || '';
  return source ? `.bpill-${index + 1} .bpill-ic { background-image: ${cssUrl(source)}; }\n` : '';
}

function watermarkCss(settings, files) {
  const w = settings.watermark;
  if (!w.enabled) return '';
  let image = `url("data:image/svg+xml,${DEFAULT_MARK_SVG}")`;
  if (w.iconType === 'url' && /^https?:\/\//i.test(w.iconUrl)) image = cssUrl(w.iconUrl);
  else if (w.iconType === 'image') {
    const file = files.find(item => item.name.startsWith(`${THEME_MEDIA_PREFIX}watermark.`));
    if (file) image = cssUrl(file.name);
  }
  const [vertical, horizontal] = w.corner.split('-');
  return `#bmark { position: fixed; ${vertical}: 6px; ${horizontal}: 8px; width: ${w.size}px; height: ${w.size}px; opacity: ${w.opacity}; background: ${image} center / contain no-repeat; pointer-events: none; z-index: 5; }\n`;
}

// ---------------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------------
const IOE_CSS = `
#io-header, #io-footer { margin: .5em auto; max-width: 90%; }
#io-wrapper { position: relative; display: inline-block; max-width: 100%; margin: 0 auto; line-height: 0; }
#io-original { position: relative; z-index: 1; }
#io-original img { display: block; max-width: 100%; height: auto; }
#io-overlay { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; }
#io-overlay img { display: block; width: 100%; height: 100%; object-fit: fill; }
#io-revl-btn { display: block; margin: .8em auto; padding: .35em .8em; }
#io-extra-wrapper { width: min(80%, 42rem); margin: .8em auto; text-align: left; line-height: 1.5; }
.io-extra-entry { margin-top: .6em; }
.io-field-descr { font-weight: 700; margin-bottom: .15em; }
`;

const SIZES = { sm: '.5rem', md: '.6rem', lg: '.72rem' };
const RADIUS = { pill: '999px', rounded: '.5em', square: '.15em' };

export function baseCss(settings) {
  const a = settings.appearance;
  const font = FONT_FAMILIES[a.fontFamily].css;
  const extraStyle = a.extraItalic ? 'italic' : 'normal';
  return `
/* BeeRus card styles - generated from the Anki Studio settings page */
html { font-size: ${a.fontSize}px; }
.mobile { font-size: ${a.fontSize}px; }
.card { font-family: ${font}; font-size: 1rem; line-height: ${a.lineHeight}; text-align: ${a.align}; margin: 15px 15px 0; padding-bottom: 1em; }
/* day mode */
.card { color: ${a.day.text}; background-color: ${a.day.bg}; }
.cloze { font-weight: bold; color: ${a.day.cloze}; }
#extra { font-style: ${extraStyle}; font-size: 1rem; color: ${a.day.extra}; margin-top: 1rem; }
/* night mode */
.nightMode.card, .night_mode .card { color: ${a.night.text} !important; background-color: ${a.night.bg} !important; }
.nightMode .cloze, .night_mode .cloze { color: ${a.night.cloze} !important; }
.nightMode #extra, .night_mode #extra { color: ${a.night.extra}; }
/* bold / underline / italic keep the text colour (they carry meaning, not colour) */
b, u, i { color: inherit; }
hr { opacity: .7; }
img { max-width: ${a.imageMaxWidth}%; max-height: 100%; }
#extra img { max-width: ${a.imageMaxWidth}%; min-width: 30%; }
ul, ol { display: inline-block; max-width: ${a.listMaxWidth}%; padding-left: 40px; margin: auto; text-align: left; }
.mobile ul, .mobile ol, .mobile img { max-width: 100%; }
.mnemonics { display: inline-block; text-align: left; }
.centerbox { text-align: center; }
a:not([href]), a[href^="javascript:"] { text-decoration: none; color: inherit; }
table { border-collapse: collapse; margin: 8px auto; }
td, th { border: 1px solid #888; padding: 4px 9px; text-align: left; vertical-align: top; }
th { font-weight: bold; background: rgba(128, 128, 128, .18); }
blockquote { margin: 6px auto; padding: 2px 12px; border-left: 3px solid #888; text-align: left; display: inline-block; }
code { font-family: monospace; background: rgba(128, 128, 128, .2); padding: 0 4px; border-radius: 3px; }
`;
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (value) => Math.round(amount < 0 ? value * (1 + amount) : value + (255 - value) * amount);
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map(value => channel(value).toString(16).padStart(2, '0')).join('')}`;
}

const PATTERNS = {
  none: '',
  dots: 'radial-gradient(rgba(255,255,255,.28) 1.3px, transparent 1.7px) 0 0 / 8px 8px',
  stripes: 'repeating-linear-gradient(45deg, rgba(255,255,255,.17) 0 4px, transparent 4px 9px)',
  grid: 'linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px) 0 0 / 8px 8px, linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px) 0 0 / 8px 8px',
  zigzag: 'repeating-linear-gradient(135deg, rgba(255,255,255,.15) 0 3px, transparent 3px 7px), repeating-linear-gradient(45deg, rgba(0,0,0,.08) 0 3px, transparent 3px 7px)',
};

// One rule set per visual style. --bp is the pill colour, --bpl / --bpd its lighter / darker shades.
function pillSurface(style, pattern) {
  const overlay = PATTERNS[pattern] ? `${PATTERNS[pattern]}, ` : '';
  const sheen = 'linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 55%)';
  switch (style) {
    case 'bubble': // catalogue #40: flat pill, icon sits in a white circle
      return `background: ${overlay}linear-gradient(var(--bp), var(--bp)); color: #fff; padding-left: .45em; box-shadow: 0 1px 3px rgba(0,0,0,.35);`;
    case 'solid':
      return `background: ${overlay}linear-gradient(var(--bp), var(--bp)); color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35);`;
    case 'glass':
      return `background: ${overlay}linear-gradient(180deg, rgba(255,255,255,.3), rgba(255,255,255,.06)), var(--bp); color: #fff; border: 1px solid rgba(255,255,255,.4); box-shadow: 0 2px 6px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.5);`;
    case 'outline':
      return `background: ${overlay}linear-gradient(var(--bpt), var(--bpt)); color: inherit; border: 2px solid var(--bp); box-shadow: none; text-shadow: none;`;
    case 'neon':
      return `background: ${overlay}linear-gradient(#0d0d14, #0d0d14); color: var(--bpl); border: 1.5px solid var(--bp); box-shadow: 0 0 7px var(--bp), inset 0 0 7px var(--bpt); text-shadow: 0 0 6px var(--bp);`;
    default: // gradient
      return `background: ${overlay}${sheen}, linear-gradient(135deg, var(--bpl), var(--bp) 55%, var(--bpd)); color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.35), inset 0 -1px 0 rgba(0,0,0,.18); text-shadow: 0 1px 1px rgba(0,0,0,.3);`;
  }
}

export function pillCss(settings, files = themeMedia(settings)) {
  const p = settings.pillStyle;
  const lines = [`
#bpills { margin: 1.1rem auto 0; display: flex; flex-direction: column; align-items: center; gap: .5rem; font-size: ${SIZES[p.size] || SIZES.md}; font-style: normal; text-align: center; }
.bpill { max-width: 96%; }
.bpill > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: .45em; padding: .34em 1em; border-radius: ${RADIUS[p.shape] || RADIUS.pill}; font-weight: 700; font-family: Arial, sans-serif; line-height: 1.2; letter-spacing: .01em; user-select: none; transition: filter .12s, transform .08s; ${pillSurface(p.style, p.pattern)} }
.bpill > summary:hover { filter: brightness(1.08); }
.bpill > summary:active { transform: scale(.97); }
.bpill > summary::-webkit-details-marker { display: none; }
.bpill > summary::marker { content: ""; }
.bpill > summary::after { content: "\\25BE"; font-size: .85em; opacity: .85; transition: transform .15s; }
.bpill[open] > summary::after { transform: rotate(180deg); }
.bpill-ic { display: inline-block; width: 1.2em; height: 1.2em; background: center / contain no-repeat; }
.bpill-em { font-size: 1.1em; line-height: 1; }
.bpill-body { margin-top: .55rem; padding: .45rem .7rem; border-radius: .55em; border: 1px solid rgba(128,128,128,.35); border-left: 4px solid var(--bp); background: rgba(128,128,128,.1); font-size: .72rem; line-height: 1.4; text-align: ${settings.appearance.align === 'left' ? 'left' : 'center'}; }
.bpill-body img { max-width: 100%; height: auto; border-radius: .3em; }
.bs-bubble .bpill-em, .bs-bubble .bpill-ic { background-color: #fff; border-radius: 50%; width: 1.75em; height: 1.75em; display: inline-grid; place-items: center; font-size: 1em; }
.bs-bubble .bpill-ic { background-size: 68%; }
.bs-bubble .bpill-em { font-size: .95em; }
`];
  settings.pills.forEach((pill, index) => {
    lines.push(`.bpill-${index + 1} { --bp: ${pill.color}; --bpl: ${shade(pill.color, 0.28)}; --bpd: ${shade(pill.color, -0.3)}; --bpt: ${pill.color}2E; }\n`);
    lines.push(pillIconCss(pill, index, files));
  });
  return lines.join('');
}

// ---------------------------------------------------------------------------------------------
// Template fragments
// ---------------------------------------------------------------------------------------------
function pillIconHtml(pill, settings) {
  if (!settings.pillStyle.showIcons || pill.iconType === 'none') return '';
  if (pill.iconType === 'emoji') return pill.icon ? `<span class="bpill-em">${escapeHtml(pill.icon)}</span>` : '';
  return '<span class="bpill-ic"></span>';
}

function pillsHtml(settings) {
  const style = settings.pillStyle.style;
  const items = settings.pills.map((pill, index) => {
    const field = `Pill ${index + 1}`;
    return `{{#${field}}}<details class="bpill bpill-${index + 1}" data-i="${index + 1}"><summary>${pillIconHtml(pill, settings)}<span class="bpill-label">${escapeHtml(pill.label)}</span></summary><div class="bpill-body">{{${field}}}</div></details>{{/${field}}}`;
  });
  return `<div id="bpills" class="bs-${style}">${items.join('')}</div>`;
}

function pillsScript(settings) {
  const b = settings.behavior;
  const open = settings.pills.map(pill => (pill.open ? 1 : 0)).join(',');
  return `<script>
(function () {
  var open = [${open}];
  var remember = ${b.rememberPills ? 'true' : 'false'};
  var mod = ${JSON.stringify(b.pillShortcut)};
  var state = window.__bpState = window.__bpState || {};
  var items = Array.prototype.slice.call(document.querySelectorAll('#bpills details'));
  items.forEach(function (item) {
    var i = Number(item.getAttribute('data-i'));
    if (remember && state[i] !== undefined) item.open = state[i];
    else item.open = !!open[i - 1];
    item.addEventListener('toggle', function () { state[i] = item.open; });
  });
  if (window.__bpKey) { document.removeEventListener('keydown', window.__bpKey); window.__bpKey = null; }
  if (mod !== 'off' && items.length) {
    window.__bpKey = function (event) {
      if (event.ctrlKey || event.metaKey) return;
      if (mod === 'shift' ? !event.shiftKey || event.altKey : !event.altKey || event.shiftKey) return;
      var match = /^Digit([0-4])$/.exec(event.code || '');
      if (!match) return;
      event.preventDefault();
      if (match[1] === '0') {
        var anyClosed = items.some(function (item) { return !item.open; });
        items.forEach(function (item) { item.open = anyClosed; });
      } else {
        var target = items.filter(function (item) { return item.getAttribute('data-i') === match[1]; })[0];
        if (target) target.open = !target.open;
      }
    };
    document.addEventListener('keydown', window.__bpKey);
  }
})();
</script>`;
}

const markHtml = (settings) => (settings.watermark.enabled ? '<div id="bmark"></div>' : '');
const tagsHtml = (settings) => (settings.behavior.showTags ? '{{#Tags}}<div id="btags">{{Tags}}</div>{{/Tags}}' : '');
const TAGS_CSS = '#btags { margin-top: 1rem; font-size: .4rem; opacity: .55; }\n';
const HELP_CSS = '#sc-help, #sq-help { display: none; }\n';

function sequentialTweaks(source, settings) {
  const b = settings.behavior;
  const next = b.nextKey.toUpperCase();
  let out = source.replace('var autoFlip = true;', `var autoFlip = ${b.autoFlip ? 'true' : 'false'};`);
  out = out.replace("event.key === 'n' || event.key === 'N'", `event.key.toLowerCase() === ${JSON.stringify(b.nextKey.toLowerCase())}`);
  out = out.replace("event.key === ','", `event.key === ${JSON.stringify(b.allKey)}`);
  out = out.split('press N ').join(`press ${next} `).split(' , reveals all').join(` ${b.allKey} reveals all`);
  return out;
}

// IOE (hide all / hide one) templates - same structure as Image Occlusion Enhanced.
const IOE_FIELDS = [
  'ID (hidden)', 'Header', 'Image', 'Question Mask', 'Footer', 'Remarks',
  'Sources', 'Extra 1', 'Extra 2', 'Answer Mask', 'Original Mask',
];

export const BEERUS_NAMES = {
  basic: 'Basic - BeeRus',
  cloze: 'Cloze - BeeRus',
  clozeSeq: 'Cloze (Sequential) - BeeRus',
  io: 'Image Occlusion - BeeRus',
  ioSeq: 'Image Occlusion (Sequential) - BeeRus',
  ioRandom: 'Image Occlusion (Random) - BeeRus',
};

const MODEL_IDS = { basic: 1807392301, cloze: 1807392302, clozeSeq: 1807392303, io: 1807392304, ioSeq: 1807392305, ioRandom: 1807392306 };
const PILL_FIELDS = Array.from({ length: PILL_COUNT }, (_, index) => `Pill ${index + 1}`);

/**
 * The six BeeRus note types for these settings: { key: { id, name, type, fields, templates, css, sortField, req } }.
 * Field lists are append-only across versions so a re-import into an existing collection stays compatible.
 */
export function buildModels(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const files = themeMedia(settings);
  const seqIoExtra = SEQ_IO_CSS.startsWith(ANKING_CARD_CSS) ? SEQ_IO_CSS.slice(ANKING_CARD_CSS.length) : SEQ_IO_CSS;
  const common = baseCss(settings) + pillCss(settings, files) + watermarkCss(settings, files) + (settings.behavior.showTags ? TAGS_CSS : '') + (settings.behavior.showHelp ? '' : HELP_CSS);
  const pills = pillsHtml(settings);
  const script = pillsScript(settings);
  const mark = markHtml(settings);
  const tags = tagsHtml(settings);
  const tail = `${pills}${tags}${mark}${script}`;
  const ioeQ = `{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="io-wrapper"><div id="io-overlay">{{Question Mask}}</div><div id="io-original">{{Image}}</div></div>
{{#Footer}}<div id="io-footer">{{Footer}}</div>{{/Footer}}
${mark}
{{/Image}}`;
  const ioeA = `{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="io-wrapper"><div id="io-overlay">{{Answer Mask}}</div><div id="io-original">{{Image}}</div></div>
{{#Footer}}<div id="io-footer">{{Footer}}</div>{{/Footer}}
<button id="io-revl-btn" onclick="var m=document.getElementById('io-overlay');m.style.display=m.style.display==='none'?'block':'none'">Toggle Masks</button>
<div id="io-extra-wrapper">
{{#Remarks}}<div class="io-extra-entry"><div class="io-field-descr">Remarks</div>{{Remarks}}</div>{{/Remarks}}
{{#Sources}}<div class="io-extra-entry"><div class="io-field-descr">Sources</div>{{Sources}}</div>{{/Sources}}
{{#Extra 1}}<div class="io-extra-entry">{{Extra 1}}</div>{{/Extra 1}}
{{#Extra 2}}<div class="io-extra-entry">{{Extra 2}}</div>{{/Extra 2}}
</div>
${tail}
{{/Image}}`;
  const seqIoA = SEQ_IO_AFMT.replace('{{/Image}}', `${tail}\n{{/Image}}`);
  const seqIoQ = sequentialTweaks(SEQ_IO_QFMT, settings).replace('{{/Image}}', `${mark}\n{{/Image}}`);

  const model = (key, spec) => ({ id: MODEL_IDS[key], name: BEERUS_NAMES[key], ...spec });
  return {
    basic: model('basic', {
      type: 0, fields: ['Question', 'Answer', ...PILL_FIELDS],
      templates: [{ name: 'Card 1', qfmt: `${BASIC_QFMT}\n${mark}`, afmt: `${BASIC_AFMT}\n${tail}` }],
      css: common, sortField: 0, req: [[0, 'all', [0]]],
    }),
    cloze: model('cloze', {
      type: 1, fields: ['Text', 'Extra', ...PILL_FIELDS],
      templates: [{ name: 'Cloze Card', qfmt: `${CLOZE_QFMT}\n${mark}`, afmt: `${CLOZE_AFMT}\n${tail}` }],
      css: common, sortField: 0, req: [[0, 'all', [0, 1, 2, 3, 4, 5]]],
    }),
    clozeSeq: model('clozeSeq', {
      type: 0, fields: ['Text', 'Extra', ...PILL_FIELDS],
      templates: [{ name: 'Sequential Cloze', qfmt: `${sequentialTweaks(SEQ_CLOZE_QFMT, settings)}\n${mark}`, afmt: `${SEQ_CLOZE_AFMT}\n${tail}` }],
      css: common + SEQ_CLOZE_CSS_EXTRA, sortField: 0, req: [[0, 'all', [0]]],
    }),
    io: model('io', {
      type: 0, fields: [...IOE_FIELDS, ...PILL_FIELDS],
      templates: [{ name: 'IO Card', qfmt: ioeQ, afmt: ioeA }],
      css: common + IOE_CSS, sortField: 1, req: [[0, 'all', [2]]],
    }),
    ioSeq: model('ioSeq', {
      type: 0, fields: ['Header', 'Image', 'Masks', 'Extra', 'Mode', ...PILL_FIELDS],
      templates: [{ name: 'IO Sequential', qfmt: seqIoQ, afmt: seqIoA }],
      css: common + seqIoExtra, sortField: 1, req: [[0, 'all', [1]]],
    }),
    ioRandom: model('ioRandom', {
      type: 0, fields: ['Header', 'Image', 'Masks', 'Extra', 'Mode', ...PILL_FIELDS],
      templates: [{ name: 'IO Random', qfmt: seqIoQ, afmt: seqIoA }],
      css: common + seqIoExtra, sortField: 1, req: [[0, 'all', [1]]],
    }),
  };
}

/** What the Python backend needs to build the same note types. */
export function buildThemePayload(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  return { models: buildModels(settings), media: themeMedia(settings).map(({ name, base64 }) => ({ name, base64 })) };
}

/** The pills of a card as exactly PILL_COUNT strings. Accepts an array or { 1: '', 'Pill 2': '' }. */
export function normalizePills(pills) {
  const out = Array.from({ length: PILL_COUNT }, () => '');
  if (Array.isArray(pills)) pills.slice(0, PILL_COUNT).forEach((value, index) => { out[index] = String(value ?? ''); });
  else if (isObject(pills)) {
    Object.keys(pills).forEach(key => {
      const match = /([1-4])$/.exec(key);
      if (match) out[Number(match[1]) - 1] = String(pills[key] ?? '');
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tiny Anki template renderer for the settings-page preview (the templates above only use fields,
// {{#x}}/{{^x}} sections, {{cloze:Text}} and {{Tags}}).
// ---------------------------------------------------------------------------------------------
export function renderTemplate(template, fields, { side = 'question', clozeOrd = 1 } = {}) {
  const has = (name) => String(fields[name] ?? '').replace(/<[^>]*>/g, '').trim() !== '' || /<img/i.test(String(fields[name] ?? ''));
  let out = template;
  for (let pass = 0; pass < 6; pass += 1) {
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, body) => (has(name.trim()) ? body : ''));
    out = out.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, body) => (has(name.trim()) ? '' : body));
  }
  out = out.replace(/\{\{cloze:([^}]+)\}\}/g, (_m, name) => renderCloze(String(fields[name.trim()] ?? ''), side, clozeOrd));
  out = out.replace(/\{\{([^}#^/:]+)\}\}/g, (_m, name) => String(fields[name.trim()] ?? ''));
  return out;
}

function renderCloze(html, side, ord) {
  return html.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_m, number, answer, hint) => {
    if (Number(number) !== ord) return answer;
    return side === 'question' ? `<span class="cloze">[${hint ? hint.replace(/<[^>]*>/g, '') : '...'}]</span>` : `<span class="cloze">${answer}</span>`;
  });
}

/** A complete HTML document that shows one card side exactly as the exported note type will render it. */
export function previewDocument(model, fields, { side, night, mobile, mediaUrls = {} }) {
  const template = model.templates[0];
  let html = renderTemplate(side === 'question' ? template.qfmt : template.afmt, fields, { side });
  let css = model.css;
  Object.keys(mediaUrls).forEach(name => {
    css = css.split(name).join(mediaUrls[name]);
    html = html.split(name).join(mediaUrls[name]);
  });
  const classes = `card${night ? ' nightMode' : ''}${mobile ? ' mobile' : ''}`;
  return `<!doctype html><html class="${night ? 'night_mode' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}${css}</style></head><body class="${classes}">${html}</body></html>`;
}

export { IOE_FIELDS };
