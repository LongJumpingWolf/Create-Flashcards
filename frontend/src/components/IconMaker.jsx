import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, saveSettings } from '../beerus';
import { ChevronLeft, Download } from './Icons';

// Logical canvas: everything is drawn in a 256 x 256 space and scaled to the pixel size needed
// (preview 512 px, exports 24-128 px), so the icon looks identical at every size.
const L = 256;
const VIEW = 512;
const SIZES = [24, 32, 48, 64, 96, 128];
const RECOMMENDED = 48;

// Simple built-in glyphs (24 x 24 grid, filled with the content colour).
const GLYPHS = {
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H6a2 2 0 0 0-2 2V4.5ZM6 19h13v2H6a1 1 0 0 1 0-2Z',
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8L12 2.5Z',
  heart: 'M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z',
  drop: 'M12 2.5s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.5 12 2.5 12 2.5Z',
  bolt: 'M13 2 4.5 13.5H11L10 22l9-12h-6.5L13 2Z',
  flask: 'M9 2h6v2h-1v5.2l5.4 9A2 2 0 0 1 17.7 21H6.3a2 2 0 0 1-1.7-2.8L10 9.2V4H9V2Z',
  note: 'M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM7 12h10v1.6H7V12Zm0 3.5h10v1.6H7v-1.6Z',
  check: 'M9.2 16.6 4.9 12.3l-1.9 1.9 6.2 6.2L21 8.6l-1.9-1.9-9.9 9.9Z',
  plus: 'M10.5 3h3v7.5H21v3h-7.5V21h-3v-7.5H3v-3h7.5V3Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 5h2.4v2.4h-2.4V7Zm0 4.2h2.4V17h-2.4v-5.8Z',
  eye: 'M12 5C6.5 5 2.3 9 1 12c1.3 3 5.5 7 11 7s9.7-4 11-7c-1.3-3-5.5-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  bone: 'M7 3a3 3 0 0 0-2.6 4.5A3 3 0 0 0 7 12.5l.8-.8 8.4 8.4-.8.8a3 3 0 1 0 4.1 4.1 3 3 0 0 0-1.6-5l-.3-.3 1.6-1.6-.3-.3a3 3 0 0 0-5-1.6 3 3 0 0 0 .6-3.7l-.5-.5L7 3Z',
};

const DEFAULTS = {
  bg: { type: 'solid', c1: '#3B82F6', c2: '#1D4ED8' },
  shape: 'circle',
  border: { width: 0, color: '#FFFFFF' },
  content: { kind: 'emoji', emoji: '📖', text: 'P', font: 'Arial', color: '#FFFFFF', glyph: 'book', x: 0, y: 0, scale: 1, rotate: 0 },
};

function clipShape(ctx, shape) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(L / 2, L / 2, L / 2 - 1, 0, Math.PI * 2);
  else if (shape === 'rounded') ctx.roundRect(2, 2, L - 4, L - 4, 56);
  else ctx.rect(0, 0, L, L);
  ctx.closePath();
}

function drawIcon(ctx, px, state, image, doodle) {
  ctx.save();
  ctx.clearRect(0, 0, px, px);
  ctx.scale(px / L, px / L);
  clipShape(ctx, state.shape);
  ctx.save();
  ctx.clip();
  if (state.bg.type === 'solid') { ctx.fillStyle = state.bg.c1; ctx.fillRect(0, 0, L, L); }
  else if (state.bg.type === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, L, L);
    gradient.addColorStop(0, state.bg.c1); gradient.addColorStop(1, state.bg.c2);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, L, L);
  }
  const c = state.content;
  ctx.save();
  ctx.translate(L / 2 + c.x * L, L / 2 + c.y * L);
  ctx.rotate((c.rotate * Math.PI) / 180);
  ctx.scale(c.scale, c.scale);
  ctx.fillStyle = c.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (c.kind === 'emoji') {
    ctx.font = `${L * 0.62}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(c.emoji || '', 0, L * 0.03);
  } else if (c.kind === 'text') {
    ctx.font = `700 ${L * 0.6}px ${c.font}, sans-serif`;
    ctx.fillText((c.text || '').slice(0, 3), 0, L * 0.03);
  } else if (c.kind === 'glyph') {
    const k = (L * 0.62) / 24;
    ctx.scale(k, k);
    ctx.translate(-12, -12);
    ctx.fill(new Path2D(GLYPHS[c.glyph] || GLYPHS.star));
  } else if (c.kind === 'image' && image) {
    const fit = Math.min((L * 0.86) / image.width, (L * 0.86) / image.height);
    ctx.drawImage(image, (-image.width * fit) / 2, (-image.height * fit) / 2, image.width * fit, image.height * fit);
  }
  ctx.restore();
  if (doodle) ctx.drawImage(doodle, 0, 0, L, L);
  ctx.restore();
  if (state.border.width > 0) {
    clipShape(ctx, state.shape);
    ctx.lineWidth = state.border.width * 2;
    ctx.strokeStyle = state.border.color;
    ctx.save(); ctx.clip(); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

function renderDoodle(canvas, strokes) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / L, canvas.height / L);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokes.forEach(stroke => {
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size; ctx.fillStyle = stroke.color;
    ctx.beginPath();
    stroke.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (stroke.points.length === 1) { ctx.arc(stroke.points[0][0], stroke.points[0][1], stroke.size / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
  });
  ctx.restore();
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
const blobToDataUrl = (blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
const formatKb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

export default function IconMaker({ onClose }) {
  const [state, setState] = useState(DEFAULTS);
  const [tool, setTool] = useState('move'); // move | brush | eraser
  const [brush, setBrush] = useState({ color: '#FFFFFF', size: 10 });
  const [strokes, setStrokes] = useState([]);
  const [image, setImage] = useState(null);
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(0.8);
  const [size, setSize] = useState(RECOMMENDED);
  const [sizes, setSizes] = useState({});
  const [message, setMessage] = useState('');
  const [dark, setDark] = useState(true);
  const [settings, setSettings] = useState(() => loadSettings());
  const viewRef = useRef(null);
  const doodleRef = useRef(null);
  const dragRef = useRef(null);

  // Esc leaves this page (unless a field is being typed in).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!doodleRef.current && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = VIEW; canvas.height = VIEW;
    doodleRef.current = canvas;
  }

  const set = (path, value) => setState(prev => {
    const next = structuredClone(prev);
    let cursor = next;
    for (let i = 0; i < path.length - 1; i += 1) cursor = cursor[path[i]];
    cursor[path[path.length - 1]] = value;
    return next;
  });

  // Draw the large preview whenever anything changes.
  useEffect(() => {
    const canvas = viewRef.current;
    if (!canvas) return;
    renderDoodle(doodleRef.current, strokes);
    drawIcon(canvas.getContext('2d'), VIEW, state, image, doodleRef.current);
  }, [state, image, strokes]);

  const mime = format === 'webp' ? 'image/webp' : 'image/png';
  const encode = useCallback(async (px) => {
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    renderDoodle(doodleRef.current, strokes);
    drawIcon(canvas.getContext('2d'), px, state, image, doodleRef.current);
    return toBlob(canvas, mime, format === 'webp' ? quality : undefined);
  }, [state, image, strokes, mime, format, quality]);

  // Live file sizes for every export size (debounced).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = {};
      for (const px of SIZES) {
        const blob = await encode(px);
        if (cancelled) return;
        result[px] = blob ? blob.size : 0;
      }
      setSizes(result);
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [encode]);

  const point = (event) => {
    const rect = viewRef.current.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * L, ((event.clientY - rect.top) / rect.height) * L];
  };

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = point(event);
    if (tool === 'move') dragRef.current = { x, y, cx: state.content.x, cy: state.content.y };
    else {
      const stroke = { color: brush.color, size: brush.size, erase: tool === 'eraser', points: [[x, y]] };
      dragRef.current = { stroke };
      setStrokes(prev => [...prev, stroke]);
    }
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = point(event);
    if (drag.stroke) {
      drag.stroke.points.push([x, y]);
      setStrokes(prev => [...prev]);
    } else {
      set(['content', 'x'], Math.max(-0.6, Math.min(0.6, drag.cx + (x - drag.x) / L)));
      set(['content', 'y'], Math.max(-0.6, Math.min(0.6, drag.cy + (y - drag.y) / L)));
    }
  };
  const onPointerUp = () => { dragRef.current = null; };

  const loadImage = async (file) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      setImage(bitmap);
      set(['content', 'kind'], 'image');
      setMessage('');
    } catch {
      setMessage('That image could not be read. Try a PNG, JPG, SVG or WebP file.');
    }
  };

  const download = async (px = size) => {
    const blob = await encode(px);
    if (!blob) { setMessage('Could not encode the icon.'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `pill-icon-${px}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const applyTo = async (target) => {
    const blob = await encode(size);
    if (!blob) { setMessage('Could not encode the icon.'); return; }
    const dataUrl = await blobToDataUrl(blob);
    const next = loadSettings();
    if (target === 'watermark') { next.watermark.iconType = 'image'; next.watermark.iconData = dataUrl; }
    else { next.pills[target].iconType = 'image'; next.pills[target].iconData = dataUrl; }
    if (saveSettings(next)) {
      setSettings(next);
      setMessage(`Saved as the ${target === 'watermark' ? 'watermark' : `Pill ${target + 1}`} icon (${size} px, ${formatKb(blob.size)}). It goes into a deck once, however many cards use it.`);
    } else setMessage('Could not save in this browser (storage is full or blocked).');
  };

  const reset = () => { setState(DEFAULTS); setStrokes([]); setImage(null); setTool('move'); setMessage(''); };
  const undo = () => setStrokes(prev => prev.slice(0, -1));
  const bytes = sizes[size] || 0;
  const content = state.content;
  const previewPills = useMemo(() => settings.pills, [settings]);

  return (
    <div className="set-page icon-page" role="dialog" aria-label="Pill icon maker">
      <header className="set-topbar">
        <button type="button" className="quiet-button" onClick={onClose}><ChevronLeft size={16} /><span>Back</span></button>
        <div className="set-title"><span className="section-eyebrow">BEERUS TOOLS</span><h1>Pill icon maker</h1></div>
        <div className="set-top-actions">
          <button type="button" className="quiet-button" onClick={undo} disabled={!strokes.length}>Undo stroke</button>
          <button type="button" className="quiet-button" onClick={reset}>Reset</button>
        </div>
      </header>
      {message && <div className="set-message" role="status">{message}</div>}

      <div className="set-layout icon-layout">
        <div className="set-main">
          <section className="set-section">
            <header><h2>Why small?</h2><p>A pill icon is stored once per deck and shown on every card that uses that pill. Keep it at {RECOMMENDED} px (about 1-3 KB) and the deck does not grow noticeably, even with thousands of cards. Only an image link (no file at all) is lighter, and that needs internet during review.</p></header>
          </section>

          <section className="set-section">
            <header><h2>Design</h2></header>
            <div className="set-section-body">
              <div className="set-row"><div className="set-row-label"><span>Content</span></div><div className="set-row-control">
                {['emoji', 'text', 'glyph', 'image'].map(kind => <button type="button" key={kind} className={`icon-chip ${content.kind === kind ? 'on' : ''}`} onClick={() => set(['content', 'kind'], kind)}>{kind}</button>)}
              </div></div>
              {content.kind === 'emoji' && <div className="set-row"><div className="set-row-label"><span>Emoji</span><small>Type or paste one.</small></div><div className="set-row-control"><input type="text" className="set-emoji" value={content.emoji} maxLength={4} onChange={e => set(['content', 'emoji'], e.target.value)} aria-label="Emoji" /></div></div>}
              {content.kind === 'text' && <div className="set-row"><div className="set-row-label"><span>Letters</span><small>1-3 characters.</small></div><div className="set-row-control"><input type="text" value={content.text} maxLength={3} onChange={e => set(['content', 'text'], e.target.value)} aria-label="Letters" /><select value={content.font} onChange={e => set(['content', 'font'], e.target.value)}>{['Arial', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS'].map(font => <option key={font}>{font}</option>)}</select></div></div>}
              {content.kind === 'glyph' && <div className="set-row"><div className="set-row-label"><span>Shape</span></div><div className="set-row-control icon-glyphs">{Object.keys(GLYPHS).map(name => <button type="button" key={name} aria-label={name} title={name} className={`icon-glyph ${content.glyph === name ? 'on' : ''}`} onClick={() => set(['content', 'glyph'], name)}><svg viewBox="0 0 24 24" width="22" height="22"><path d={GLYPHS[name]} fill="currentColor" /></svg></button>)}</div></div>}
              {content.kind === 'image' && <div className="set-row"><div className="set-row-label"><span>Picture</span><small>Drag it on the canvas to move it.</small></div><div className="set-row-control"><label className="set-file"><input type="file" accept="image/*" onChange={e => { loadImage(e.target.files?.[0]); e.target.value = ''; }} /><span>{image ? 'Change picture' : 'Choose picture'}</span></label></div></div>}
              {(content.kind === 'text' || content.kind === 'glyph') && <div className="set-row"><div className="set-row-label"><span>Colour</span></div><div className="set-row-control"><input type="color" value={content.color} onChange={e => set(['content', 'color'], e.target.value.toUpperCase())} aria-label="Content colour" /></div></div>}
              <div className="set-row"><div className="set-row-label"><span>Size</span></div><div className="set-row-control"><input type="range" min="0.4" max="1.8" step="0.02" value={content.scale} onChange={e => set(['content', 'scale'], Number(e.target.value))} aria-label="Content size" /></div></div>
              <div className="set-row"><div className="set-row-label"><span>Rotate</span></div><div className="set-row-control"><input type="range" min="-180" max="180" step="1" value={content.rotate} onChange={e => set(['content', 'rotate'], Number(e.target.value))} aria-label="Rotation" /><button type="button" className="icon-chip" onClick={() => { set(['content', 'x'], 0); set(['content', 'y'], 0); }}>Centre</button></div></div>
              <div className="set-row"><div className="set-row-label"><span>Background</span></div><div className="set-row-control">
                <select value={state.bg.type} onChange={e => set(['bg', 'type'], e.target.value)} aria-label="Background type"><option value="solid">Solid</option><option value="gradient">Gradient</option><option value="transparent">Transparent</option></select>
                {state.bg.type !== 'transparent' && <input type="color" value={state.bg.c1} onChange={e => set(['bg', 'c1'], e.target.value.toUpperCase())} aria-label="Background colour" />}
                {state.bg.type === 'gradient' && <input type="color" value={state.bg.c2} onChange={e => set(['bg', 'c2'], e.target.value.toUpperCase())} aria-label="Gradient end colour" />}
              </div></div>
              <div className="set-row"><div className="set-row-label"><span>Outline</span></div><div className="set-row-control"><select value={state.shape} onChange={e => set(['shape'], e.target.value)} aria-label="Shape"><option value="circle">Circle</option><option value="rounded">Rounded square</option><option value="square">Square</option></select><input type="range" min="0" max="16" step="1" value={state.border.width} onChange={e => set(['border', 'width'], Number(e.target.value))} aria-label="Outline width" /><input type="color" value={state.border.color} onChange={e => set(['border', 'color'], e.target.value.toUpperCase())} aria-label="Outline colour" /></div></div>
            </div>
          </section>

          <section className="set-section">
            <header><h2>Doodle</h2><p>Draw on top of the icon. Pick Move to drag the content again.</p></header>
            <div className="set-section-body">
              <div className="set-row"><div className="set-row-label"><span>Tool</span></div><div className="set-row-control">
                {['move', 'brush', 'eraser'].map(name => <button type="button" key={name} className={`icon-chip ${tool === name ? 'on' : ''}`} onClick={() => setTool(name)}>{name}</button>)}
                <input type="color" value={brush.color} onChange={e => setBrush(prev => ({ ...prev, color: e.target.value.toUpperCase() }))} aria-label="Brush colour" />
                <input type="range" min="2" max="40" value={brush.size} onChange={e => setBrush(prev => ({ ...prev, size: Number(e.target.value) }))} aria-label="Brush size" />
              </div></div>
            </div>
          </section>
        </div>

        <aside className="set-preview icon-side">
          <div className="icon-stage">
            <canvas ref={viewRef} width={VIEW} height={VIEW} className={`icon-canvas tool-${tool}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-label="Icon canvas" />
          </div>
          <section className="set-section">
            <header><h2>Export</h2></header>
            <div className="set-section-body">
              <div className="set-row"><div className="set-row-label"><span>Format</span><small>WebP is smaller; PNG works everywhere.</small></div><div className="set-row-control">
                <select value={format} onChange={e => setFormat(e.target.value)} aria-label="Format"><option value="png">PNG (lossless)</option><option value="webp">WebP (smaller)</option></select>
                {format === 'webp' && <input type="range" min="0.4" max="1" step="0.05" value={quality} onChange={e => setQuality(Number(e.target.value))} aria-label="WebP quality" />}
              </div></div>
              <div className="icon-sizes" role="radiogroup" aria-label="Export size">
                {SIZES.map(px => (
                  <button type="button" key={px} role="radio" aria-checked={size === px} className={`icon-size ${size === px ? 'on' : ''}`} onClick={() => setSize(px)}>
                    <canvas width={px} height={px} ref={node => { if (node) { renderDoodle(doodleRef.current, strokes); drawIcon(node.getContext('2d'), px, state, image, doodleRef.current); } }} style={{ width: Math.min(px, 64), height: Math.min(px, 64) }} />
                    <strong>{px} px</strong><small>{sizes[px] ? formatKb(sizes[px]) : '…'}{px === RECOMMENDED ? ' · best' : ''}</small>
                  </button>
                ))}
              </div>
              <p className="set-note">Selected: <strong>{size} px {format.toUpperCase()}</strong>, {bytes ? formatKb(bytes) : '…'}.</p>
              <div className="set-row-control icon-actions">
                <button type="button" className="primary-button" onClick={() => download()}><Download size={15} /><span>Download</span></button>
              </div>
              <div className="icon-use">
                <span>Use as icon for</span>
                {previewPills.map((pill, index) => <button type="button" key={index} className="icon-chip" onClick={() => applyTo(index)}><i style={{ background: pill.color }} />{pill.label}</button>)}
                <button type="button" className="icon-chip" onClick={() => applyTo('watermark')}>Watermark</button>
              </div>
              <div className={`icon-pill-preview ${dark ? 'dark' : 'light'}`}>
                <button type="button" className="icon-chip" onClick={() => setDark(value => !value)}>{dark ? 'Night' : 'Day'}</button>
                {previewPills.map((pill, index) => (
                  <span key={index} className="icon-pill" style={{ background: pill.color }}>
                    {pill.iconType === 'image' && pill.iconData ? <img src={pill.iconData} alt="" /> : pill.iconType === 'emoji' ? pill.icon : null}
                    {pill.label}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
