import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BookOpen, ChevronLeft, ChevronRight, Crop, FileText, Minus, PlusCircle, XCircle } from './Icons';
import PdfAnnotationEditor from './PdfAnnotationEditor';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MAX_CANVAS_PIXELS = 12_000_000;
const RANGE_CHUNK_SIZE = 256 * 1024;

export default function PdfStudyPanel({ onInsertSnippet, isSmallScreen = false, onMobileView }) {
  const fileInputRef = useRef(null);
  const hostRef = useRef(null);
  const pagePositionRef = useRef(null);
  const pageStageRef = useRef(null);
  const pageCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const docRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const sourceUrlRef = useRef(null);
  const renderedPageRef = useRef(null);
  const displayedPageRef = useRef(null);
  const highQualityPageRef = useRef(null);
  const loadTokenRef = useRef(0);
  const zoomRef = useRef(1);
  const zoomGestureRef = useRef(null);
  const zoomCommitTimerRef = useRef(null);
  const pdfPanRef = useRef({ x: 0, y: 0 });
  const snipTouchStartRef = useRef(null);
  const captureSnipRef = useRef(null);
  const [pdfName, setPdfName] = useState('');
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [snipping, setSnipping] = useState(false);
  const [selection, setSelection] = useState(null);
  const [snipStart, setSnipStart] = useState(null);
  const [pendingSnip, setPendingSnip] = useState(null);
  const [snippets, setSnippets] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);

  zoomRef.current = zoom;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = Math.floor(entries[0].contentRect.width);
      setPageWidth(previous => Math.abs(previous - nextWidth) >= 2 ? nextWidth : previous);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [pdfDoc]);

  useEffect(() => {
    docRef.current = pdfDoc;
    return () => { renderTaskRef.current?.cancel(); };
  }, [pdfDoc]);

  useEffect(() => {
    pdfPanRef.current = { x: 0, y: 0 };
    pagePositionRef.current?.style.removeProperty('transform');
    pageStageRef.current?.style.removeProperty('transform');
    pageStageRef.current?.style.removeProperty('transform-origin');
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
        displayedPageRef.current = { pageNumber, viewport };
        if (highQualityPageRef.current?.pageNumber !== pageNumber) highQualityPageRef.current = null;
        const requestedDpr = Math.min(window.devicePixelRatio || 1, 1.75);
        const pixelBudgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height));
        const dimensionBudgetDpr = 8192 / Math.max(viewport.width, viewport.height, 1);
        const dpr = Math.max(.01, Math.min(requestedDpr, pixelBudgetDpr, dimensionBudgetDpr));
        const canvas = pageCanvasRef.current;
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d', { alpha: false });
        renderTaskRef.current = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
        await renderTaskRef.current.promise;
        pageStageRef.current?.style.removeProperty('transform');
        pageStageRef.current?.style.removeProperty('transform-origin');
        pageStageRef.current?.style.removeProperty('will-change');
        pagePositionRef.current?.style.removeProperty('will-change');
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
    if (!host) return;

    const previewZoom = (gesture, nextZoom) => {
      gesture.nextZoom = clamp(nextZoom, .55, 2.2);
      const stage = pageStageRef.current;
      if (!stage) return;
      stage.style.willChange = 'transform';
      stage.style.transformOrigin = `${gesture.originX}px ${gesture.originY}px`;
      stage.style.transform = `scale(${gesture.nextZoom / gesture.startZoom})`;
    };

    const commitZoom = () => {
      const gesture = zoomGestureRef.current;
      if (!gesture) return;
      zoomGestureRef.current = null;
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
      if (Math.abs(gesture.nextZoom - gesture.startZoom) > .01) {
        zoomRef.current = gesture.nextZoom;
        setZoom(gesture.nextZoom);
      } else {
        pageStageRef.current?.style.removeProperty('transform');
        pageStageRef.current?.style.removeProperty('transform-origin');
        pageStageRef.current?.style.removeProperty('will-change');
        pagePositionRef.current?.style.removeProperty('will-change');
      }
    };

    const onTouchStart = (event) => {
      if (event.touches.length !== 2 || !pageStageRef.current) return;
      const [first, second] = event.touches;
      const stage = pageStageRef.current.getBoundingClientRect();
      const midpointX = (first.clientX + second.clientX) / 2;
      const midpointY = (first.clientY + second.clientY) / 2;
      if (snipTouchStartRef.current) {
        snipTouchStartRef.current = null;
        setSnipStart(null);
        setSelection(null);
      }
      zoomGestureRef.current = {
        startZoom: zoomRef.current,
        nextZoom: zoomRef.current,
        startDistance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
        startMidpointX: midpointX,
        startMidpointY: midpointY,
        startPan: { ...pdfPanRef.current },
        originX: midpointX - stage.left,
        originY: midpointY - stage.top,
      };
      pagePositionRef.current.style.willChange = 'transform';
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    };

    const onTouchMove = (event) => {
      const gesture = zoomGestureRef.current;
      if (event.touches.length === 1 && snipTouchStartRef.current && snipping) {
        event.preventDefault();
        const touch = event.touches[0];
        const bounds = pageCanvasRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const start = snipTouchStartRef.current;
        const point = { x: clamp(touch.clientX - bounds.left, 0, bounds.width), y: clamp(touch.clientY - bounds.top, 0, bounds.height) };
        setSelection({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
        return;
      }
      if (!gesture || event.touches.length !== 2) return;
      event.preventDefault();
      const [first, second] = event.touches;
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      const midpointX = (first.clientX + second.clientX) / 2;
      const midpointY = (first.clientY + second.clientY) / 2;
      const pan = {
        x: gesture.startPan.x + midpointX - gesture.startMidpointX,
        y: gesture.startPan.y + midpointY - gesture.startMidpointY,
      };
      if (pagePositionRef.current) pagePositionRef.current.style.willChange = 'transform';
      pdfPanRef.current = pan;
      if (pagePositionRef.current) pagePositionRef.current.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0)`;
      previewZoom(gesture, gesture.startZoom * distance / Math.max(gesture.startDistance, 1));
    };

    const onTouchEnd = (event) => {
      if (zoomGestureRef.current && event.touches.length < 2) commitZoom();
      if (snipTouchStartRef.current && event.touches.length === 0 && event.changedTouches.length) {
        const start = snipTouchStartRef.current;
        const touch = event.changedTouches[0];
        const bounds = pageCanvasRef.current?.getBoundingClientRect();
        snipTouchStartRef.current = null;
        setSnipStart(null);
        setSelection(null);
        if (bounds) captureSnipRef.current?.(start, {
          x: clamp(touch.clientX - bounds.left, 0, bounds.width),
          y: clamp(touch.clientY - bounds.top, 0, bounds.height),
        });
      }
    };

    const onTouchCancel = () => {
      snipTouchStartRef.current = null;
      setSnipStart(null);
      setSelection(null);
      if (zoomGestureRef.current) commitZoom();
    };

    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const stage = pageStageRef.current;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      let gesture = zoomGestureRef.current;
      if (!gesture) {
        gesture = {
          startZoom: zoomRef.current,
          nextZoom: zoomRef.current,
          originX: event.clientX - bounds.left,
          originY: event.clientY - bounds.top,
        };
        zoomGestureRef.current = gesture;
      }
      previewZoom(gesture, gesture.nextZoom * Math.exp(-event.deltaY * .002));
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = setTimeout(commitZoom, 140);
    };

    const onTouchStartWithSnip = (event) => {
      if (event.touches.length === 1 && snipping && !zoomGestureRef.current && event.target === pageCanvasRef.current) {
        const touch = event.touches[0];
        const bounds = pageCanvasRef.current?.getBoundingClientRect();
        if (bounds) {
          event.preventDefault();
          const point = { x: clamp(touch.clientX - bounds.left, 0, bounds.width), y: clamp(touch.clientY - bounds.top, 0, bounds.height) };
          snipTouchStartRef.current = point;
          setSnipStart(point);
          setSelection({ ...point, width: 0, height: 0 });
          return;
        }
      }
      onTouchStart(event);
    };

    host.addEventListener('touchstart', onTouchStartWithSnip, { passive: false });
    host.addEventListener('touchmove', onTouchMove, { passive: false });
    host.addEventListener('touchend', onTouchEnd, { passive: true });
    host.addEventListener('touchcancel', onTouchCancel, { passive: true });
    host.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      host.removeEventListener('touchstart', onTouchStartWithSnip);
      host.removeEventListener('touchmove', onTouchMove);
      host.removeEventListener('touchend', onTouchEnd);
      host.removeEventListener('touchcancel', onTouchCancel);
      host.removeEventListener('wheel', onWheel);
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
      zoomGestureRef.current = null;
      pagePositionRef.current?.style.removeProperty('will-change');
      pageStageRef.current?.style.removeProperty('will-change');
    };
  }, [pdfDoc, snipping]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && snipping) { setSnipping(false); setSelection(null); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snipping]);

  const openFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file to open.'); return; }
    const loadToken = ++loadTokenRef.current;
    setLoading(true); setLoadProgress(0); setRendering(false); setError(''); setPdfDoc(null); setSnippets([]); setPageNumber(1); setZoom(1);
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
      docRef.current = document; setPdfName(file.name); setPdfDoc(document); setLoadProgress(100);
    } catch (err) {
      if (loadingTaskRef.current === activeTask) {
        setError(`This PDF could not be opened: ${err.message}`);
        if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
        sourceUrlRef.current = null;
      }
    }
    finally { if (loadTokenRef.current === loadToken) setLoading(false); }
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

  const pagePoint = ({ clientX, clientY }) => {
    const bounds = pageCanvasRef.current.getBoundingClientRect();
    return { x: clamp(clientX - bounds.left, 0, bounds.width), y: clamp(clientY - bounds.top, 0, bounds.height) };
  };
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
      setPendingSnip({ image: crop.toDataURL('image/jpeg', .95), width: outputWidth, height: outputHeight, page: pageNumber, name: `${pdfName} · p. ${pageNumber}` });
    } catch (err) {
      setError(`Could not capture this region: ${err.message}`);
    } finally { setCaptureLoading(false); }
  };
  captureSnipRef.current = captureSnip;

  const onSnipPointerUp = (event) => {
    if (!snipping || event.pointerType === 'touch' || !snipStart || captureLoading) return;
    captureSnip(snipStart, pagePoint(event));
  };

  const saveSnippet = (snippet) => { setSnippets(prev => [snippet, ...prev]); setPendingSnip(null); };

  const onDragStart = (event, snippet) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-anki-study-snippet', JSON.stringify(snippet));
    event.dataTransfer.setData('text/plain', 'Anki study snip');
  };

  return (
    <section className="pdf-study-panel" aria-label="PDF study panel">
      <header className="pdf-panel-header">
        <div className="pdf-panel-title"><span className="pdf-mark"><FileText size={18} /></span><div><p className="section-eyebrow">SOURCE DOCUMENT</p><h2>{pdfName || 'PDF study'}</h2></div></div>
        <div className="pdf-panel-tools"><button className="pdf-toolbar-button" onClick={() => fileInputRef.current?.click()}><PlusCircle size={16} />{pdfDoc ? 'Change PDF' : 'Open PDF'}</button><input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={openFile} hidden />{isSmallScreen && onMobileView && <button className="pdf-toolbar-button" onClick={() => onMobileView('editor')}><BookOpen size={16} />Write</button>}</div>
      </header>

      {pdfDoc && <div className="pdf-controls">
        <div className="pdf-page-controls"><button className="pdf-icon-button" onClick={() => setPageNumber(page => Math.max(1, page - 1))} disabled={pageNumber <= 1 || captureLoading} title="Previous page"><ChevronLeft size={17} /></button><label><input aria-label="PDF page number" inputMode="numeric" value={pageNumber} disabled={captureLoading} onChange={event => setPageNumber(clamp(Number(event.target.value) || 1, 1, pdfDoc.numPages))} /> <span>/ {pdfDoc.numPages}</span></label><button className="pdf-icon-button" onClick={() => setPageNumber(page => Math.min(pdfDoc.numPages, page + 1))} disabled={pageNumber >= pdfDoc.numPages || captureLoading} title="Next page"><ChevronRight size={17} /></button></div>
        <div className="pdf-zoom-controls"><button className="pdf-icon-button" onClick={() => setZoom(value => clamp(value - .15, .55, 2.2))} disabled={captureLoading} title="Zoom out"><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="pdf-icon-button" onClick={() => setZoom(value => clamp(value + .15, .55, 2.2))} disabled={captureLoading} title="Zoom in"><PlusCircle size={16} /></button></div>
        <button className={`snip-toggle ${snipping ? 'snip-active' : ''}`} onClick={() => { setSnipping(value => !value); setSelection(null); setSnipStart(null); }} disabled={!pdfDoc || rendering || captureLoading}>{captureLoading ? 'Preparing capture…' : snipping ? 'Select a region…' : <><Crop size={15} /> Snip region</>}</button>
      </div>}

      {error && <div className="pdf-error" role="alert"><span>{error}</span><button onClick={() => setError('')}><XCircle size={15} /></button></div>}
      {loading && <div className="pdf-loading-progress" role="status"><span>Reading PDF ranges… {loadProgress}%</span><div><i style={{width:`${loadProgress}%`}} /></div><button onClick={cancelLoading}>Cancel</button></div>}
      {!pdfDoc ? <div className="pdf-empty-state"><div className="pdf-empty-icon"><FileText size={23} /></div><h3>{loading ? 'Opening your PDF…' : 'Bring your source into view'}</h3><p>Open a PDF and snip a diagram, definition, or worked example. Your document stays in this browser.</p><button onClick={() => fileInputRef.current?.click()} disabled={loading}>{loading ? 'Loading…' : 'Choose a PDF'} <ChevronRight size={15} /></button></div> : <>
        <div ref={hostRef} className={`pdf-page-viewport ${snipping ? 'is-snipping' : ''}`} onPointerDown={onSnipPointerDown} onPointerMove={onSnipPointerMove} onPointerUp={onSnipPointerUp} onPointerCancel={onSnipPointerUp}>
          <div ref={pagePositionRef} className="pdf-page-position"><div ref={pageStageRef} className="pdf-page-stage"><canvas ref={pageCanvasRef} aria-label={`PDF page ${pageNumber}`} />{(pageWidth < 80 || rendering || captureLoading) && <div className="pdf-page-rendering">{captureLoading ? 'Rendering high resolution capture…' : pageWidth < 80 ? 'Preparing page view…' : 'Rendering page…'}</div>}{selection && <div className="pdf-selection-box" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}</div></div>
          {snipping && <div className="snip-instruction"><span>Drag to capture · Esc to cancel</span><span className="snip-touch-help">2 fingers move + zoom</span></div>}
        </div>
        {snippets.length > 0 && <div className="snip-tray"><div className="snip-tray-heading"><span>CAPTURES <b>{snippets.length}</b></span><span>Drag a snip onto a card field</span></div><div className="snip-tray-list">{snippets.map(snippet => <article key={snippet.id} className="snip-tray-item" draggable onDragStart={event => onDragStart(event, snippet)}>
          <img src={snippet.image} alt="Captured PDF region" draggable="false" />
          <div className="snip-tray-info"><strong>{snippet.masks.length ? `Occlusion · ${snippet.masks.length} regions` : 'PDF capture'}</strong><span>{snippet.name}</span></div>
          <div className="snip-tray-actions"><button onClick={() => onInsertSnippet(snippet, 'front')} title="Insert into front/text">Front</button><button onClick={() => onInsertSnippet(snippet, 'back')} title="Insert into back/extra">Back</button></div>
        </article>)}</div></div>}
      </>}
      {pendingSnip && <PdfAnnotationEditor snip={pendingSnip} onClose={() => setPendingSnip(null)} onSave={saveSnippet} />}
    </section>
  );
}
