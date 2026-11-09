import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PILL_COUNT, cleanPillHtml, loadSettings, normalizePills, saveSettings } from '../beerus';
import { chatgptFromClipboard } from '../chatgptFormat';
import { repairOldChatGptPaste } from '../chatgptFormat';
import { sanitizePastedHtml } from './editorHelpers';
import { shrinkImageFile } from './PillFields';
import CardPreviewFrame from './CardPreviewFrame';
import { setFullEditor } from '../useDevice';
import { logAdded } from '../activity';
import './mobile.css';

const STATE_KEY = 'ankiDeckBuilderState';
const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
const flat = (text) => String(text || '').replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/g, '[$1]');
const readState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } };
const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');

function Sheet({ title, onClose, children, footer }) {
  return (
    <div className="m-sheet-wrap" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="m-sheet" onClick={e => e.stopPropagation()}>
        <header><h3>{title}</h3><button type="button" onClick={onClose} aria-label="Close">Done</button></header>
        <div className="m-sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** A rich text box (contentEditable) that cleans whatever is pasted or dropped into it. */
function Field({ label, boxRef, placeholder, onInput, format = 'auto', minHeight = 96 }) {
  const onPaste = async (event) => {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    event.preventDefault();
    if (files.length) {
      const shrunk = await shrinkImageFile(files[0]).catch(() => null);
      document.execCommand('insertHTML', false, `<img src="${shrunk || await readAsDataUrl(files[0])}" style="max-width:100%;height:auto;">`);
    } else {
      const html = event.clipboardData?.getData('text/html');
      const text = event.clipboardData?.getData('text/plain') || '';
      const gpt = chatgptFromClipboard({ html, text }, format);
      document.execCommand('insertHTML', false, gpt || (html ? sanitizePastedHtml(html) : escapeText(text)));
    }
    onInput?.();
  };
  return (
    <label className="m-field">
      <span>{label}</span>
      <div ref={boxRef} className="m-box" contentEditable suppressContentEditableWarning role="textbox" aria-label={label} data-placeholder={placeholder} style={{ minHeight }} onInput={onInput} onPaste={onPaste} />
    </label>
  );
}

export default function MobileShell() {
  const initial = useMemo(readState, []);
  const [tab, setTab] = useState('create');
  const [cards, setCards] = useState(() => initial.cards || []);
  const [deckName, setDeckName] = useState(initial.deck || 'Default Deck');
  const [type, setType] = useState(initial.cardType === 'Cloze' ? 'Cloze' : 'Basic');
  const [tags, setTags] = useState(() => initial.tags || []);
  const [tagDraft, setTagDraft] = useState('');
  const [pills, setPills] = useState(['', '', '', '']);
  const [editing, setEditing] = useState(null);
  const [pillSheet, setPillSheet] = useState(null);
  const [toast, setToast] = useState('');
  const [undo, setUndo] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null); // card index shown in the preview sheet
  const [side, setSide] = useState('answer');
  const [exporting, setExporting] = useState('');
  const [settings, setSettings] = useState(() => loadSettings());
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const pillBoxRef = useRef(null);
  const toastTimer = useRef(null);

  const say = useCallback((text) => { setToast(text); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2600); }, []);

  // One store with the full editor: the same key, so a deck started here opens on desktop and the other way round.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(STATE_KEY, JSON.stringify({ ...readState(), deck: deckName, cards, cardType: type, tags })); } catch { /* storage full */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cards, deckName, type, tags]);

  const allTags = useMemo(() => [...new Set(cards.flatMap(card => card.tags || []))].sort(), [cards]);
  const filled = pills.map(html => cleanPillHtml(html) !== '');

  const clearForm = () => {
    if (frontRef.current) frontRef.current.innerHTML = '';
    if (backRef.current) backRef.current.innerHTML = '';
    setPills(['', '', '', '']);
    setEditing(null);
  };

  const makeCloze = (same) => {
    const box = frontRef.current;
    const selection = window.getSelection();
    const text = selection?.toString() || '';
    if (!box || !text.trim() || !box.contains(selection.anchorNode)) { say('Select the words to hide first, then tap Cloze.'); return; }
    const numbers = [...box.innerHTML.matchAll(/\{\{c(\d+)::/g)].map(m => Number(m[1]));
    const max = numbers.length ? Math.max(...numbers) : 0;
    const n = same ? Math.max(1, max) : max + 1;
    document.execCommand('insertText', false, `{{c${n}::${text}}}`);
  };

  const save = () => {
    const front = (frontRef.current?.innerHTML || '').trim();
    const back = (backRef.current?.innerHTML || '').trim();
    if (!plain(front) && !/<img/i.test(front)) { say('Write the front first.'); return; }
    if (type === 'Cloze' && !/\{\{c\d+::[^}]+\}\}/.test(front)) { say('Select some words and tap Cloze to hide them.'); return; }
    if (type === 'Basic' && !plain(back) && !/<img/i.test(back)) { say('Add the answer on the back.'); return; }
    const card = { type, question: front, answer: back, tags, pills: normalizePills(pills), created: new Date().toLocaleTimeString(), createdAt: Date.now() };
    if (editing !== null) {
      setCards(prev => prev.map((old, i) => (i === editing ? { ...old, ...card, created: old.created } : old)));
      say('Card saved.');
    } else {
      setCards(prev => [card, ...prev]);
      logAdded(1);
      say(`Card added. ${cards.length + 1} in the deck.`);
    }
    clearForm();
  };

  const edit = (index) => {
    const card = cards[index];
    if (!card || card.type === 'Image Occlusion') { say('Image occlusion cards are edited on a tablet or computer.'); return; }
    setType(card.type === 'Cloze' ? 'Cloze' : 'Basic');
    setTags(card.tags || []);
    setPills(normalizePills(card.pills).map(html => repairOldChatGptPaste(html)));
    setEditing(index);
    setOpen(null);
    setTab('create');
    window.setTimeout(() => { if (frontRef.current) frontRef.current.innerHTML = card.question || ''; if (backRef.current) backRef.current.innerHTML = card.answer || ''; }, 0);
  };

  const removeCard = (index) => { setUndo({ cards }); setCards(prev => prev.filter((_, i) => i !== index)); setOpen(null); };
  const duplicateCard = (index) => { setUndo({ cards }); setCards(prev => { const next = [...prev]; next.splice(index, 0, { ...prev[index], created: new Date().toLocaleTimeString() }); return next; }); setOpen(null); say('Duplicated.'); };

  const addTag = (raw) => {
    const clean = raw.trim().replace(/\s+/g, '_');
    if (clean && !tags.includes(clean)) setTags(prev => [...prev, clean]);
    setTagDraft('');
  };

  const openPill = (index) => {
    setPillSheet(index);
    window.setTimeout(() => { if (pillBoxRef.current) pillBoxRef.current.innerHTML = pills[index] || ''; }, 0);
  };
  const readPillBox = () => { const html = pillBoxRef.current?.innerHTML || ''; setPills(prev => prev.map((old, i) => (i === pillSheet ? html : old))); };
  const addPillImage = async (file) => {
    if (!file) return;
    const shrunk = await shrinkImageFile(file).catch(() => null);
    pillBoxRef.current?.insertAdjacentHTML('beforeend', `<img src="${shrunk || await readAsDataUrl(file)}">`);
    readPillBox();
  };

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return cards.map((card, index) => ({ card, index })).filter(({ card }) => {
      const hay = `${card.type} ${plain(card.question)} ${plain(card.answer)} ${(card.tags || []).join(' ')}`.toLowerCase();
      return words.every(word => hay.includes(word));
    });
  }, [cards, search]);

  const exportDeck = async () => {
    if (!cards.length) { say('Add a card first.'); return; }
    setExporting('Preparing…');
    const current = loadSettings();
    const payload = {
      deck_name: deckName, settings: current,
      cards: cards.map(c => ({
        type: c.type, question: c.question, answer: c.answer, tags: c.tags, pills: normalizePills(c.pills).map(html => repairOldChatGptPaste(html)),
        ...(c.type === 'Cloze' ? { sequential: Boolean(c.sequential) } : {}),
        ...(c.type === 'Image Occlusion' ? { image_data: c.imageData, image_width: c.imageWidth, masks: c.masks, occlusion_mode: c.occlusionMode, header: c.header || '' } : {}),
      })),
    };
    try {
      const { exportDeckLocally } = await import('../browserExport');
      const result = await exportDeckLocally(payload, { onProgress: (stage, done, total) => setExporting(stage === 'prepare' ? `Preparing cards ${done}/${total}…` : 'Building the deck…') });
      setExporting(result.parts > 1 ? `Done: ${result.parts} files downloaded. Import all of them into Anki.` : 'Done. Open the downloaded .apkg in Anki (or share it to AnkiMobile).');
    } catch (error) { setExporting(`Export failed: ${error.message}`); }
  };

  const setSetting = (path, value) => {
    const next = loadSettings();
    let node = next;
    path.slice(0, -1).forEach(key => { node = node[key]; });
    node[path[path.length - 1]] = value;
    saveSettings(next);
    setSettings(loadSettings());
  };
  const renamePill = (index, label) => { const next = loadSettings(); next.pills[index].label = label.slice(0, 24) || next.pills[index].label; saveSettings(next); setSettings(loadSettings()); };

  const openCard = open !== null ? cards[open] : null;

  return (
    <div className="m-app">
      <header className="m-top">
        <h1>{tab === 'create' ? (editing !== null ? 'Edit card' : 'New card') : tab === 'deck' ? 'Deck' : tab === 'export' ? 'Export' : 'More'}</h1>
        <span>{deckName} · {cards.length}</span>
      </header>

      <main className="m-main">
        {tab === 'create' && (
          <section className="m-create">
            <div className="m-seg" role="tablist" aria-label="Card type">
              {['Basic', 'Cloze'].map(name => <button key={name} type="button" role="tab" aria-selected={type === name} className={type === name ? 'on' : ''} onClick={() => setType(name)}>{name}</button>)}
            </div>
            <Field label={type === 'Cloze' ? 'Text' : 'Front'} boxRef={frontRef} placeholder={type === 'Cloze' ? 'Type the sentence, select the words to hide, tap Cloze' : 'Question…'} minHeight={110} />
            {type === 'Cloze' && (
              <div className="m-cloze-bar">
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => makeCloze(false)}>Cloze (new #)</button>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => makeCloze(true)}>Cloze (same #)</button>
              </div>
            )}
            <Field label={type === 'Cloze' ? 'Extra' : 'Back'} boxRef={backRef} placeholder={type === 'Cloze' ? 'Optional explanation…' : 'Answer…'} minHeight={96} />
            <div className="m-block">
              <span className="m-label">Pills <small>reference images or notes under the answer</small></span>
              <div className="m-pills">
                {settings.pills.slice(0, PILL_COUNT).map((pill, index) => (
                  <button type="button" key={index} className={`m-pill${filled[index] ? ' has' : ''}`} style={{ '--pc': pill.color }} onClick={() => openPill(index)}>
                    {pill.iconType === 'emoji' && pill.icon ? <b>{pill.icon}</b> : null}{pill.label}{filled[index] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>
            <div className="m-block">
              <span className="m-label">Tags</span>
              <div className="m-tags">
                {tags.map(tag => <span key={tag} className="m-chip">{tag}<button type="button" onClick={() => setTags(prev => prev.filter(t => t !== tag))} aria-label={`Remove ${tag}`}>×</button></span>)}
                <input value={tagDraft} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); } }} onBlur={() => addTag(tagDraft)} placeholder="Add tag…" list="m-taglist" aria-label="Add a tag" />
                <datalist id="m-taglist">{allTags.map(tag => <option key={tag} value={tag} />)}</datalist>
              </div>
            </div>
            <div className="m-savebar">
              {editing !== null && <button type="button" className="m-ghost" onClick={clearForm}>Cancel</button>}
              <button type="button" className="m-primary" onClick={save}>{editing !== null ? 'Save changes' : 'Add card'}</button>
            </div>
          </section>
        )}

        {tab === 'deck' && (
          <section className="m-deck">
            <input className="m-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cards or tags…" aria-label="Search cards" />
            {visible.map(({ card, index }) => (
              <button type="button" key={`${card.created}-${index}`} className="m-card" onClick={() => { setOpen(index); setSide('answer'); }}>
                <strong>{flat(plain(card.question)) || (card.type === 'Image Occlusion' ? 'Image occlusion' : '(empty)')}</strong>
                <small>{card.type === 'Image Occlusion' ? `${(card.masks || []).length} hidden regions` : plain(card.answer) || 'No answer'}</small>
                <span className="m-meta"><em>{card.type === 'Image Occlusion' ? 'IO' : card.type}</em>{(card.tags || []).slice(0, 2).map(tag => <em key={tag}>{tag}</em>)}</span>
              </button>
            ))}
            {!visible.length && <p className="m-empty">{cards.length ? 'No cards match.' : 'No cards yet. Add one from the Create tab.'}</p>}
          </section>
        )}

        {tab === 'export' && (
          <section className="m-export">
            <label className="m-field"><span>Deck name</span><input className="m-input" value={deckName} onChange={e => setDeckName(e.target.value)} /></label>
            <p className="m-note">{cards.length} card{cards.length === 1 ? '' : 's'}. The deck is built on this device and works offline.</p>
            <button type="button" className="m-primary" onClick={exportDeck} disabled={!!exporting && !/^(Done|Export failed)/.test(exporting)}>Export .apkg</button>
            {exporting && <p className="m-note" role="status">{exporting}</p>}
            <p className="m-note small">On iPhone, tap the download, then Share, then AnkiMobile. Image occlusion and PDF study tools are on the tablet and computer version.</p>
          </section>
        )}

        {tab === 'more' && (
          <section className="m-more">
            <div className="m-block"><span className="m-label">Card text size <b>{settings.appearance.fontSize}px</b></span><input type="range" min="16" max="40" value={settings.appearance.fontSize} onChange={e => setSetting(['appearance', 'fontSize'], Number(e.target.value))} aria-label="Card text size" /></div>
            <div className="m-block"><span className="m-label">Pill size <b>{settings.pillStyle.scale}%</b></span><input type="range" min="60" max="200" step="5" value={settings.pillStyle.scale} onChange={e => setSetting(['pillStyle', 'scale'], Number(e.target.value))} aria-label="Pill size" /></div>
            <div className="m-block"><span className="m-label">Pill text size <b>{settings.pillBody.fontSize}px</b></span><input type="range" min="12" max="28" value={settings.pillBody.fontSize} onChange={e => setSetting(['pillBody', 'fontSize'], Number(e.target.value))} aria-label="Pill text size" /></div>
            <div className="m-block"><span className="m-label">Space above pills <b>{settings.pillStyle.gap}px</b></span><input type="range" min="0" max="120" step="2" value={settings.pillStyle.gap} onChange={e => setSetting(['pillStyle', 'gap'], Number(e.target.value))} aria-label="Space above pills" /></div>
            <div className="m-block"><span className="m-label">Pill names</span>{settings.pills.map((pill, index) => <input key={index} className="m-input" defaultValue={pill.label} maxLength={24} onBlur={e => renamePill(index, e.target.value)} aria-label={`Name of pill ${index + 1}`} />)}</div>
            <button type="button" className="m-ghost wide" onClick={() => { setFullEditor(true); window.location.reload(); }}>Open the full editor (small screen)</button>
            <p className="m-note small">The full editor has every option (PDF, image occlusion, all settings). It works best on a tablet or computer.</p>
          </section>
        )}
      </main>

      {toast && <div className="m-toast" role="status">{toast}</div>}
      {undo && tab === 'deck' && !toast && <button type="button" className="m-toast undo" onClick={() => { setCards(undo.cards); setUndo(null); }}>Undo last change</button>}

      <nav className="m-tabs" role="tablist" aria-label="Sections">
        {[['create', 'Create'], ['deck', `Deck${cards.length ? ` ${cards.length}` : ''}`], ['export', 'Export'], ['more', 'More']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {pillSheet !== null && (
        <Sheet title={settings.pills[pillSheet].label} onClose={() => { readPillBox(); setPillSheet(null); }}
          footer={<><label className="m-ghost">Add image<input type="file" accept="image/*" hidden onChange={e => { addPillImage(e.target.files?.[0]); e.target.value = ''; }} /></label><button type="button" className="m-ghost" onClick={() => { if (pillBoxRef.current) pillBoxRef.current.innerHTML = ''; readPillBox(); }}>Clear</button></>}>
          <p className="m-note small">Paste a ChatGPT answer or a screenshot, type notes, or add an image. ChatGPT answers keep their look.</p>
          <div ref={pillBoxRef} className="m-box tall" contentEditable suppressContentEditableWarning role="textbox" aria-label="Pill content" data-placeholder="Paste or type…"
            onInput={readPillBox}
            onPaste={async event => {
              const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
              event.preventDefault();
              if (files.length) { await addPillImage(files[0]); return; }
              const html = event.clipboardData?.getData('text/html');
              const text = event.clipboardData?.getData('text/plain') || '';
              const gpt = chatgptFromClipboard({ html, text }, settings.pills[pillSheet].format);
              document.execCommand('insertHTML', false, gpt || (html ? sanitizePastedHtml(html) : escapeText(text)));
              readPillBox();
            }} />
        </Sheet>
      )}

      {openCard && (
        <Sheet title={`Card ${cards.length - open}`} onClose={() => setOpen(null)}
          footer={<><button type="button" className="m-ghost" onClick={() => duplicateCard(open)}>Duplicate</button><button type="button" className="m-ghost danger" onClick={() => removeCard(open)}>Delete</button><button type="button" className="m-primary" onClick={() => edit(open)}>Edit</button></>}>
          {openCard.type === 'Image Occlusion'
            ? <div><img className="m-io" src={openCard.imageData} alt="Image occlusion" /><p className="m-note">{(openCard.masks || []).length} hidden regions</p></div>
            : (
              <>
                <div className="m-seg small"><button type="button" className={side === 'question' ? 'on' : ''} onClick={() => setSide('question')}>Question</button><button type="button" className={side === 'answer' ? 'on' : ''} onClick={() => setSide('answer')}>Answer</button></div>
                <CardPreviewFrame key={`${open}-${openCard.created}`} type={openCard.type === 'Cloze' ? 'Cloze' : 'Basic'} front={openCard.question || ''} back={openCard.answer || ''} pills={openCard.pills} sequential={Boolean(openCard.sequential)} side={side} night device="phone" />
              </>
            )}
          <div className="m-meta">{(openCard.tags || []).map(tag => <em key={tag}>{tag}</em>)}</div>
        </Sheet>
      )}
    </div>
  );
}
