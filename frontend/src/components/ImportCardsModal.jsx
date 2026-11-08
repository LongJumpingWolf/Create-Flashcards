import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Upload, XCircle } from './Icons';
import { parseCardImport } from '../cardImport';

// Paste (or upload) the JSON an AI produced with the AnKing card-generator skill and add it to the deck.
export default function ImportCardsModal({ isOpen, onClose, existingCards, onImport }) {
  const [text, setText] = useState('');
  const fileRef = useRef(null);
  const result = useMemo(() => (text.trim() ? parseCardImport(text, existingCards) : null), [text, existingCards]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const loadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setText(await file.text());
  };
  const confirm = () => { onImport(result.cards, result.deckName); setText(''); onClose(); };

  return createPortal(
    <div className="import-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="import-header">
          <div><p className="section-eyebrow">IMPORT CARDS</p><h2 id="import-title">Paste AI-generated cards</h2></div>
          <button type="button" className="guide-close" onClick={onClose} aria-label="Close"><XCircle size={20} /></button>
        </header>
        <p className="import-hint">Paste the JSON (or the whole reply) produced with the AnKing card-generator skill. Nothing is added until you confirm.</p>
        <textarea className="import-text" value={text} onChange={event => setText(event.target.value)} placeholder='{"deck_name": "MBBS::Pharmacology", "cards": [ … ]}' spellCheck={false} aria-label="Cards JSON" autoFocus />
        <div className="import-tools">
          <button type="button" className="quiet-button" onClick={() => fileRef.current?.click()}><Upload size={15} /> Load a .json / .txt file</button>
          <input ref={fileRef} type="file" accept=".json,.txt,.md,application/json,text/plain" className="hidden" onChange={loadFile} />
          {text && <button type="button" className="quiet-button" onClick={() => setText('')}>Clear</button>}
        </div>

        {result && (
          <div className="import-result" role="status">
            <div className="import-summary">
              <strong>{result.cards.length}</strong> of {result.total} card{result.total === 1 ? '' : 's'} ready
              {Object.entries(result.counts).map(([name, count]) => <span key={name} className="import-chip">{count} {name}</span>)}
              {result.deckName && <span className="import-chip">deck: {result.deckName}</span>}
            </div>
            {result.problems.length > 0 && <div className="import-box import-problems"><b>Skipped / errors ({result.problems.length})</b><ul>{result.problems.slice(0, 12).map((problem, index) => <li key={index}>{problem}</li>)}{result.problems.length > 12 && <li>…and {result.problems.length - 12} more</li>}</ul></div>}
            {result.warnings.length > 0 && <div className="import-box import-warnings"><b>Warnings ({result.warnings.length})</b><ul>{result.warnings.slice(0, 8).map((warning, index) => <li key={index}>{warning}</li>)}{result.warnings.length > 8 && <li>…and {result.warnings.length - 8} more</li>}</ul></div>}
            {result.plans.length > 0 && <div className="import-box"><b>Image-occlusion plans ({result.plans.length}) — not imported</b><ul>{result.plans.slice(0, 6).map((plan, index) => <li key={index}>{plan.image_ref} · {plan.mode || 'hide-all'} · {(plan.masks || []).map(mask => mask.label).filter(Boolean).slice(0, 8).join(', ')}</li>)}</ul><small>Open the picture in the app, choose Image Occlusion and draw these regions.</small></div>}
          </div>
        )}

        <footer className="import-footer">
          <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={!result || !result.cards.length} onClick={confirm}><Check size={16} /> Add {result?.cards.length || 0} card{result?.cards.length === 1 ? '' : 's'}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
