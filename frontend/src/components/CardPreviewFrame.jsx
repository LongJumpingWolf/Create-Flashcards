import { useEffect, useMemo, useRef, useState } from 'react';
import { buildModels, loadSettings, normalizePills, previewDocument, themeMedia } from '../beerus';
import { clozeToSequentialHtml } from '../apkgBuilder';

const DEVICES = { phone: { label: 'Phone', width: 390 }, tablet: { label: 'Tablet', width: 640 }, desktop: { label: 'Desktop', width: 860 } };
export { DEVICES };

/**
 * Renders the card with the SAME note-type HTML and CSS the exported deck contains (the BeeRus template built from the
 * Settings page), so text size, pill size, colours, fonts and pill content here are exactly what the card will show.
 */
export default function CardPreviewFrame({ type, front, back, pills, sequential, side, night, clozeOrd = 1, device = 'desktop' }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(240);
  const settings = useMemo(() => loadSettings(), []); // re-read on every open of the preview (component mounts with the modal)

  const srcDoc = useMemo(() => {
    const models = buildModels(settings);
    const p = normalizePills(pills);
    const fields = Object.fromEntries(p.map((html, index) => [`Pill ${index + 1}`, html]));
    fields.Tags = '';
    let key = 'basic';
    if (type === 'Cloze') {
      key = sequential ? 'clozeSeq' : 'cloze';
      fields.Text = sequential ? clozeToSequentialHtml(front || '').html : (front || '');
      fields.Extra = back || '';
    } else {
      fields.Question = front || '';
      fields.Answer = back || '';
    }
    const mediaUrls = Object.fromEntries(themeMedia(settings).map(file => [file.name, file.dataUrl]));
    return previewDocument(models[key], fields, { side, night, mobile: device === 'phone', mediaUrls, clozeOrd, reportHeight: true });
  }, [settings, type, front, back, pills, sequential, side, night, clozeOrd, device]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== ref.current?.contentWindow) return;
      const h = Number(event.data?.beerusPreviewHeight);
      if (Number.isFinite(h) && h > 40) setHeight(Math.ceil(h) + 4);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const width = DEVICES[device]?.width || 860;
  return (
    <div className="card-preview-frame-wrap">
      <iframe ref={ref} title="Card preview" sandbox="allow-scripts" srcDoc={srcDoc} style={{ width: `${width}px`, maxWidth: '100%', height: `${height}px` }} />
    </div>
  );
}
