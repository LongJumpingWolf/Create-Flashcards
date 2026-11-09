import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BEERUS_NAMES, DEFAULT_SETTINGS, FONT_FAMILIES, buildModels, loadSettings, normalizeSettings,
  previewDocument, saveSettings, themeMedia,
} from '../beerus';
import { clozeToSequentialHtml, ioeMaskSvg, sequentialMasksSvg } from '../apkgBuilder';
import { ChevronLeft, Download, Upload, Rotate } from './Icons';

// --------------------------------------------------------------------------------------------
// Sample content for the preview (identical field layout to a real exported note)
// --------------------------------------------------------------------------------------------
const SAMPLE_W = 600;
const SAMPLE_H = 360;
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_W}" height="${SAMPLE_H}" viewBox="0 0 ${SAMPLE_W} ${SAMPLE_H}">
<rect width="100%" height="100%" fill="#fff"/>
<g fill="none" stroke="#333" stroke-width="2"><rect x="40" y="30" width="170" height="54" rx="8"/><rect x="215" y="150" width="170" height="54" rx="8"/><rect x="390" y="270" width="170" height="54" rx="8"/><path d="M125 84v34h175v32M300 204v34h175v32"/></g>
<g font-family="Georgia, serif" font-size="19" fill="#111" text-anchor="middle"><text x="125" y="63">Stem cell</text><text x="300" y="183">Progenitor</text><text x="475" y="303">Mature cell</text></g></svg>`;
const SAMPLE_IMAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
const SAMPLE_GROUPS = [
  [{ shape: 'rect', x: 40 / SAMPLE_W, y: 30 / SAMPLE_H, width: 170 / SAMPLE_W, height: 54 / SAMPLE_H, hint: 'Which cell is the parent of everything below?' }],
  [{ shape: 'rect', x: 215 / SAMPLE_W, y: 150 / SAMPLE_H, width: 170 / SAMPLE_W, height: 54 / SAMPLE_H, hint: 'Name the intermediate cell' }],
  [{ shape: 'rect', x: 390 / SAMPLE_W, y: 270 / SAMPLE_H, width: 170 / SAMPLE_W, height: 54 / SAMPLE_H, hint: 'Name the end cell' }],
];
const placeholderSvg = (label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="150"><rect width="100%" height="100%" fill="#f8fafc"/><rect x="6" y="6" width="408" height="138" fill="none" stroke="#94a3b8" stroke-dasharray="6 5"/><text x="210" y="82" font-family="Arial" font-size="20" fill="#475569" text-anchor="middle">${label}</text></svg>`)}`;

const SAMPLE_PILLS = [
  `<img src="${placeholderSvg('screenshot of the source page')}"><br>Pathoma p. 41`,
  '<table><tr><th></th><th>Folate</th><th>B12</th></tr><tr><td>Methylmalonic acid</td><td>normal</td><td>↑</td></tr></table>',
  '<div class="gpt"><h2>Why microcytic?</h2><div class="gpt-badgerow"><span class="gpt-badge gpt-badge-warning">Mechanism: Inhibition of heme synthesis</span></div><p>Lead directly inhibits two enzymes of <b>heme synthesis</b>:</p><ol><li><b>ALA dehydratase</b> – converts ALA into porphobilinogen.</li><li><b>Ferrochelatase</b> – inserts iron into protoporphyrin IX.</li></ol><table><tbody><tr><th>Stimulus</th><th>Hepcidin</th></tr><tr><td>Inflammation (IL-6)</td><td>↑ Increases</td></tr></tbody></table></div>',
  'My own note: always check the MCV first.',
];

function sampleFields(key, settings, night) {
  void night;
  const pillFields = Object.fromEntries(SAMPLE_PILLS.map((html, index) => [`Pill ${index + 1}`, html]));
  const base = { ...pillFields, Tags: 'MBBS::Pathology::Hematology' };
  if (key === 'basic') return { ...base, Question: 'Which vitamin deficiency causes <b>pernicious anemia</b>?', Answer: 'Vitamin B12 (cobalamin)' };
  if (key === 'cloze') return { ...base, Text: '<b>Pernicious anemia</b> is autoimmune destruction of {{c1::parietal cells}}, causing ↓ {{c2::intrinsic factor}}', Extra: 'Extra: one short line that is always shown.' };
  if (key === 'clozeSeq') {
    return { ...base, Text: clozeToSequentialHtml('The <b>pathway of sperm</b>: {{c1::seminiferous tubules}} → {{c2::epididymis}} → {{c3::vas deferens}} → {{c4::ejaculatory duct}}').html, Extra: 'Extra: one short line that is always shown.' };
  }
  const header = 'Hematopoiesis';
  const imageHtml = `<img src="${SAMPLE_IMAGE_URL}" style="width:520px;max-width:100%;height:auto">`;
  if (key === 'io') {
    const maskImg = (side) => `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(ioeMaskSvg(SAMPLE_W, SAMPLE_H, SAMPLE_GROUPS, 'ao', 1, side, 'preview'))}" style="display:block;width:100%;height:100%">`;
    return { ...base, 'ID (hidden)': 'p', Header: `${header}<br>${SAMPLE_GROUPS[1][0].hint}`, Image: imageHtml, 'Question Mask': maskImg('Q'), Footer: '', Remarks: '', Sources: '', 'Extra 1': 'Extra: one short line that is always shown.', 'Extra 2': '', 'Answer Mask': maskImg('A'), 'Original Mask': '' };
  }
  return { ...base, Header: `${header} - reveal one by one`, Image: imageHtml, Masks: sequentialMasksSvg(SAMPLE_W, SAMPLE_H, SAMPLE_GROUPS), Extra: 'Extra: one short line that is always shown.', Mode: key === 'ioRandom' ? 'random' : 'sequential' };
}

const DEVICES = { phone: { label: 'Phone', width: 390 }, tablet: { label: 'Tablet', width: 640 }, desktop: { label: 'Desktop', width: 860 } };

// --------------------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------------------
function setIn(object, path, value) {
  const copy = structuredClone(object);
  let cursor = copy;
  for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]];
  cursor[path[path.length - 1]] = value;
  return copy;
}

async function imageFileToIcon(file, size = 64) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const w = image.naturalWidth * scale; const h = image.naturalHeight * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function samplePng() {
  const image = new Image();
  image.src = SAMPLE_IMAGE_URL;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W; canvas.height = SAMPLE_H;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function placeholderPng(label) {
  const image = new Image();
  image.src = placeholderSvg(label);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 420; canvas.height = 150;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function Section({ id, title, hint, children }) {
  return (
    <section className="set-section" id={id}>
      <header><h2>{title}</h2>{hint && <p>{hint}</p>}</header>
      <div className="set-section-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }) {
  return <div className="set-row"><div className="set-row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div><div className="set-row-control">{children}</div></div>;
}

function Toggle({ checked, onChange, label }) {
  return <label className="set-toggle"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="set-switch" aria-hidden="true" /><span>{label}</span></label>;
}

function NumberField({ value, onChange, min, max, step = 1, suffix }) {
  return <span className="set-number"><input type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} />{suffix && <em>{suffix}</em>}</span>;
}

function ColorField({ value, onChange, label }) {
  return <label className="set-color"><input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())} aria-label={label} /><code>{value}</code></label>;
}

// --------------------------------------------------------------------------------------------
// Page
// --------------------------------------------------------------------------------------------
export default function SettingsPage({ onClose, onOpenIcons }) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [previewType, setPreviewType] = useState('cloze');
  const [side, setSide] = useState('answer');
  const [night, setNight] = useState(true);
  const [device, setDevice] = useState('phone');
  const [message, setMessage] = useState('');
  const importRef = useRef(null);

  const commit = useCallback((next) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    if (!saveSettings(normalized)) setMessage('Could not save settings in this browser (storage is full or blocked).');
  }, []);
  const update = useCallback((path, value) => commit(setIn(settings, path, value)), [commit, settings]);

  const models = useMemo(() => buildModels(settings), [settings]);
  const mediaUrls = useMemo(() => Object.fromEntries(themeMedia(settings).map(file => [file.name, file.dataUrl])), [settings]);
  const srcDoc = useMemo(() => {
    const model = models[previewType];
    return previewDocument(model, sampleFields(previewType, settings, night), { side: side === 'answer' ? 'answer' : 'question', night, mobile: device === 'phone', mediaUrls });
  }, [models, previewType, settings, side, night, device, mediaUrls]);

  const uploadIcon = async (path, file) => {
    if (!file) return;
    try {
      update(path, await imageFileToIcon(file));
      setMessage('');
    } catch {
      setMessage('That image could not be read. Try a PNG, JPG, SVG or WebP file.');
    }
  };

  const downloadJson = (data, name) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const importSettings = async (file) => {
    if (!file) return;
    try {
      commit(JSON.parse(await file.text()));
      setMessage('Settings imported.');
    } catch {
      setMessage('That file is not a valid settings file.');
    }
  };

  const downloadTestDeck = async () => {
    setMessage('Building the test deck…');
    try {
      const image = await samplePng();
      const pngPill = await placeholderPng('screenshot of the source page');
      const pills = [`<img src="${pngPill}"><br>Pathoma p. 41`, SAMPLE_PILLS[1], SAMPLE_PILLS[2], SAMPLE_PILLS[3]];
      const masks = SAMPLE_GROUPS.map((group, index) => ({ ...group[0], id: `m${index + 1}`, group: `g${index + 1}` }));
      const common = { tags: ['BeeRus_test'], pills };
      const io = { type: 'Image Occlusion', question: '', answer: 'Extra: one short line that is always shown.', image_data: image, image_width: 520, masks, header: 'Hematopoiesis', ...common };
      const payload = {
        deck_name: 'BeeRus test deck',
        settings,
        cards: [
          { type: 'Basic', question: 'Which vitamin deficiency causes <b>pernicious anemia</b>?', answer: 'Vitamin B12 (cobalamin)', ...common },
          { type: 'Cloze', question: '<b>Pernicious anemia</b> is autoimmune destruction of {{c1::parietal cells}}, causing ↓ {{c2::intrinsic factor}}', answer: 'Extra: one short line that is always shown.', ...common },
          { type: 'Cloze', sequential: true, question: 'The <b>pathway of sperm</b>: {{c1::seminiferous tubules}} → {{c2::epididymis}} → {{c3::vas deferens}} → {{c4::ejaculatory duct}}', answer: '', ...common },
          { ...io, occlusion_mode: 'hide-all' },
          { ...io, occlusion_mode: 'hide-one' },
          { ...io, occlusion_mode: 'sequential' },
          { ...io, occlusion_mode: 'random' },
        ],
      };
      const { exportDeckLocally } = await import('../browserExport');
      await exportDeckLocally(payload, {});
      setMessage('Test deck downloaded. Import it into Anki to check the real look on your device.');
    } catch (error) {
      setMessage(`Could not build the test deck: ${error.message || error}`);
    }
  };

  const reset = () => {
    if (window.confirm('Reset every setting on this page to its default?')) { commit(DEFAULT_SETTINGS); setMessage('Defaults restored.'); }
  };

  const a = settings.appearance;
  const b = settings.behavior;
  const device_ = DEVICES[device];

  return (
    <div className="set-page" role="dialog" aria-label="Settings">
      <header className="set-topbar">
        <button type="button" className="quiet-button" onClick={onClose}><ChevronLeft size={16} /><span>Back to editor</span></button>
        <div className="set-title"><span className="section-eyebrow">BEERUS CARD TYPES</span><h1>Settings</h1></div>
        <div className="set-top-actions">
          <button type="button" className="quiet-button" onClick={() => onOpenIcons?.()}><span>Icon maker</span></button>
          <button type="button" className="quiet-button" onClick={downloadTestDeck}><Download size={15} /><span>Test deck</span></button>
          <button type="button" className="quiet-button" onClick={() => downloadJson(settings, 'beerus-settings.json')}><Download size={15} /><span>Export settings</span></button>
          <button type="button" className="quiet-button" onClick={() => importRef.current?.click()}><Upload size={15} /><span>Import</span></button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e => { importSettings(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="quiet-button" onClick={reset}><Rotate size={15} /><span>Reset</span></button>
        </div>
      </header>
      {message && <div className="set-message" role="status">{message}</div>}

      <div className="set-layout">
        <div className="set-main">
          <Section id="set-types" title="Card types" hint="Every deck exported from this site uses these six note types, so your own note types are never touched.">
            <ul className="set-types">{Object.values(BEERUS_NAMES).map(name => <li key={name}>{name}</li>)}</ul>
            <p className="set-note">Each type has four pill fields (Pill 1–4). A pill shows on the answer side only when its field has content, so empty pills cost nothing.</p>
          </Section>

          <Section id="set-pills" title="Pills" hint="Toggle buttons under the answer for reference screenshots, comparisons, lecture notes or your own notes.">
            {settings.pills.map((pill, index) => (
              <div className="set-pill" key={index}>
                <div className="set-pill-head"><span className="set-pill-chip" style={{ background: pill.color }}>{pill.iconType === 'emoji' ? pill.icon : ''} {pill.label}</span><strong>Pill {index + 1}</strong></div>
                <Row label="Label"><input type="text" maxLength={24} value={pill.label} onChange={e => update(['pills', index, 'label'], e.target.value)} /></Row>
                <Row label="Colour"><ColorField value={pill.color} label={`Pill ${index + 1} colour`} onChange={value => update(['pills', index, 'color'], value)} /></Row>
                <Row label="Icon" hint="Emoji costs nothing. An uploaded icon is shrunk to 64 px and stored once for the whole deck. A web link adds no file at all but needs internet when you review. Need a custom one at 48 px? Use the Icon maker.">
                  <select value={pill.iconType} onChange={e => update(['pills', index, 'iconType'], e.target.value)}>
                    <option value="emoji">Emoji</option><option value="image">Upload image</option><option value="url">Image link (URL)</option><option value="none">No icon</option>
                  </select>
                  {pill.iconType === 'emoji' && <input type="text" className="set-emoji" maxLength={4} value={pill.icon} onChange={e => update(['pills', index, 'icon'], e.target.value)} aria-label="Emoji" />}
                  {pill.iconType === 'image' && <label className="set-file"><input type="file" accept="image/*" onChange={e => { uploadIcon(['pills', index, 'iconData'], e.target.files?.[0]); e.target.value = ''; }} />{pill.iconData ? <img src={pill.iconData} alt="" /> : null}<span>{pill.iconData ? 'Change' : 'Choose file'}</span></label>}
                  {pill.iconType === 'url' && <input type="url" placeholder="https://…/icon.png" value={pill.iconUrl} onChange={e => update(['pills', index, 'iconUrl'], e.target.value.trim())} />}
                </Row>
                <Row label="Content format" hint="Auto converts a ChatGPT answer (selected text) pasted into this pill. ChatGPT look also converts the Markdown from ChatGPT's Copy button and removes the pill's own frame. Plain never converts."><select value={pill.format} onChange={e => update(['pills', index, 'format'], e.target.value)} aria-label={`Pill ${index + 1} content format`}><option value="auto">Auto-detect ChatGPT</option><option value="chatgpt">ChatGPT look (always)</option><option value="plain">Plain</option></select></Row>
                <Row label="Open by default"><Toggle checked={pill.open} onChange={value => update(['pills', index, 'open'], value)} label={pill.open ? 'Starts expanded' : 'Starts collapsed'} /></Row>
              </div>
            ))}
            <Row label="Style"><select value={settings.pillStyle.style} onChange={e => update(['pillStyle', 'style'], e.target.value)}><option value="bubble">Icon bubble</option><option value="gradient">Gradient + shine</option><option value="solid">Solid</option><option value="glass">Glass</option><option value="outline">Outline</option><option value="neon">Neon</option></select></Row>
            <Row label="Pattern" hint="A subtle texture over the pill."><select value={settings.pillStyle.pattern} onChange={e => update(['pillStyle', 'pattern'], e.target.value)}><option value="none">None</option><option value="dots">Dots</option><option value="stripes">Stripes</option><option value="grid">Grid</option><option value="zigzag">Zigzag</option></select></Row>
            <Row label="Shape"><select value={settings.pillStyle.shape} onChange={e => update(['pillStyle', 'shape'], e.target.value)}><option value="pill">Round pill</option><option value="rounded">Rounded</option><option value="square">Square</option></select></Row>
            <Row label="Pill size" hint="Scales the whole pill and its text."><input type="range" min="60" max="200" step="5" value={settings.pillStyle.scale} onChange={e => update(['pillStyle', 'scale'], Number(e.target.value))} aria-label="Pill size" /><span className="set-value">{settings.pillStyle.scale}%</span></Row>
            <Row label="Icon size" hint="Size of the icon (or the icon bubble) inside each pill."><input type="range" min="70" max="220" step="5" value={settings.pillStyle.iconScale} onChange={e => update(['pillStyle', 'iconScale'], Number(e.target.value))} aria-label="Icon size" /><span className="set-value">{settings.pillStyle.iconScale}%</span></Row>
            <Row label="Icons"><Toggle checked={settings.pillStyle.showIcons} onChange={value => update(['pillStyle', 'showIcons'], value)} label="Show icons on pills" /></Row>
            <Row label="Keyboard" hint="Shift+1…4 toggles a pill, Shift+0 toggles all. Plain 1–4 stay Anki's answer buttons."><select value={b.pillShortcut} onChange={e => update(['behavior', 'pillShortcut'], e.target.value)}><option value="shift">Shift + number</option><option value="alt">Alt + number</option><option value="off">Off</option></select></Row>
            <Row label="Remember" hint="An opened pill stays open on the next card until you close it."><Toggle checked={b.rememberPills} onChange={value => update(['behavior', 'rememberPills'], value)} label="Keep pills open between cards" /></Row>
          </Section>

          <Section id="set-chatgpt" title="ChatGPT look" hint="Pasted ChatGPT answers keep ChatGPT's formatting: 16 px text, 18 px section titles, soft pill badges, 14 px tables, rounded panel. Sizes are measured from a real ChatGPT answer page; the panel colours are yours to adjust.">
            <Row label="Day panel"><span className="set-colors"><label>Background <ColorField value={settings.chatgpt.day.bg} label="Day panel background" onChange={value => update(['chatgpt', 'day', 'bg'], value)} /></label><label>Text <ColorField value={settings.chatgpt.day.text} label="Day panel text" onChange={value => update(['chatgpt', 'day', 'text'], value)} /></label></span></Row>
            <Row label="Night panel"><span className="set-colors"><label>Background <ColorField value={settings.chatgpt.night.bg} label="Night panel background" onChange={value => update(['chatgpt', 'night', 'bg'], value)} /></label><label>Text <ColorField value={settings.chatgpt.night.text} label="Night panel text" onChange={value => update(['chatgpt', 'night', 'text'], value)} /></label></span></Row>
            <Row label="Corners"><NumberField value={settings.chatgpt.radius} min={0} max={32} onChange={value => update(['chatgpt', 'radius'], value)} suffix="px" /></Row>
            <Row label="Padding"><NumberField value={settings.chatgpt.padding} min={4} max={32} onChange={value => update(['chatgpt', 'padding'], value)} suffix="px" /></Row>
            <p className="set-note">The preview's third pill (Lecture notes) is sample ChatGPT content. Paste a real answer into a pill in the editor to try it.</p>
          </Section>

          <Section id="set-watermark" title="Watermark" hint="A small icon in a corner of every card. Off by default; the note-type name already marks the deck as yours.">
            <Row label="Add to exported cards"><Toggle checked={settings.watermark.enabled} onChange={value => update(['watermark', 'enabled'], value)} label={settings.watermark.enabled ? 'On' : 'Off'} /></Row>
            <Row label="Icon">
              <select value={settings.watermark.iconType} onChange={e => update(['watermark', 'iconType'], e.target.value)}><option value="default">Built-in</option><option value="image">Upload image</option><option value="url">Image link (URL)</option></select>
              {settings.watermark.iconType === 'image' && <label className="set-file"><input type="file" accept="image/*" onChange={e => { uploadIcon(['watermark', 'iconData'], e.target.files?.[0]); e.target.value = ''; }} />{settings.watermark.iconData ? <img src={settings.watermark.iconData} alt="" /> : null}<span>{settings.watermark.iconData ? 'Change' : 'Choose file'}</span></label>}
              {settings.watermark.iconType === 'url' && <input type="url" placeholder="https://…/mark.png" value={settings.watermark.iconUrl} onChange={e => update(['watermark', 'iconUrl'], e.target.value.trim())} />}
            </Row>
            <Row label="Size"><NumberField value={settings.watermark.size} min={12} max={64} onChange={value => update(['watermark', 'size'], value)} suffix="px" /></Row>
            <Row label="Opacity"><input type="range" min="0.1" max="1" step="0.05" value={settings.watermark.opacity} onChange={e => update(['watermark', 'opacity'], Number(e.target.value))} /><span className="set-value">{Math.round(settings.watermark.opacity * 100)}%</span></Row>
            <Row label="Corner"><select value={settings.watermark.corner} onChange={e => update(['watermark', 'corner'], e.target.value)}><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-right">Top right</option><option value="top-left">Top left</option></select></Row>
          </Section>

          <Section id="set-appearance" title="Appearance" hint="The card look is built into the note type, so it works on desktop, AnkiDroid and AnkiMobile without add-ons.">
            <Row label="Font"><select value={a.fontFamily} onChange={e => update(['appearance', 'fontFamily'], e.target.value)}>{Object.entries(FONT_FAMILIES).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}</select></Row>
            <Row label="Text size" hint="One number scales the whole card (AnKing uses 28)."><NumberField value={a.fontSize} min={14} max={56} onChange={value => update(['appearance', 'fontSize'], value)} suffix="px" /></Row>
            <Row label="Line height"><NumberField value={a.lineHeight} min={1} max={2} step={0.05} onChange={value => update(['appearance', 'lineHeight'], value)} /></Row>
            <Row label="Alignment"><select value={a.align} onChange={e => update(['appearance', 'align'], e.target.value)}><option value="center">Centred</option><option value="left">Left</option></select></Row>
            <Row label="Day colours"><span className="set-colors"><label>Card <ColorField value={a.day.bg} label="Day card" onChange={value => update(['appearance', 'day', 'bg'], value)} /></label><label>Text <ColorField value={a.day.text} label="Day text" onChange={value => update(['appearance', 'day', 'text'], value)} /></label><label>Cloze <ColorField value={a.day.cloze} label="Day cloze" onChange={value => update(['appearance', 'day', 'cloze'], value)} /></label><label>Extra <ColorField value={a.day.extra} label="Day extra" onChange={value => update(['appearance', 'day', 'extra'], value)} /></label></span></Row>
            <Row label="Night colours"><span className="set-colors"><label>Card <ColorField value={a.night.bg} label="Night card" onChange={value => update(['appearance', 'night', 'bg'], value)} /></label><label>Text <ColorField value={a.night.text} label="Night text" onChange={value => update(['appearance', 'night', 'text'], value)} /></label><label>Cloze <ColorField value={a.night.cloze} label="Night cloze" onChange={value => update(['appearance', 'night', 'cloze'], value)} /></label><label>Extra <ColorField value={a.night.extra} label="Night extra" onChange={value => update(['appearance', 'night', 'extra'], value)} /></label></span></Row>
            <Row label="Extra style"><Toggle checked={a.extraItalic} onChange={value => update(['appearance', 'extraItalic'], value)} label="Italic Extra text" /></Row>
            <Row label="Image width"><NumberField value={a.imageMaxWidth} min={20} max={100} onChange={value => update(['appearance', 'imageMaxWidth'], value)} suffix="% of card" /></Row>
            <Row label="List width"><NumberField value={a.listMaxWidth} min={20} max={100} onChange={value => update(['appearance', 'listMaxWidth'], value)} suffix="% of card" /></Row>
          </Section>

          <Section id="set-behavior" title="Review behaviour" hint="Applies to the one-by-one (sequential / random) types and the answer side.">
            <Row label="Auto-flip"><Toggle checked={b.autoFlip} onChange={value => update(['behavior', 'autoFlip'], value)} label="Flip to the answer after the last reveal" /></Row>
            <Row label="Reveal next"><input type="text" className="set-key" maxLength={1} value={b.nextKey} onChange={e => update(['behavior', 'nextKey'], e.target.value || 'n')} /></Row>
            <Row label="Reveal all"><input type="text" className="set-key" maxLength={1} value={b.allKey} onChange={e => update(['behavior', 'allKey'], e.target.value || ',')} /></Row>
            <Row label="Help line"><Toggle checked={b.showHelp} onChange={value => update(['behavior', 'showHelp'], value)} label="Show the small “press N to reveal” line" /></Row>
            <Row label="Tags"><Toggle checked={b.showTags} onChange={value => update(['behavior', 'showTags'], value)} label="Show tags under the answer" /></Row>
          </Section>

          <Section id="set-export" title="Export" hint="How images are prepared when the deck is built on this device.">
            <Row label="Longest image edge" hint="Larger images are shrunk before they go into the deck."><NumberField value={settings.export.maxImageEdge} min={600} max={4000} step={100} onChange={value => update(['export', 'maxImageEdge'], value)} suffix="px" /></Row>
            <Row label="JPEG quality" hint="Lower = smaller deck."><input type="range" min="0.5" max="1" step="0.02" value={settings.export.jpegQuality} onChange={e => update(['export', 'jpegQuality'], Number(e.target.value))} /><span className="set-value">{Math.round(settings.export.jpegQuality * 100)}%</span></Row>
          </Section>
        </div>

        <aside className="set-preview" aria-label="Live preview">
          <div className="set-preview-bar">
            <select value={previewType} onChange={e => setPreviewType(e.target.value)} aria-label="Card type">{Object.entries(BEERUS_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
            <div className="set-seg" role="group" aria-label="Card side"><button type="button" aria-pressed={side === 'question'} onClick={() => setSide('question')}>Question</button><button type="button" aria-pressed={side === 'answer'} onClick={() => setSide('answer')}>Answer</button></div>
            <div className="set-seg" role="group" aria-label="Theme"><button type="button" aria-pressed={!night} onClick={() => setNight(false)}>Day</button><button type="button" aria-pressed={night} onClick={() => setNight(true)}>Night</button></div>
            <div className="set-seg" role="group" aria-label="Device">{Object.entries(DEVICES).map(([key, item]) => <button type="button" key={key} aria-pressed={device === key} onClick={() => setDevice(key)}>{item.label}</button>)}</div>
          </div>
          <div className="set-frame-wrap"><iframe title="Card preview" sandbox="allow-scripts" srcDoc={srcDoc} style={{ width: `${device_.width}px` }} /></div>
          <p className="set-note">This preview renders the same note-type HTML and CSS that the exported deck contains. Use “Test deck” to see it inside your own Anki.</p>
        </aside>
      </div>
    </div>
  );
}
