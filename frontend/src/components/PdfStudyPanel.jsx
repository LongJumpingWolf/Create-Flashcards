import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BookOpen, ChevronLeft, ChevronRight, Crop, FileText, Minus, PlusCircle, XCircle } from './Icons';
import PdfAnnotationEditor from './PdfAnnotationEditor';
import PillButtons from './PillButtons';
import { forgetSavedPdf, readSavedPdf, rememberPdf, savePdfProgress } from '../pdfResumeStorage';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MIN_ZOOM = .55;
const MAX_ZOOM = 3.5;
const VIEW_PAD = 14;
const MAX_CANVAS_PIXELS = 12_000_000;
const RANGE_CHUNK_SIZE = 256 * 1024;
const INSERT_PROMPT_STYLE = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1100, display: 'grid', placeItems: 'center', padding: 14, background: 'rgba(3,7,4,.74)', backdropFilter: 'blur(8px)' },
  panel: { boxSizing: 'border-box', width: 'min(420px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 12, padding: 17, border: '1px solid rgba(199,220,204,.14)', borderRadius: 15, background: '#141b16', color: '#e6ede7', boxShadow: '0 24px 80px rgba(0,0,0,.5)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { margin: 0, color: '#91a094', fontSize: 10, fontWeight: 750, letterSpacing: '.13em' },
  title: { margin: '4px 0 0', color: '#e6ede7', fontSize: 17, fontWeight: 650 },
  close: { width: 34, height: 34, display: 'grid', placeItems: 'center', flex: 'none', border: '1px solid rgba(199,220,204,.14)', borderRadius: 9, background: '#1a231d', color: '#d4e0d6' },
  image: { display: 'block', width: '100%', maxHeight: '38dvh', boxSizing: 'border-box', objectFit: 'contain', border: '1px solid rgba(199,220,204,.1)', borderRadius: 9, background: '#0d130f' },
  description: { margin: 0, color: '#9ba99d', fontSize: 12 },
  options: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  option: { minWidth: 0, minHeight: 43, padding: '0 10px', border: '1px solid rgba(199,220,204,.14)', borderRadius: 9, background: '#213127', color: '#dce9de', fontWeight: 650, cursor: 'pointer' },
  choice: { minWidth: 0, display: 'flex', gap: 5 },
  key: { minWidth: 20, height: 20, display: 'inline-grid', placeItems: 'center', border: '1px solid rgba(199,220,204,.18)', borderRadius: 5, color: '#9cab9e', fontSize: 10, fontWeight: 600 },
  occlusion: { width: 43, minWidth: 43, minHeight: 43, display: 'grid', placeItems: 'center', border: '1px solid rgba(129,190,144,.28)', borderRadius: 9, background: '#1e3425', color: '#b9dfc1', cursor: 'pointer' },
};

export default function PdfStudyPanel({ onInsertSnippet, fieldOptions = [{ target: 'front', label: 'Front' }, { target: 'back', label: 'Back' }], isSmallScreen = false, onMobileView, incomingFile = null, pillOptions = [] }) {
  const fileInputRef = useRef(null);
  const hostRef = useRef(null);
  const pagePositionRef = useRef(null);
  const pageStageRef = useRef(null);
  const pageCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const docRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const sourceUrlRef = useRef(null);
  const sourceFileRef = useRef(null);
  const loadPdfFileRef = useRef(null);
  const renderedPageRef = useRef(null);
  const displayedPageRef = useRef(null);
  const highQualityPageRef = useRef(null);
  const loadTokenRef = useRef(0);
  const zoomRef = useRef(1);
  const viewRef = useRef({ x: 0, y: 0, s: 1 });
  const renderedZoomRef = useRef(1);
  const zoomAnimRef = useRef(0);
  const zoomTargetRef = useRef(1);
  const needsPlaceRef = useRef(true);
  const pdfInteractionActiveRef = useRef(false);
  const captureIntentRef = useRef('normal');
  const snipTouchStartRef = useRef(null);
  const captureSnipRef = useRef(null);
  const touchSnippetDragRef = useRef(null);
  const pdfStoredRef = useRef(false);
  const rememberTokenRef = useRef(0);
  const progressSaveTokenRef = useRef(0);
  const [pdfName, setPdfName] = useState('');
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDraft, setPageDraft] = useState(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [snipping, setSnipping] = useState(false);
  const [snipIntent, setSnipIntent] = useState('normal');
  const [selection, setSelection] = useState(null);
  const [snipStart, setSnipStart] = useState(null);
  const [pendingSnip, setPendingSnip] = useState(null);
  const [targetPromptSnip, setTargetPromptSnip] = useState(null);
  // The captures live in a slim side bar over the page (it no longer takes height away from the PDF).
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem('beerus-snip-side') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('beerus-snip-side', sideOpen ? '1' : '0'); } catch { /* ignore */ } }, [sideOpen]);
  const [sidePulse, setSidePulse] = useState(false);
  // "After snipping": ask each time, or send straight to Front / Back / a pill (fewer clicks when you snip a lot)
  const [quickTarget, setQuickTargetState] = useState(() => { try { return localStorage.getItem('beerus-snip-quick') || 'ask'; } catch { return 'ask'; } });
  const quickTargetRef = useRef(quickTarget);
  const setQuickTarget = (value) => { quickTargetRef.current = value; setQuickTargetState(value); try { localStorage.setItem('beerus-snip-quick', value); } catch { /* storage unavailable */ } };
  const [snippets, setSnippets] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [pdfMemoryStatus, setPdfMemoryStatus] = useState('idle');

  zoomRef.current = zoom;
  if (!zoomAnimRef.current) zoomTargetRef.current = zoom;
  useEffect(() => { setPageDraft(null); }, [pageNumber, pdfDoc]);
  const commitPageDraft = () => {
    if (pageDraft !== null && pageDraft !== '' && pdfDoc) setPageNumber(clamp(Number(pageDraft) || 1, 1, pdfDoc.numPages));
    setPageDraft(null);
  };
  const nativeDragEnabled = window.matchMedia?.('(pointer: fine)').matches ?? true;

  // The page layer is positioned entirely by `view` = { x, y, s }: a translation
  // plus a live scale relative to the currently rendered canvas bitmap.
  const applyView = (view) => {
    viewRef.current = view;
    const layer = pagePositionRef.current;
    if (layer) layer.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`;
  };

  // Hard clamp (no elasticity): a page smaller than the viewport stays centered,
  // a larger one can pan edge-to-edge and never further.
  const clampView = (view) => {
    const host = hostRef.current;
    const canvas = pageCanvasRef.current;
    if (!host || !canvas) return view;
    const hostWidth = host.clientWidth;
    const hostHeight = host.clientHeight;
    const width = canvas.offsetWidth * view.s;
    const height = canvas.offsetHeight * view.s;
    return {
      x: width + VIEW_PAD * 2 <= hostWidth ? (hostWidth - width) / 2 : clamp(view.x, hostWidth - width - VIEW_PAD, VIEW_PAD),
      y: height + VIEW_PAD * 2 <= hostHeight ? VIEW_PAD : clamp(view.y, hostHeight - height - VIEW_PAD, VIEW_PAD),
      s: view.s,
    };
  };

  const zoomAbout = (nextZoom, anchorX, anchorY) => {
    const target = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const view = viewRef.current;
    const ratio = target / (renderedZoomRef.current * view.s);
    applyView(clampView({ x: anchorX - (anchorX - view.x) * ratio, y: anchorY - (anchorY - view.y) * ratio, s: view.s * ratio }));
    return target;
  };

  // Smooth, anchored zoom for buttons, shortcuts and double-click: the bitmap is
  // scaled live around the anchor, then re-rendered sharp once it settles.
  const animateZoom = (target, anchorX, anchorY) => {
    const goal = clamp(target, MIN_ZOOM, MAX_ZOOM);
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    const start = renderedZoomRef.current * viewRef.current.s;
    zoomTargetRef.current = goal;
    zoomRef.current = goal;
    if (Math.abs(goal - start) < .002) { zoomAnimRef.current = 0; setZoom(goal); return; }
    const began = performance.now();
    const duration = 170;
    const step = (now) => {
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - progress) ** 3;
      zoomAbout(start * (goal / start) ** eased, anchorX, anchorY);
      if (progress < 1) { zoomAnimRef.current = requestAnimationFrame(step); return; }
      zoomAnimRef.current = 0;
      setZoom(goal);
    };
    zoomAnimRef.current = requestAnimationFrame(step);
  };

  const stepZoom = (factor) => {
    const host = hostRef.current;
    if (host) animateZoom(zoomTargetRef.current * factor, host.clientWidth / 2, host.clientHeight / 2);
  };

  // Fit width is zoom 1; a second press fits the whole page in the viewer.
  const fitZoom = () => {
    const host = hostRef.current;
    const canvas = pageCanvasRef.current;
    if (!host || !canvas) return;
    const total = renderedZoomRef.current * viewRef.current.s;
    const pageHeightAtOne = canvas.offsetHeight / renderedZoomRef.current;
    const fitPage = clamp((host.clientHeight - VIEW_PAD * 2) / Math.max(pageHeightAtOne, 1), MIN_ZOOM, 1);
    const target = Math.abs(total - 1) < .03 && fitPage < .97 ? fitPage : 1;
    animateZoom(target, host.clientWidth / 2, VIEW_PAD);
  };

  const toCanvasPoint = (clientX, clientY) => {
    const canvas = pageCanvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.offsetWidth / Math.max(bounds.width, 1);
    const scaleY = canvas.offsetHeight / Math.max(bounds.height, 1);
    return { x: clamp((clientX - bounds.left) * scaleX, 0, canvas.offsetWidth), y: clamp((clientY - bounds.top) * scaleY, 0, canvas.offsetHeight) };
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = Math.floor(entries[0].contentRect.width);
      setPageWidth(previous => {
        if (Math.abs(previous - nextWidth) < 2) return previous;
        needsPlaceRef.current = true;
        return nextWidth;
      });
      applyView(clampView(viewRef.current));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [pdfDoc]);

  useEffect(() => {
    docRef.current = pdfDoc;
    return () => { renderTaskRef.current?.cancel(); };
  }, [pdfDoc]);

  useEffect(() => {
    let canceled = false;
    const restoreToken = ++loadTokenRef.current;
    const restoreLastPdf = async () => {
      try {
        const saved = await readSavedPdf();
        if (canceled || restoreToken !== loadTokenRef.current || !saved?.file) return;
        const file = saved.file instanceof File
          ? saved.file
          : new File([saved.file], saved.name || 'Study PDF', { type: saved.type || 'application/pdf', lastModified: saved.lastModified || Date.now() });
        pdfStoredRef.current = true;
        sourceFileRef.current = file;
        setPdfMemoryStatus('restoring');
        await loadPdfFileRef.current?.(file, { restorePage: saved.pageNumber, restoreZoom: saved.zoom, fromRestore: true });
      } catch (restoreError) {
        if (!canceled && restoreToken === loadTokenRef.current) {
          setPdfMemoryStatus('error');
          setError(`The saved PDF could not be restored. Choose it again to continue. ${restoreError.message}`);
        }
      }
    };
    restoreLastPdf();
    return () => {
      canceled = true;
      if (loadTokenRef.current === restoreToken) loadTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!pdfDoc || !pdfStoredRef.current) return undefined;
    const saveToken = ++progressSaveTokenRef.current;
    const timer = setTimeout(async () => {
      if (!pdfStoredRef.current || progressSaveTokenRef.current !== saveToken) return;
      try {
        await savePdfProgress(pageNumber, zoom);
      } catch (saveError) {
        if (progressSaveTokenRef.current === saveToken) {
          setPdfMemoryStatus('error');
          setError(`PDF open, but its last page could not be saved. ${saveError.message}`);
        }
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [pdfDoc, pageNumber, zoom]);

  useEffect(() => {
    needsPlaceRef.current = true;
    viewRef.current = { x: 0, y: 0, s: 1 };
    pagePositionRef.current?.style.removeProperty('transform');
  }, [pdfDoc, pageNumber]);

  useEffect(() => () => {
    renderTaskRef.current?.cancel();
    // A PDFDocumentProxy belongs to its loading task. Destroying both separately
    // can race on iOS Safari when the user immediately chooses another PDF.
    const task = loadingTaskRef.current;
    loadingTaskRef.current = null;
    docRef.current = null;
    if (task) task.destroy().catch(() => {});
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  useEffect(() => {
    let canceled = false;
    const render = async () => {
      if (!pdfDoc || !pageCanvasRef.current || pageWidth < 80) return;
      renderTaskRef.current?.cancel();
      setRendering(true);
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (canceled) return;
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min((pageWidth - 28) / natural.width, 1.5) * zoom;
        const viewport = page.getViewport({ scale });
        if (highQualityPageRef.current?.pageNumber !== pageNumber) highQualityPageRef.current = null;
        const requestedDpr = Math.min(window.devicePixelRatio || 1, 1.75);
        const pixelBudgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height));
        const dimensionBudgetDpr = 8192 / Math.max(viewport.width, viewport.height, 1);
        const dpr = Math.max(.01, Math.min(requestedDpr, pixelBudgetDpr, dimensionBudgetDpr));
        // Render into a back buffer. Resizing the visible canvas clears it, so
        // drawing directly there caused a white flash on every zoom gesture.
        const buffer = document.createElement('canvas');
        buffer.width = Math.ceil(viewport.width * dpr);
        buffer.height = Math.ceil(viewport.height * dpr);
        buffer.style.width = `${viewport.width}px`;
        buffer.style.height = `${viewport.height}px`;
        const context = buffer.getContext('2d', { alpha: false });
        renderTaskRef.current = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
        await renderTaskRef.current.promise;
        if (canceled || !pageCanvasRef.current) return;
        const canvas = pageCanvasRef.current;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.getContext('2d', { alpha: false }).drawImage(buffer, 0, 0);
        displayedPageRef.current = { pageNumber, viewport };
        // Swap the bitmap and the view in the same frame so the page never jumps.
        // The live pinch scale (relative to the old bitmap) folds into the new one.
        const previousZoom = renderedZoomRef.current;
        renderedZoomRef.current = zoom;
        if (needsPlaceRef.current) {
          needsPlaceRef.current = false;
          applyView(clampView({ x: ((hostRef.current?.clientWidth || 0) - canvas.offsetWidth) / 2, y: VIEW_PAD, s: 1 }));
        } else {
          const view = viewRef.current;
          applyView(clampView({ ...view, s: view.s * previousZoom / zoom }));
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !canceled) setError(`Could not render this page: ${err.message}`);
      } finally {
        if (!canceled) setRendering(false);
        if (renderedPageRef.current && renderedPageRef.current !== pageNumber) {
          pdfDoc.getPage(renderedPageRef.current).then(oldPage => oldPage.cleanup()).catch(() => {});
        }
        renderedPageRef.current = pageNumber;
      }
    };
    render();
    return () => { canceled = true; renderTaskRef.current?.cancel(); };
  }, [pdfDoc, pageNumber, pageWidth, zoom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // One unified, JS-driven viewer: the host never scrolls natively, so iOS /
    // iPadOS cannot rubber-band it. Every pan is hard-clamped to the page edges.
    let pinch = null;
    let pan = null;
    let mouseDrag = null;
    let wheelTimer = null;
    let inertiaFrame = 0;

    let lastTap = null;
    let lastMouseDown = null;
    const stopInertia = () => {
      if (inertiaFrame) cancelAnimationFrame(inertiaFrame);
      inertiaFrame = 0;
      if (zoomAnimRef.current) { cancelAnimationFrame(zoomAnimRef.current); zoomAnimRef.current = 0; commitZoom(); }
    };
    const hostPoint = (clientX, clientY) => {
      const bounds = host.getBoundingClientRect();
      return { x: clientX - bounds.left, y: clientY - bounds.top };
    };
    const commitZoom = () => {
      const view = viewRef.current;
      const target = clamp(renderedZoomRef.current * view.s, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(target - zoomRef.current) > .005) { zoomRef.current = target; setZoom(target); }
    };
    const beginPan = (touch) => {
      pan = { x: touch.clientX, y: touch.clientY, t0: performance.now(), moved: false, view: { ...viewRef.current }, samples: [{ t: performance.now(), x: touch.clientX, y: touch.clientY }] };
    };
    const startInertia = (samples) => {
      const now = performance.now();
      const recent = samples.filter(sample => now - sample.t < 110);
      if (recent.length < 2) return;
      const first = recent[0];
      const last = recent[recent.length - 1];
      const elapsed = Math.max(last.t - first.t, 1);
      let vx = (last.x - first.x) / elapsed;
      let vy = (last.y - first.y) / elapsed;
      if (now - last.t > 70 || Math.hypot(vx, vy) < .12) return;
      let previous = now;
      const step = (time) => {
        const dt = Math.min(48, time - previous);
        previous = time;
        const view = viewRef.current;
        const wanted = { x: view.x + vx * dt, y: view.y + vy * dt, s: view.s };
        const next = clampView(wanted);
        if (next.x !== wanted.x) vx = 0;
        if (next.y !== wanted.y) vy = 0;
        applyView(next);
        const friction = Math.exp(-dt / 240);
        vx *= friction; vy *= friction;
        inertiaFrame = Math.hypot(vx, vy) > .02 ? requestAnimationFrame(step) : 0;
      };
      inertiaFrame = requestAnimationFrame(step);
    };

    const onTouchStart = (event) => {
      stopInertia();
      if (event.touches.length === 1 && snipping && event.target === pageCanvasRef.current) {
        const touch = event.touches[0];
        event.preventDefault();
        const point = toCanvasPoint(touch.clientX, touch.clientY);
        snipTouchStartRef.current = point;
        setSnipStart(point);
        setSelection({ ...point, width: 0, height: 0 });
        return;
      }
      if (event.touches.length >= 2) {
        const [first, second] = event.touches;
        if (snipTouchStartRef.current) {
          snipTouchStartRef.current = null;
          setSnipStart(null);
          setSelection(null);
        }
        pan = null;
        const mid = hostPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
        pinch = {
          distance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
          mid,
          view: { ...viewRef.current },
          total: renderedZoomRef.current * viewRef.current.s,
        };
        return;
      }
      if (event.touches.length === 1 && !snipping) beginPan(event.touches[0]);
    };

    const onTouchMove = (event) => {
      if (event.touches.length === 1 && snipTouchStartRef.current && snipping) {
        event.preventDefault();
        const touch = event.touches[0];
        const start = snipTouchStartRef.current;
        const point = toCanvasPoint(touch.clientX, touch.clientY);
        setSelection({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
        return;
      }
      if (pinch && event.touches.length >= 2) {
        event.preventDefault();
        const [first, second] = event.touches;
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        const mid = hostPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
        const total = clamp(pinch.total * distance / pinch.distance, MIN_ZOOM, MAX_ZOOM);
        const s = total / renderedZoomRef.current;
        const ratio = s / pinch.view.s;
        applyView(clampView({
          x: mid.x - (pinch.mid.x - pinch.view.x) * ratio,
          y: mid.y - (pinch.mid.y - pinch.view.y) * ratio,
          s,
        }));
        return;
      }
      if (pan && event.touches.length === 1) {
        event.preventDefault();
        const touch = event.touches[0];
        applyView(clampView({ x: pan.view.x + touch.clientX - pan.x, y: pan.view.y + touch.clientY - pan.y, s: pan.view.s }));
        if (Math.hypot(touch.clientX - pan.x, touch.clientY - pan.y) > 8) pan.moved = true;
        pan.samples.push({ t: performance.now(), x: touch.clientX, y: touch.clientY });
        if (pan.samples.length > 8) pan.samples.shift();
      }
    };

    const onTouchEnd = (event) => {
      if (pinch && event.touches.length < 2) {
        pinch = null;
        commitZoom();
        if (event.touches.length === 1 && !snipping) beginPan(event.touches[0]);
        return;
      }
      if (pan && event.touches.length === 0) {
        const samples = pan.samples;
        const wasTap = !pan.moved && performance.now() - pan.t0 < 280 && !snipping;
        pan = null;
        startInertia(samples);
        if (wasTap && event.changedTouches.length) {
          // Double-tap toggles between fit-width and 2x around the tapped point.
          const touch = event.changedTouches[0];
          const now = performance.now();
          if (lastTap && now - lastTap.t < 320 && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 36) {
            lastTap = null;
            const point = hostPoint(touch.clientX, touch.clientY);
            const total = renderedZoomRef.current * viewRef.current.s;
            animateZoom(total > 1.15 ? 1 : 2, point.x, point.y);
          } else {
            lastTap = { t: now, x: touch.clientX, y: touch.clientY };
          }
        }
      }
      if (snipTouchStartRef.current && event.touches.length === 0 && event.changedTouches.length) {
        const start = snipTouchStartRef.current;
        const touch = event.changedTouches[0];
        snipTouchStartRef.current = null;
        setSnipStart(null);
        setSelection(null);
        captureSnipRef.current?.(start, toCanvasPoint(touch.clientX, touch.clientY));
      }
    };

    const onTouchCancel = () => {
      snipTouchStartRef.current = null;
      setSnipStart(null);
      setSelection(null);
      pan = null;
      if (pinch) { pinch = null; commitZoom(); }
    };

    const onWheel = (event) => {
      pdfInteractionActiveRef.current = true;
      event.preventDefault();
      stopInertia();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? (host.clientHeight || 800) : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        const point = hostPoint(event.clientX, event.clientY);
        const total = renderedZoomRef.current * viewRef.current.s;
        // Trackpad pinch sends many tiny deltas; a mouse wheel sends big notches,
        // so use a gentler curve for notches (about 15% per click).
        const sensitivity = Math.abs(dy) >= 40 ? .0017 : .0045;
        zoomAbout(total * Math.exp(-dy * sensitivity), point.x, point.y);
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelTimer = null; commitZoom(); }, 140);
        return;
      }
      const view = viewRef.current;
      applyView(clampView({ x: view.x - dx, y: view.y - dy, s: view.s }));
    };

    const onPointerDown = (event) => {
      if (snipping || event.pointerType === 'touch' || event.button !== 0) return;
      stopInertia();
      // Double-click toggles fit-width and 2x around the cursor. Detected from
      // pointer timing because pointer capture can swallow native dblclick events.
      const downAt = performance.now();
      if (lastMouseDown && downAt - lastMouseDown.t < 350 && Math.hypot(event.clientX - lastMouseDown.x, event.clientY - lastMouseDown.y) < 8) {
        lastMouseDown = null;
        const point = hostPoint(event.clientX, event.clientY);
        const total = renderedZoomRef.current * viewRef.current.s;
        animateZoom(total > 1.15 ? 1 : 2, point.x, point.y);
        return;
      }
      lastMouseDown = { t: downAt, x: event.clientX, y: event.clientY };
      mouseDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...viewRef.current } };
      host.setPointerCapture?.(event.pointerId);
      host.classList.add('is-panning');
    };
    const onPointerMove = (event) => {
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      applyView(clampView({ x: mouseDrag.view.x + event.clientX - mouseDrag.x, y: mouseDrag.view.y + event.clientY - mouseDrag.y, s: mouseDrag.view.s }));
    };
    const onPointerEnd = (event) => {
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      mouseDrag = null;
      host.classList.remove('is-panning');
    };
    const blockGesture = (event) => event.preventDefault();

    host.addEventListener('touchstart', onTouchStart, { passive: false });
    host.addEventListener('touchmove', onTouchMove, { passive: false });
    host.addEventListener('touchend', onTouchEnd, { passive: true });
    host.addEventListener('touchcancel', onTouchCancel, { passive: true });
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerEnd);
    host.addEventListener('pointercancel', onPointerEnd);
    host.addEventListener('gesturestart', blockGesture);
    host.addEventListener('gesturechange', blockGesture);

    return () => {
      host.removeEventListener('touchstart', onTouchStart);
      host.removeEventListener('touchmove', onTouchMove);
      host.removeEventListener('touchend', onTouchEnd);
      host.removeEventListener('touchcancel', onTouchCancel);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerEnd);
      host.removeEventListener('pointercancel', onPointerEnd);
      host.removeEventListener('gesturestart', blockGesture);
      host.removeEventListener('gesturechange', blockGesture);
      host.classList.remove('is-panning');
      if (wheelTimer) { clearTimeout(wheelTimer); commitZoom(); }
      stopInertia();
    };
  }, [pdfDoc, snipping]);

  useEffect(() => {
    const trackActivePanel = event => {
      pdfInteractionActiveRef.current = Boolean(event.target?.closest?.('.pdf-study-panel'));
    };
    document.addEventListener('pointerdown', trackActivePanel, true);
    return () => document.removeEventListener('pointerdown', trackActivePanel, true);
  }, []);

  useEffect(() => {
    if (!pdfDoc) return undefined;
    const onViewerKey = (event) => {
      const target = event.target;
      if (!pdfInteractionActiveRef.current || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // Space/Enter must keep activating a focused button.
      if (target?.closest?.('button') && (event.key === ' ' || event.key === 'Enter')) return;
      if (document.querySelector('.snip-modal-backdrop, .snip-editor, .io-editor-backdrop')) return;
      const host = hostRef.current;
      if (!host) return;
      const mod = event.ctrlKey || event.metaKey;
      const panBy = (dx, dy) => { const view = viewRef.current; applyView(clampView({ x: view.x + dx, y: view.y + dy, s: view.s })); };
      const atEdge = (direction) => {
        const view = viewRef.current;
        const next = clampView({ x: view.x, y: view.y + direction * host.clientHeight * .9, s: view.s });
        return Math.abs(next.y - view.y) < 2;
      };
      const flip = (delta) => { setPageNumber(page => clamp(page + delta, 1, pdfDoc.numPages)); };
      if (mod && (event.key === '=' || event.key === '+')) { event.preventDefault(); stepZoom(1.25); return; }
      if (mod && (event.key === '-' || event.key === '_')) { event.preventDefault(); stepZoom(.8); return; }
      if (mod && event.key === '0') { event.preventDefault(); fitZoom(); return; }
      if (mod || event.altKey) return;
      const step = event.shiftKey ? 160 : 70;
      if (event.key === 'ArrowDown') { event.preventDefault(); panBy(0, -step); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); panBy(0, step); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); panBy(step, 0); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); panBy(-step, 0); }
      else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        if (atEdge(-1)) flip(1); else panBy(0, -host.clientHeight * .9);
      } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        if (atEdge(1)) flip(-1); else panBy(0, host.clientHeight * .9);
      } else if (event.key === 'Home') { event.preventDefault(); flip(-1e6); }
      else if (event.key === 'End') { event.preventDefault(); flip(1e6); }
    };
    window.addEventListener('keydown', onViewerKey);
    return () => window.removeEventListener('keydown', onViewerKey);
  }, [pdfDoc]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && snipping) { setSnipping(false); setSelection(null); return; }
      if (event.repeat || event.key.toLowerCase() !== 's' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (!pdfDoc || !pdfInteractionActiveRef.current || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      const intent = event.shiftKey ? 'occlusion' : 'normal';
      captureIntentRef.current = intent;
      setSnipIntent(intent);
      setSnipping(value => !value);
      setSelection(null);
      setSnipStart(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfDoc, snipping]);

  const loadPdfFile = async (file, { restorePage = 1, restoreZoom = 1, fromRestore = false } = {}) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file to open.'); return; }
    const loadToken = ++loadTokenRef.current;
    if (!fromRestore) pdfStoredRef.current = false;
    setLoading(true); setLoadProgress(0); setRendering(false); setError(''); setPdfDoc(null); setSnippets([]);
    let activeTask = null;
    try {
      const previousRender = renderTaskRef.current;
      previousRender?.cancel();
      // Wait until PDF.js releases the canvas before the next document renders.
      // Safari otherwise intermittently blanks the PDF workspace when Change PDF
      // is used while a page render is still in flight.
      try { await previousRender?.promise; } catch { /* cancellation is expected */ }
      if (renderTaskRef.current === previousRender) renderTaskRef.current = null;
      // Detach the previous document synchronously before awaiting destruction.
      const previousTask = loadingTaskRef.current;
      const previousDocument = docRef.current;
      loadingTaskRef.current = null;
      docRef.current = null;
      await previousTask?.destroy().catch(() => {});
      if (!previousTask) await previousDocument?.destroy().catch(() => {});
      if (loadTokenRef.current !== loadToken) return;
      renderedPageRef.current = null;
      displayedPageRef.current = null; highQualityPageRef.current = null;
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      const sourceUrl = URL.createObjectURL(file);
      sourceUrlRef.current = sourceUrl;
      activeTask = pdfjs.getDocument({ url: sourceUrl, rangeChunkSize: RANGE_CHUNK_SIZE });
      loadingTaskRef.current = activeTask;
      activeTask.onProgress = ({ loaded, total }) => { if (loadingTaskRef.current === activeTask && loadTokenRef.current === loadToken) setLoadProgress(total ? Math.min(99, Math.round(loaded / total * 100)) : 0); };
      activeTask.onPassword = (updatePassword, reason) => {
        const message = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'That password did not work. Try again:' : 'This PDF is password protected. Enter its password:';
        const password = window.prompt(message);
        if (password === null) activeTask.destroy().catch(() => {}); else updatePassword(password);
      };
      const document = await activeTask.promise;
      if (loadTokenRef.current !== loadToken) { await document.destroy(); return; }
      const targetPage = clamp(Number(restorePage) || 1, 1, document.numPages);
      const targetZoom = clamp(Number(restoreZoom) || 1, MIN_ZOOM, MAX_ZOOM);
      sourceFileRef.current = file;
      docRef.current = document; setPdfName(file.name); setPageNumber(targetPage); setZoom(targetZoom); setPdfDoc(document); setLoadProgress(100);
      if (fromRestore) {
        pdfStoredRef.current = true;
        setPdfMemoryStatus('saved');
      } else {
        const rememberToken = ++rememberTokenRef.current;
        setPdfMemoryStatus('saving');
        rememberPdf(file, { pageNumber: targetPage, zoom: targetZoom }).then(() => {
          if (rememberTokenRef.current === rememberToken) {
            pdfStoredRef.current = true;
            setPdfMemoryStatus('saved');
          }
        }).catch(saveError => {
          if (rememberTokenRef.current === rememberToken) {
            pdfStoredRef.current = false;
            setPdfMemoryStatus('error');
            setError(`PDF opened, but could not be saved for next time. ${saveError.message}`);
          }
        });
      }
    } catch (err) {
      if (loadingTaskRef.current === activeTask) {
        setError(`This PDF could not be opened: ${err.message}`);
        if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
        sourceUrlRef.current = null;
      }
    }
    finally { if (loadTokenRef.current === loadToken) setLoading(false); }
  };
  loadPdfFileRef.current = loadPdfFile;

  // A PDF dropped anywhere on the site arrives here (the panel may only have just been opened).
  useEffect(() => { if (incomingFile?.file) loadPdfFileRef.current?.(incomingFile.file); }, [incomingFile]);

  const openFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) loadPdfFile(file);
  };

  const forgetCurrentPdf = async () => {
    ++rememberTokenRef.current;
    ++progressSaveTokenRef.current;
    pdfStoredRef.current = false;
    try {
      await forgetSavedPdf();
      setPdfMemoryStatus('idle');
      setError('');
    } catch (forgetError) {
      setPdfMemoryStatus('error');
      setError(`Could not remove the saved PDF. ${forgetError.message}`);
    }
  };

  const cancelLoading = () => {
    loadTokenRef.current += 1;
    const sourceUrl = sourceUrlRef.current;
    const task = loadingTaskRef.current;
    loadingTaskRef.current = null;
    docRef.current = null;
    task?.destroy().catch(() => {}).finally(() => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); });
    sourceUrlRef.current = null;
    setLoading(false);
    setError('PDF loading canceled.');
  };

  const pagePoint = ({ clientX, clientY }) => toCanvasPoint(clientX, clientY);
  const onSnipPointerDown = (event) => {
    if (!snipping || event.pointerType === 'touch' || event.target !== pageCanvasRef.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const point = pagePoint(event); setSnipStart(point); setSelection({ ...point, width: 0, height: 0 });
  };
  const onSnipPointerMove = (event) => {
    if (!snipping || event.pointerType === 'touch' || !snipStart) return;
    const point = pagePoint(event);
    setSelection({ x: Math.min(snipStart.x, point.x), y: Math.min(snipStart.y, point.y), width: Math.abs(point.x - snipStart.x), height: Math.abs(point.y - snipStart.y) });
  };
  const captureSnip = async (start, end) => {
    if (!snipping || captureLoading) return;
    const captureIntent = captureIntentRef.current;
    const canvas = pageCanvasRef.current;
    const pageInfo = displayedPageRef.current;
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
    setSnipping(false); setSnipStart(null); setSelection(null);
    if (!canvas || !pageInfo || pageInfo.pageNumber !== pageNumber || width < 10 || height < 10) return;

    setCaptureLoading(true); setError('');
    try {
      const displayViewport = pageInfo.viewport;
      const displayCorners = [
        displayViewport.convertToPdfPoint(x, y),
        displayViewport.convertToPdfPoint(x + width, y),
        displayViewport.convertToPdfPoint(x, y + height),
        displayViewport.convertToPdfPoint(x + width, y + height),
      ];
      const page = await pdfDoc.getPage(pageNumber);
      let qualityPage = highQualityPageRef.current;
      if (!qualityPage || qualityPage.pageNumber !== pageNumber) {
        const unitViewport = page.getViewport({ scale: 1 });
        const targetScale = Math.min(3, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, unitViewport.width * unitViewport.height)), 8192 / Math.max(unitViewport.width, unitViewport.height));
        const qualityViewport = page.getViewport({ scale: targetScale });
        const qualityCanvas = document.createElement('canvas');
        qualityCanvas.width = Math.max(1, Math.ceil(qualityViewport.width)); qualityCanvas.height = Math.max(1, Math.ceil(qualityViewport.height));
        const context = qualityCanvas.getContext('2d', { alpha: false });
        const task = page.render({ canvasContext: context, viewport: qualityViewport });
        await task.promise;
        qualityPage = { pageNumber, viewport: qualityViewport, canvas: qualityCanvas };
        highQualityPageRef.current = qualityPage;
      }
      const cropCorners = displayCorners.map(point => qualityPage.viewport.convertToViewportPoint(point[0], point[1]));
      const sx = clamp(Math.floor(Math.min(...cropCorners.map(point => point[0]))), 0, qualityPage.canvas.width - 1);
      const sy = clamp(Math.floor(Math.min(...cropCorners.map(point => point[1]))), 0, qualityPage.canvas.height - 1);
      const ex = clamp(Math.ceil(Math.max(...cropCorners.map(point => point[0]))), sx + 1, qualityPage.canvas.width);
      const ey = clamp(Math.ceil(Math.max(...cropCorners.map(point => point[1]))), sy + 1, qualityPage.canvas.height);
      let sourceWidth = ex - sx, sourceHeight = ey - sy;
      const outputScale = Math.min(1, Math.sqrt(8_000_000 / Math.max(1, sourceWidth * sourceHeight)));
      const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale));
      const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale));
      const crop = document.createElement('canvas'); crop.width = outputWidth; crop.height = outputHeight;
      crop.getContext('2d', { alpha: false }).drawImage(qualityPage.canvas, sx, sy, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
      const captured = { image: crop.toDataURL('image/jpeg', .95), width: outputWidth, height: outputHeight, page: pageNumber, name: `${pdfName} · p. ${pageNumber}`, intent: captureIntent, masks: [], mode: 'hide-all', id: crypto.randomUUID() };
      if (captureIntent === 'occlusion') setPendingSnip(captured);
      else if (quickTargetRef.current && quickTargetRef.current !== 'ask') {
        setSnippets(previous => [captured, ...previous]);
        onInsertSnippet(captured, quickTargetRef.current);
      } else setTargetPromptSnip(captured);
    } catch (err) {
      setError(`Could not capture this region: ${err.message}`);
    } finally { setCaptureLoading(false); }
  };
  captureSnipRef.current = captureSnip;

  const onSnipPointerUp = (event) => {
    if (!snipping || event.pointerType === 'touch' || !snipStart || captureLoading) return;
    captureSnip(snipStart, pagePoint(event));
  };

  const capturesCount = snippets.length;
  const lastCount = useRef(0);
  useEffect(() => {
    if (capturesCount > lastCount.current) { setSidePulse(true); const timer = window.setTimeout(() => setSidePulse(false), 1600); lastCount.current = capturesCount; return () => window.clearTimeout(timer); }
    lastCount.current = capturesCount;
    return undefined;
  }, [capturesCount]);

  const saveSnippet = (snippet) => {
    const { autoInsertTarget, ...savedSnippet } = snippet;
    setSnippets(prev => [savedSnippet, ...prev]);
    setPendingSnip(null);
    if (autoInsertTarget) onInsertSnippet(savedSnippet, autoInsertTarget);
  };
  const insertCapturedSnippet = (target, asOcclusion = false) => {
    if (!targetPromptSnip) return;
    if (asOcclusion) {
      setTargetPromptSnip(null);
      setPendingSnip({ ...targetPromptSnip, intent: 'occlusion', masks: [], autoInsertTarget: target });
      return;
    }
    const snippet = targetPromptSnip;
    setSnippets(previous => [snippet, ...previous]);
    setTargetPromptSnip(null);
    onInsertSnippet(snippet, target);
  };

  useEffect(() => {
    if (!targetPromptSnip) return undefined;
    const chooseFieldByNumber = event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (['4', '5', '6', '7'].includes(event.key)) {
        const pill = pillOptions[Number(event.key) - 4];
        if (!pill) return;
        event.preventDefault();
        insertCapturedSnippet(pill.target);
      } else if (event.key === '1' || event.key === '3') {
        const field = fieldOptions[event.key === '1' ? 0 : 1];
        if (!field) return;
        event.preventDefault();
        insertCapturedSnippet(field.target);
      } else if (event.key === '2') {
        event.preventDefault();
        insertCapturedSnippet(fieldOptions[0]?.target || 'front', true);
      }
    };
    window.addEventListener('keydown', chooseFieldByNumber);
    return () => window.removeEventListener('keydown', chooseFieldByNumber);
  }, [targetPromptSnip, fieldOptions, pillOptions]);

  const onDragStart = (event, snippet) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-anki-study-snippet', JSON.stringify(snippet));
    event.dataTransfer.setData('text/plain', 'Anki study snip');
  };

  const clearTouchSnippetDrag = () => {
    const drag = touchSnippetDragRef.current;
    if (!drag) return;
    clearTimeout(drag.armTimer);
    window.removeEventListener('pointermove', drag.onMove);
    window.removeEventListener('pointerup', drag.onEnd);
    window.removeEventListener('pointercancel', drag.onEnd);
    drag.dropTarget?.classList.remove('snip-drop-target-active');
    drag.ghost?.remove();
    touchSnippetDragRef.current = null;
  };

  const onTouchSnippetPointerDown = (event, snippet) => {
    if (event.pointerType !== 'touch' || !event.target.closest('img') || event.target.closest('button')) return;
    clearTouchSnippetDrag();
    const drag = { snippet, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ready: false, active: false, dropTarget: null, ghost: null };
    drag.armTimer = window.setTimeout(() => { drag.ready = true; }, 280);
    drag.onMove = moveEvent => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(moveEvent.clientX - drag.x, moveEvent.clientY - drag.y);
      if (!drag.active) {
        if (!drag.ready && distance > 12) { clearTouchSnippetDrag(); return; }
        if (!drag.ready || distance <= 7) return;
        drag.active = true;
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'touch-snippet-ghost';
        drag.ghost.innerHTML = `<img src="${snippet.image}" alt=""><span>${snippet.masks?.length ? 'Image occlusion' : 'PDF snip'}</span>`;
        document.body.appendChild(drag.ghost);
      }
      moveEvent.preventDefault();
      if (drag.ghost) drag.ghost.style.transform = `translate3d(${moveEvent.clientX + 16}px, ${moveEvent.clientY + 16}px, 0)`;
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const editorTab = target?.closest('[data-workspace-tab="editor"]');
      if (editorTab) onMobileView?.('editor');
      const nextDropTarget = target?.closest('[data-editor-drop-target]');
      if (drag.dropTarget !== nextDropTarget) {
        drag.dropTarget?.classList.remove('snip-drop-target-active');
        drag.dropTarget = nextDropTarget;
        drag.dropTarget?.classList.add('snip-drop-target-active');
      }
    };
    drag.onEnd = endEvent => {
      if (endEvent.pointerId !== drag.pointerId) return;
      const target = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
      const field = target?.closest('[data-editor-drop-target]');
      const active = drag.active;
      const currentSnippet = drag.snippet;
      clearTouchSnippetDrag();
      if (active && field) {
        onInsertSnippet(currentSnippet, field.dataset.editorDropTarget, { clientX: endEvent.clientX, clientY: endEvent.clientY });
      } else if (active && target?.closest('[data-workspace-tab="editor"]')) {
        onMobileView?.('editor');
      }
    };
    touchSnippetDragRef.current = drag;
    window.addEventListener('pointermove', drag.onMove, { passive: false });
    window.addEventListener('pointerup', drag.onEnd);
    window.addEventListener('pointercancel', drag.onEnd);
  };

  useEffect(() => () => clearTouchSnippetDrag(), []);

  return (
    <section className="pdf-study-panel" aria-label="PDF study panel">
      <header className="pdf-panel-header">
        <div className="pdf-panel-title"><span className="pdf-mark"><FileText size={18} /></span><div><p className="section-eyebrow">SOURCE DOCUMENT</p><h2>{pdfName || 'PDF study'}</h2><span className="sr-only" role="status">{pdfMemoryStatus === 'saving' ? 'Saving PDF on this device' : pdfMemoryStatus === 'restoring' ? 'Restoring saved PDF' : pdfMemoryStatus === 'saved' ? 'PDF saved on this device' : pdfMemoryStatus === 'error' ? 'PDF could not be saved locally' : ''}</span></div></div>
        <div className="pdf-panel-tools">{pdfMemoryStatus === 'saved' && <button className="pdf-toolbar-button pdf-forget-button" aria-label="Forget saved PDF" title="Forget saved PDF" onClick={forgetCurrentPdf}><XCircle size={15} /><span>Forget saved PDF</span></button>}<button className="pdf-toolbar-button" onClick={() => fileInputRef.current?.click()}><PlusCircle size={16} />{pdfDoc ? 'Change PDF' : 'Open PDF'}</button><input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={openFile} hidden />{isSmallScreen && onMobileView && <button className="pdf-toolbar-button" onClick={() => onMobileView('editor')}><BookOpen size={16} />Write</button>}</div>
      </header>

      {pdfDoc && <div className="pdf-controls">
        <div className="pdf-page-controls"><button className="pdf-icon-button" onClick={() => setPageNumber(page => Math.max(1, page - 1))} disabled={pageNumber <= 1 || captureLoading} title="Previous page"><ChevronLeft size={17} /></button><label><input aria-label="PDF page number" inputMode="numeric" value={pageDraft ?? pageNumber} disabled={captureLoading} onFocus={event => event.target.select()} onChange={event => setPageDraft(event.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={commitPageDraft} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPageDraft(); event.currentTarget.blur(); } }} /> <span>/ {pdfDoc.numPages}</span></label><button className="pdf-icon-button" onClick={() => setPageNumber(page => Math.min(pdfDoc.numPages, page + 1))} disabled={pageNumber >= pdfDoc.numPages || captureLoading} title="Next page"><ChevronRight size={17} /></button></div>
        <div className="pdf-zoom-controls"><button className="pdf-icon-button" onClick={() => stepZoom(.8)} disabled={captureLoading} title="Zoom out (Ctrl −)"><Minus size={16} /></button><button className="pdf-zoom-readout" onClick={fitZoom} disabled={captureLoading} title="Fit width, then fit page (Ctrl 0) · double-click the page to zoom">{Math.round(zoom * 100)}%</button><button className="pdf-icon-button" onClick={() => stepZoom(1.25)} disabled={captureLoading} title="Zoom in (Ctrl +)"><PlusCircle size={16} /></button></div>
        <button className={`snip-toggle ${snipping ? 'snip-active' : ''}`} title="Snip: S · Snip for image occlusion: Shift+S" onClick={() => { captureIntentRef.current = 'normal'; setSnipIntent('normal'); setSnipping(value => !value); setSelection(null); setSnipStart(null); }} disabled={!pdfDoc || rendering || captureLoading}>{captureLoading ? 'Preparing capture…' : snipping ? snipIntent === 'occlusion' ? 'Select an occlusion image…' : 'Select a region…' : <><Crop size={15} /> Snip region</>}</button>
        {pillOptions.length > 0 && <label className="snip-quick" title="Where a snip goes right after you capture it"><span>After snip</span><select value={quickTarget} onChange={e => setQuickTarget(e.target.value)} aria-label="After snipping, send the capture to"><option value="ask">Ask me</option><option value="front">{fieldOptions[0]?.label || 'Front'}</option><option value="back">{fieldOptions[1]?.label || 'Back'}</option>{pillOptions.map(pill => <option key={pill.target} value={pill.target}>{pill.label} pill</option>)}</select></label>}
      </div>}

      {error && <div className="pdf-error" role="alert"><span>{error}</span><button onClick={() => setError('')}><XCircle size={15} /></button></div>}
      {loading && <div className="pdf-loading-progress" role="status"><span>Reading PDF ranges… {loadProgress}%</span><div><i style={{width:`${loadProgress}%`}} /></div><button onClick={cancelLoading}>Cancel</button></div>}
      {!pdfDoc ? <div className="pdf-empty-state"><div className="pdf-empty-icon"><FileText size={23} /></div><h3>{loading ? 'Opening your PDF…' : 'Bring your source into view'}</h3><p>Open a PDF and snip a diagram, definition, or worked example. Your document stays in this browser.</p><button onClick={() => fileInputRef.current?.click()} disabled={loading}>{loading ? 'Loading…' : 'Choose a PDF'} <ChevronRight size={15} /></button></div> : <>
        <div className="pdf-view-wrap"><div ref={hostRef} className={`pdf-page-viewport ${snipping ? 'is-snipping' : ''}`} onPointerDown={onSnipPointerDown} onPointerMove={onSnipPointerMove} onPointerUp={onSnipPointerUp} onPointerCancel={onSnipPointerUp}>
          <div ref={pagePositionRef} className="pdf-page-position"><div ref={pageStageRef} className="pdf-page-stage"><canvas ref={pageCanvasRef} aria-label={`PDF page ${pageNumber}`} />{(pageWidth < 80 || (rendering && displayedPageRef.current?.pageNumber !== pageNumber) || captureLoading) && <div className="pdf-page-rendering">{captureLoading ? 'Rendering high resolution capture…' : pageWidth < 80 ? 'Preparing page view…' : 'Rendering page…'}</div>}{selection && <div className="pdf-selection-box" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}</div></div>
          {snipping && <div className="snip-instruction">{snipIntent === 'occlusion' ? 'Capture image for occlusion' : 'Drag to capture'} <kbd>Esc</kbd> to cancel</div>}
        </div>
        {snippets.length > 0 && <aside className={`snip-side${sideOpen ? ' open' : ''}${sidePulse ? ' pulse' : ''}`} aria-label="Captures"><button type="button" className="snip-side-toggle" onClick={() => setSideOpen(value => !value)} aria-expanded={sideOpen} title={sideOpen ? 'Collapse captures' : 'Show captures'}><b>{snippets.length}</b><span className="snip-side-title">Captures<small>Newest first · drag onto a field</small></span><i aria-hidden="true">{sideOpen ? '›' : '‹'}</i></button><div className="snip-tray-list">{snippets.map((snippet, index) => <article key={snippet.id} className="snip-tray-item" onClick={() => { if (!sideOpen) setSideOpen(true); }} draggable={nativeDragEnabled} onDragStart={event => onDragStart(event, snippet)} onPointerDown={event => onTouchSnippetPointerDown(event, snippet)}>
          <img src={snippet.image} alt="Captured PDF region" draggable="false" />
          <div className="snip-tray-info"><strong><span className="snip-number">{snippets.length - index}</span>{snippet.masks.length ? `Occlusion · ${snippet.masks.length} regions` : 'PDF capture'}</strong><span>{snippet.name}</span></div>
          <div className="snip-tray-actions"><span className="snip-send-label">Send to</span><button onClick={() => onInsertSnippet(snippet, 'front')} title="Insert into front/text">Front</button><button onClick={() => onInsertSnippet(snippet, 'back')} title="Insert into back/extra">Back</button></div>{pillOptions.length > 0 && <div className="snip-tray-pills"><PillButtons variant="icon" onPick={target => onInsertSnippet(snippet, target)} /></div>}
        </article>)}</div></aside>}</div>
      </>}
      {pendingSnip && <PdfAnnotationEditor snip={pendingSnip} initialTool={pendingSnip.intent === 'occlusion' ? 'mask-rect' : 'select'} onClose={() => setPendingSnip(null)} onSave={saveSnippet} />}
      {targetPromptSnip && <div className="snip-modal-backdrop snip-target-backdrop" style={INSERT_PROMPT_STYLE.backdrop} role="dialog" aria-modal="true" aria-label="Choose where to insert the capture"><section className="snip-target-dialog" style={INSERT_PROMPT_STYLE.panel}><header style={INSERT_PROMPT_STYLE.header}><div><span className="section-eyebrow" style={INSERT_PROMPT_STYLE.eyebrow}>CAPTURE READY · PAGE {targetPromptSnip.page}</span><h2 style={INSERT_PROMPT_STYLE.title}>Insert image into…</h2></div><button type="button" className="snip-close" style={INSERT_PROMPT_STYLE.close} aria-label="Cancel capture" onClick={() => { saveSnippet(targetPromptSnip); setTargetPromptSnip(null); }}><XCircle size={19} /></button></header><img style={INSERT_PROMPT_STYLE.image} src={targetPromptSnip.image} alt="Captured PDF region preview"/><p style={INSERT_PROMPT_STYLE.description}>Press 1 for Front, 3 for Back, 4–7 for a pill, or 2 to make an image occlusion card.</p><div className="snip-target-options" style={{ ...INSERT_PROMPT_STYLE.options, display: 'flex' }}>{fieldOptions[0] && <button style={{ ...INSERT_PROMPT_STYLE.option, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} type="button" onClick={() => insertCapturedSnippet(fieldOptions[0].target)}><kbd style={INSERT_PROMPT_STYLE.key}>1</kbd>{fieldOptions[0].label}</button>}{fieldOptions[0] && <button style={{ ...INSERT_PROMPT_STYLE.occlusion, display: 'flex', gap: 6, padding: '0 10px', width: 'auto' }} type="button" aria-label="Use as image occlusion and open editor" title="Use field 1 as the image occlusion source (2)" onClick={() => insertCapturedSnippet(fieldOptions[0].target, true)}><kbd style={INSERT_PROMPT_STYLE.key}>2</kbd><Crop size={18} /></button>}{fieldOptions[1] && <button style={{ ...INSERT_PROMPT_STYLE.option, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} type="button" onClick={() => insertCapturedSnippet(fieldOptions[1].target)}><kbd style={INSERT_PROMPT_STYLE.key}>3</kbd>{fieldOptions[1].label}</button>}</div>{pillOptions.length > 0 && <div className="snip-pill-row"><PillButtons showKeys onPick={target => insertCapturedSnippet(target)} /></div>}</section></div>}
    </section>
  );
}
