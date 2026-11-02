import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, Redo, Undo, XCircle } from './Icons';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const HISTORY_LIMIT = 40;
const TOOL_ITEMS = [
  ['select', 'Select'], ['pen', 'Pen'], ['marker', 'Marker'], ['line', 'Line'], ['arrow', 'Arrow'],
  ['rectangle', 'Box'], ['ellipse', 'Oval'], ['text', 'Text'], ['eraser', 'Erase'],
  ['mask-rect', 'Hide box'], ['mask-ellipse', 'Hide oval'], ['mask-polygon', 'Hide polygon'],
];
const KEY_TOOLS = ['pen', 'marker', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'eraser', 'mask-rect'];

function pointsString(points = []) { return points.map(point => `${point.x},${point.y}`).join(' '); }

function drawMark(context, mark, scaleX, scaleY) {
  const px = value => value * scaleX;
  const py = value => value * scaleY;
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = Math.max(1, mark.size * ((scaleX + scaleY) / 2));
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.globalAlpha = mark.type === 'marker' ? .25 : 1;
  if (mark.type === 'pen' || mark.type === 'marker') {
    context.beginPath();
    mark.points.forEach((point, index) => index ? context.lineTo(px(point.x), py(point.y)) : context.moveTo(px(point.x), py(point.y)));
    context.stroke();
  } else if (mark.type === 'line' || mark.type === 'arrow') {
    const from = mark.from, to = mark.to;
    context.beginPath(); context.moveTo(px(from.x), py(from.y)); context.lineTo(px(to.x), py(to.y)); context.stroke();
    if (mark.type === 'arrow') {
      const x1 = px(from.x), y1 = py(from.y), x2 = px(to.x), y2 = py(to.y);
      const angle = Math.atan2(y2 - y1, x2 - x1); const head = Math.max(11, mark.size * 3.5);
      context.beginPath(); context.moveTo(x2, y2);
      context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
      context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
      context.closePath(); context.fill();
    }
  } else if (mark.type === 'rectangle') {
    context.strokeRect(px(Math.min(mark.from.x, mark.to.x)), py(Math.min(mark.from.y, mark.to.y)), Math.abs(px(mark.to.x - mark.from.x)), Math.abs(py(mark.to.y - mark.from.y)));
  } else if (mark.type === 'ellipse') {
    context.beginPath(); context.ellipse(px((mark.from.x + mark.to.x) / 2), py((mark.from.y + mark.to.y) / 2), Math.abs(px(mark.to.x - mark.from.x)) / 2, Math.abs(py(mark.to.y - mark.from.y)) / 2, 0, 0, Math.PI * 2); context.stroke();
  } else if (mark.type === 'text') {
    context.globalAlpha = 1; context.font = `600 ${Math.max(16, mark.size * 5) * scaleY}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    context.shadowColor = 'rgba(255,255,255,.75)'; context.shadowBlur = 3 * scaleY; context.fillText(mark.text, px(mark.x), py(mark.y));
  }
  context.restore();
}

export default function PdfAnnotationEditor({ snip, onClose, onSave }) {
  const imageRef = useRef(null);
  const layerRef = useRef(null);
  const gestureRef = useRef(null);
  const draftFrameRef = useRef(0);
  const pendingDraftRef = useRef(null);
  const keyboardActionsRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#315c45');
  const [brushSize, setBrushSize] = useState(4);
  const [annotations, setAnnotations] = useState([]);
  const [masks, setMasks] = useState([]);
  const [selectedMasks, setSelectedMasks] = useState([]);
  const [selectedAnnotations, setSelectedAnnotations] = useState([]);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [draft, setDraft] = useState(null);
  const [mode, setMode] = useState('hide-all');
  const [history, setHistory] = useState([{ annotations: [], masks: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const remember = (nextAnnotations, nextMasks) => {
    const next = [...history.slice(0, historyIndex + 1), { annotations: nextAnnotations, masks: nextMasks }];
    if (next.length > HISTORY_LIMIT) next.splice(0, next.length - HISTORY_LIMIT);
    setHistory(next); setHistoryIndex(next.length - 1);
  };
  const undo = () => {
    if (historyIndex <= 0) return;
    const index = historyIndex - 1; setHistoryIndex(index);
    setAnnotations(history[index].annotations); setMasks(history[index].masks);
    setSelectedAnnotations([]); setSelectedMasks([]);
  };
  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const index = historyIndex + 1; setHistoryIndex(index);
    setAnnotations(history[index].annotations); setMasks(history[index].masks);
    setSelectedAnnotations([]); setSelectedMasks([]);
  };

  const pointerPosition = event => {
    const bounds = layerRef.current.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) * snip.width / bounds.width, 0, snip.width), y: clamp((event.clientY - bounds.top) * snip.height / bounds.height, 0, snip.height) };
  };

  const addMask = shape => {
    const width = snip.width, height = snip.height;
    const mask = {
      id: crypto.randomUUID(), shape: shape.kind,
      x: clamp(Math.min(shape.from.x, shape.to.x) / width, 0, 1),
      y: clamp(Math.min(shape.from.y, shape.to.y) / height, 0, 1),
      width: clamp(Math.abs(shape.to.x - shape.from.x) / width, 0, 1),
      height: clamp(Math.abs(shape.to.y - shape.from.y) / height, 0, 1),
      points: shape.points?.map(point => ({ x: point.x / width, y: point.y / height })) || undefined,
      label: '', group: null,
    };
    if (mask.shape !== 'polygon' && (mask.width < .008 || mask.height < .008)) return;
    if (mask.shape === 'polygon' && mask.points.length < 3) return;
    const nextMasks = [...masks, mask]; setMasks(nextMasks); setSelectedMasks([mask.id]); setSelectedAnnotations([]); remember(annotations, nextMasks);
  };

  const finishPolygon = (points = polygonPoints) => {
    if (points.length < 3) return;
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    addMask({ kind: 'polygon', points, from: { x: Math.min(...xs), y: Math.min(...ys) }, to: { x: Math.max(...xs), y: Math.max(...ys) } });
    setPolygonPoints([]);
  };

  const addAnnotation = mark => {
    const next = [...annotations, { ...mark, id: crypto.randomUUID() }];
    setAnnotations(next); setSelectedAnnotations([]); setSelectedMasks([]); remember(next, masks);
  };

  const onPointerDown = event => {
    if (tool === 'select') return;
    const point = pointerPosition(event);
    if (tool === 'mask-polygon') {
      const next = [...polygonPoints, point];
      if (event.detail >= 2 && next.length >= 3) finishPolygon(next);
      else setPolygonPoints(next);
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text to place on the snip');
      if (text?.trim()) addAnnotation({ type: 'text', x: point.x, y: point.y, text: text.trim(), color, size: brushSize });
      return;
    }
    layerRef.current.setPointerCapture(event.pointerId);
    gestureRef.current = { pointerId: event.pointerId, from: point, to: point, points: [point] };
    setDraft({ type: tool, from: point, to: point, points: [point] });
  };

  const onPointerMove = event => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = pointerPosition(event);
    gesture.to = point;
    if (tool === 'pen' || tool === 'marker' || tool === 'eraser') gesture.points.push(point);
    pendingDraftRef.current = { type: tool, from: gesture.from, to: point, points: [...gesture.points] };
    if (!draftFrameRef.current) draftFrameRef.current = requestAnimationFrame(() => { setDraft(pendingDraftRef.current); draftFrameRef.current = 0; });
  };

  const onPointerUp = event => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const to = gesture.to || pointerPosition(event);
    gestureRef.current = null;
    cancelAnimationFrame(draftFrameRef.current); draftFrameRef.current = 0; pendingDraftRef.current = null; setDraft(null);
    if (tool === 'mask-rect' || tool === 'mask-ellipse') {
      addMask({ kind: tool === 'mask-ellipse' ? 'ellipse' : 'rect', from: gesture.from, to }); return;
    }
    if (tool === 'eraser') {
      const tolerance = Math.max(snip.width, snip.height) * .012;
      const keep = annotations.filter(mark => {
        const x = mark.type === 'text' ? mark.x : (mark.from?.x ?? mark.points?.[0]?.x ?? 0);
        const y = mark.type === 'text' ? mark.y : (mark.from?.y ?? mark.points?.[0]?.y ?? 0);
        return Math.hypot(x - to.x, y - to.y) > tolerance;
      });
      if (keep.length !== annotations.length) { setAnnotations(keep); setSelectedAnnotations([]); remember(keep, masks); }
      return;
    }
    const mark = { type: tool, from: gesture.from, to, points: gesture.points, color, size: brushSize };
    if (tool === 'pen' || tool === 'marker') mark.points = gesture.points;
    addAnnotation(mark);
  };

  const removeSelected = () => {
    const nextAnnotations = annotations.filter(mark => !selectedAnnotations.includes(mark.id));
    const nextMasks = masks.filter(mask => !selectedMasks.includes(mask.id));
    if (nextAnnotations.length !== annotations.length || nextMasks.length !== masks.length) {
      setAnnotations(nextAnnotations); setMasks(nextMasks); remember(nextAnnotations, nextMasks);
    }
    setSelectedAnnotations([]); setSelectedMasks([]);
  };

  const updateLabel = (id, label) => {
    setMasks(previous => {
      const next = previous.map(mask => mask.id === id ? { ...mask, label } : mask);
      return next;
    });
  };
  const groupSelected = () => {
    if (selectedMasks.length < 2) return;
    const group = crypto.randomUUID();
    const next = masks.map(mask => selectedMasks.includes(mask.id) ? { ...mask, group } : mask);
    setMasks(next); remember(annotations, next);
  };
  const ungroupSelected = () => {
    const next = masks.map(mask => selectedMasks.includes(mask.id) ? { ...mask, group: null } : mask);
    setMasks(next); remember(annotations, next);
  };

  const finish = () => {
    const image = imageRef.current;
    if (!image?.complete || !image.naturalWidth) return;
    const scale = Math.min(1, Math.sqrt(8_000_000 / Math.max(1, image.naturalWidth * image.naturalHeight)));
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(image.naturalWidth * scale)); output.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = output.getContext('2d'); context.drawImage(image, 0, 0, output.width, output.height);
    const scaleX = output.width / snip.width, scaleY = output.height / snip.height;
    annotations.forEach(mark => drawMark(context, mark, scaleX, scaleY));
    onSave({ ...snip, image: output.toDataURL('image/jpeg', .93), width: output.width, height: output.height, masks, mode, id: crypto.randomUUID() });
  };
  keyboardActionsRef.current = { finish, redo, removeSelected, undo };

  useEffect(() => () => cancelAnimationFrame(draftFrameRef.current), []);

  useEffect(() => {
    const handler = event => {
      const isTextField = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select,[contenteditable="true"]'));
      if (isTextField) {
        if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); keyboardActionsRef.current.finish(); return; }
        if ((event.ctrlKey || event.metaKey) && !['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (event.ctrlKey || event.metaKey) event.stopImmediatePropagation();
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); event.stopImmediatePropagation(); event.shiftKey ? keyboardActionsRef.current.redo() : keyboardActionsRef.current.undo(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); event.stopImmediatePropagation(); keyboardActionsRef.current.redo(); return; }
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); keyboardActionsRef.current.finish(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setTool('select'); setPolygonPoints([]); setDraft(null); gestureRef.current = null; return; }
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); event.stopImmediatePropagation(); if (selectedAnnotations.length || selectedMasks.length) keyboardActionsRef.current.removeSelected(); return; }
      if (tool === 'select' && /^[1-9]$/.test(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); setTool(KEY_TOOLS[Number(event.key) - 1]); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [tool, selectedAnnotations.length, selectedMasks.length, history, historyIndex, masks, annotations, mode, snip, onSave]);

  const renderMark = mark => {
    const selected = selectedAnnotations.includes(mark.id);
    const common = { key: mark.id, className: selected ? 'annotation-mark selected' : 'annotation-mark', stroke: mark.color, strokeWidth: mark.size, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke', opacity: mark.type === 'marker' ? .28 : 1, pointerEvents: tool === 'select' ? 'visiblePainted' : 'none', onPointerDown: event => { if (tool === 'select') { event.stopPropagation(); setSelectedAnnotations(previous => previous.includes(mark.id) ? previous.filter(id => id !== mark.id) : [...previous, mark.id]); setSelectedMasks([]); } } };
    if (mark.type === 'pen' || mark.type === 'marker') return <polyline {...common} fill="none" points={pointsString(mark.points)} />;
    if (mark.type === 'line' || mark.type === 'arrow') return <line {...common} x1={mark.from.x} y1={mark.from.y} x2={mark.to.x} y2={mark.to.y} markerEnd={mark.type === 'arrow' ? 'url(#annotation-arrow)' : undefined} />;
    if (mark.type === 'rectangle') return <rect {...common} fill="none" x={Math.min(mark.from.x, mark.to.x)} y={Math.min(mark.from.y, mark.to.y)} width={Math.abs(mark.to.x - mark.from.x)} height={Math.abs(mark.to.y - mark.from.y)} />;
    if (mark.type === 'ellipse') return <ellipse {...common} fill="none" cx={(mark.from.x + mark.to.x) / 2} cy={(mark.from.y + mark.to.y) / 2} rx={Math.abs(mark.to.x - mark.from.x) / 2} ry={Math.abs(mark.to.y - mark.from.y) / 2} />;
    return <text {...common} fill={mark.color} stroke="none" x={mark.x} y={mark.y} fontSize={Math.max(16, mark.size * 5)} fontWeight="600">{mark.text}</text>;
  };

  const renderDraft = () => {
    if (!draft) return null;
    const style = { stroke: draft.type === 'mask-rect' || draft.type === 'mask-ellipse' ? '#262e27' : color, strokeWidth: draft.type === 'marker' ? brushSize * 4 : brushSize, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke', fill: 'none', pointerEvents: 'none' };
    if (draft.type === 'pen' || draft.type === 'marker') return <polyline {...style} points={pointsString(draft.points)} opacity={draft.type === 'marker' ? .28 : 1} />;
    if (draft.type === 'line' || draft.type === 'arrow') return <line {...style} x1={draft.from.x} y1={draft.from.y} x2={draft.to.x} y2={draft.to.y} markerEnd={draft.type === 'arrow' ? 'url(#annotation-arrow)' : undefined} />;
    if (draft.type === 'rectangle' || draft.type === 'mask-rect') return <rect {...style} x={Math.min(draft.from.x, draft.to.x)} y={Math.min(draft.from.y, draft.to.y)} width={Math.abs(draft.to.x - draft.from.x)} height={Math.abs(draft.to.y - draft.from.y)} />;
    if (draft.type === 'ellipse' || draft.type === 'mask-ellipse') return <ellipse {...style} cx={(draft.from.x + draft.to.x) / 2} cy={(draft.from.y + draft.to.y) / 2} rx={Math.abs(draft.to.x - draft.from.x) / 2} ry={Math.abs(draft.to.y - draft.from.y) / 2} />;
    return null;
  };

  return (
    <div className="snip-modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="snip-editor" role="dialog" aria-modal="true" aria-label="Annotate PDF snip">
        <header className="snip-editor-header"><div><p className="section-eyebrow">SNIP · PAGE {snip.page}</p><h2>Mark up your capture</h2></div><button className="snip-close" onClick={onClose} aria-label="Close annotation editor"><XCircle size={19} /></button></header>
        <div className="annotation-toolbar">
          {TOOL_ITEMS.map(([value, label]) => {
            const shortcut = KEY_TOOLS.indexOf(value) + 1;
            return <button key={value} className={tool === value ? 'active' : ''} aria-pressed={tool === value} title={`${label}${shortcut ? ` · ${shortcut} when Select is active` : ''}`} onClick={() => setTool(value)}>{shortcut > 0 && <kbd>{shortcut}</kbd>}{label}</button>;
          })}
          <span className="annotation-separator" />
          <button onClick={undo} disabled={historyIndex <= 0} title="Undo (Ctrl/⌘ Z)"><Undo size={16} /></button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo (Ctrl/⌘ Y)"><Redo size={16} /></button>
          <button onClick={removeSelected} disabled={!selectedMasks.length && !selectedAnnotations.length} title="Delete selected (Delete)"><Eraser size={16} /></button>
          <button onClick={groupSelected} disabled={selectedMasks.length < 2} title="Group selected masks">Group</button>
          <button onClick={ungroupSelected} disabled={!masks.some(mask => selectedMasks.includes(mask.id) && mask.group)} title="Ungroup selected masks">Ungroup</button>
          {polygonPoints.length >= 3 && <button className="active" onClick={() => finishPolygon()}>Finish polygon</button>}
          <label className="annotation-color" title="Ink color"><input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
          <label className="brush-size" title="Stroke size"><span>Size</span><input type="range" min="1" max="8" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} /></label>
        </div>
        <div className="annotation-body">
          <div className="annotation-canvas-scroll">
            <div className="annotation-canvas-wrap" style={{ aspectRatio: `${snip.width} / ${snip.height}` }}>
              <img ref={imageRef} src={snip.image} alt="Selected PDF region" draggable="false" />
              <div ref={layerRef} className={`annotation-input-layer ${tool === 'select' ? 'is-select' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
              <svg viewBox={`0 0 ${snip.width} ${snip.height}`} className="annotation-vector-layer" aria-label="Vector annotation layer" onPointerDown={event => { if (tool === 'select' && event.target === event.currentTarget) { setSelectedAnnotations([]); setSelectedMasks([]); } }}>
                <defs><marker id="annotation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>
                {annotations.map(renderMark)}{renderDraft()}
                {polygonPoints.length > 0 && <polyline className="polygon-preview" vectorEffect="non-scaling-stroke" points={pointsString(polygonPoints)} />}
                {masks.map((mask, index) => {
                  const x = mask.x * snip.width, y = mask.y * snip.height, width = mask.width * snip.width, height = mask.height * snip.height;
                  const common = { key: mask.id, className: selectedMasks.includes(mask.id) ? 'occlusion-mask selected' : 'occlusion-mask', fill: 'rgba(37,47,39,.9)', stroke: selectedMasks.includes(mask.id) ? '#cf9050' : 'rgba(255,255,255,.88)', strokeWidth: selectedMasks.includes(mask.id) ? 2.5 : 1.5, vectorEffect: 'non-scaling-stroke', pointerEvents: tool === 'select' ? 'visiblePainted' : 'none', onPointerDown: event => { if (tool === 'select') { event.stopPropagation(); setSelectedMasks(previous => previous.includes(mask.id) ? previous.filter(id => id !== mask.id) : [...previous, mask.id]); setSelectedAnnotations([]); } } };
                  if (mask.shape === 'ellipse') return <ellipse {...common} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
                  if (mask.shape === 'polygon') return <polygon {...common} points={(mask.points || []).map(point => `${point.x * snip.width},${point.y * snip.height}`).join(' ')} />;
                  return <g key={mask.id}><rect {...common} x={x} y={y} width={width} height={height} /><text className="mask-number" x={x + 5} y={y + 15} pointerEvents="none">{index + 1}</text></g>;
                })}
              </svg>
            </div>
          </div>
          <aside className="annotation-options">
            <label className="annotation-mode-label">Occlusion mode</label>
            <button className={`mode-option ${mode === 'hide-all' ? 'selected' : ''}`} onClick={() => setMode('hide-all')}><span className="mode-visual mode-all"><i /><i /><i /></span><span><strong>Hide All, Guess One</strong><small>Reveal one region at a time</small></span></button>
            <button className={`mode-option ${mode === 'hide-one' ? 'selected' : ''}`} onClick={() => setMode('hide-one')}><span className="mode-visual mode-one"><i /></span><span><strong>Hide One, Guess One</strong><small>Hide a single region per card</small></span></button>
            <div className="mask-count">{masks.length} {masks.length === 1 ? 'region' : 'regions'} · {new Set(masks.map(mask => mask.group).filter(Boolean)).size + masks.filter(mask => !mask.group).length} cards</div>
            {masks.length > 0 && <div className="mask-label-list"><h3>Region labels</h3>{masks.map((mask, index) => <label key={mask.id}><span>{String(index + 1).padStart(2, '0')}</span><input value={mask.label} onChange={event => updateLabel(mask.id, event.target.value)} placeholder={`Region ${index + 1}`} /></label>)}</div>}
            <p className="annotation-tip">Select · draw · number keys 1–9 switch tools · Enter saves · Esc returns to Select.</p>
          </aside>
        </div>
        <footer className="snip-editor-footer"><p>{masks.length ? 'Each separate region creates a review card.' : 'Markup stays crisp while you work; saved captures retain high resolution.'}</p><button className="snip-save-button" onClick={finish}><Check size={16} /> Save snip <kbd>Enter</kbd></button></footer>
      </section>
    </div>
  );
}
