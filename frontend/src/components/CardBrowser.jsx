import { useEffect, useMemo, useRef, useState } from 'react';
import CardPreviewFrame from './CardPreviewFrame';

const TYPES = ['All', 'Basic', 'Cloze', 'Image Occlusion'];
const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'A to Z'], ['type', 'By type']];
const SHORTCUTS = [
  ['↑ ↓  or  j k', 'Move between cards'],
  ['Home / End', 'First / last card'],
  ['Enter  or  e', 'Edit this card'],
  ['Space', 'Select / unselect'],
  ['Shift + ↑ ↓', 'Extend the selection'],
  ['Ctrl + A', 'Select all shown'],
  ['Delete  or  x', 'Delete (undo with Ctrl + Z)'],
  ['d', 'Duplicate'],
  ['t', 'Add a tag to the selection'],
  ['a', 'Show answer / question'],
  ['n', 'Night / day preview'],
  ['/', 'Search'],
  ['Esc', 'Clear search, then close'],
];

const flat = (text) => String(text || '').replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/g, '[$1]');
const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

/**
 * Full-screen card browser: search + filters + tags, real card preview, multi-select with bulk tag / delete,
 * duplicate, undo and a complete keyboard layout. `cards` is newest first; `setCards` replaces the deck.
 */
export default function CardBrowser({ cards, setCards, deckName, onEdit, onClose, helpers, folders, onMove }) {
  const { getCardPreview, formatTag, pillLabel } = helpers;
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All');
  const [tag, setTag] = useState('');
  const [only, setOnly] = useState({ pills: false, image: false, dupes: false });
  const [sort, setSort] = useState('new');
  const [cursor, setCursor] = useState(0); // index in `shown`
  const [picked, setPicked] = useState(() => new Set()); // card indexes
  const [anchor, setAnchor] = useState(null);
  const [side, setSide] = useState('answer');
  const [night, setNight] = useState(true);
  const [tagDraft, setTagDraft] = useState('');
  const [tagging, setTagging] = useState(false);
  const [undo, setUndo] = useState(null);
  const [help, setHelp] = useState(false);
  const [moveNote, setMoveNote] = useState('');
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const tagRef = useRef(null);

  const info = useMemo(() => {
    const seen = new Map();
    return cards.map((card, index) => {
      const q = card.type === 'Image Occlusion' ? '' : plain(card.question).toLowerCase();
      if (q) seen.set(q, (seen.get(q) || 0) + 1);
      return { card, index, q };
    }).map(item => ({
      ...item,
      dupe: item.q && seen.get(item.q) > 1,
      hasPills: (item.card.pills || []).some(p => plain(p) || /<img/i.test(p || '')),
      hasImage: item.card.type === 'Image Occlusion' || /<img/i.test(`${item.card.question || ''}${item.card.answer || ''}`),
      text: `${item.card.type} ${plain(item.card.question)} ${plain(item.card.answer)} ${(item.card.masks || []).map(m => m.label).join(' ')} ${(item.card.tags || []).join(' ')}`.toLowerCase(),
    }));
  }, [cards]);

  const tagCounts = useMemo(() => {
    const counts = new Map();
    info.forEach(({ card }) => (card.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [info]);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = info.filter(item => (type === 'All' || (item.card.type || 'Basic') === type)
      && (!tag || (item.card.tags || []).some(t => t === tag || t.startsWith(`${tag}::`)))
      && (!only.pills || item.hasPills) && (!only.image || item.hasImage) && (!only.dupes || item.dupe)
      && words.every(w => item.text.includes(w)));
    if (sort === 'old') list = [...list].reverse();
    if (sort === 'az') list = [...list].sort((a, b) => plain(a.card.question || a.card.answer).localeCompare(plain(b.card.question || b.card.answer)));
    if (sort === 'type') list = [...list].sort((a, b) => (a.card.type || '').localeCompare(b.card.type || ''));
    return list;
  }, [info, search, type, tag, only, sort]);

  const at = Math.min(cursor, Math.max(0, shown.length - 1));
  const current = shown[at] || null;
  const targets = picked.size ? [...picked] : current ? [current.index] : [];

  useEffect(() => { listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [at, shown]);
  useEffect(() => { if (cursor > shown.length - 1) setCursor(Math.max(0, shown.length - 1)); }, [shown.length, cursor]);
  useEffect(() => { if (tagging) tagRef.current?.focus(); }, [tagging]);

  const commit = (next, note) => { setUndo({ cards, note }); setCards(next); };
  const remove = (indexes) => {
    if (!indexes.length) return;
    const gone = new Set(indexes);
    commit(cards.filter((_, i) => !gone.has(i)), `Deleted ${indexes.length} card${indexes.length === 1 ? '' : 's'}`);
    setPicked(new Set());
  };
  const duplicate = (indexes) => {
    if (!indexes.length) return;
    const chosen = new Set(indexes);
    const next = [];
    cards.forEach((card, i) => { next.push(card); if (chosen.has(i)) next.push({ ...card, created: new Date().toLocaleTimeString(), tags: [...(card.tags || [])], pills: [...(card.pills || [])] }); });
    commit(next, `Duplicated ${indexes.length} card${indexes.length === 1 ? '' : 's'}`);
  };
  const addTag = (indexes, raw) => {
    const clean = raw.trim().replace(/\s+/g, '_');
    if (!clean || !indexes.length) return;
    const chosen = new Set(indexes);
    commit(cards.map((card, i) => (chosen.has(i) && !(card.tags || []).includes(clean) ? { ...card, tags: [...(card.tags || []), clean] } : card)), `Tagged ${indexes.length} card${indexes.length === 1 ? '' : 's'} “${clean}”`);
  };
  const removeTag = (indexes, name) => {
    const chosen = new Set(indexes);
    commit(cards.map((card, i) => (chosen.has(i) ? { ...card, tags: (card.tags || []).filter(t => t !== name) } : card)), `Removed tag “${name}”`);
  };
  const doUndo = () => { if (!undo) return; setCards(undo.cards); setUndo(null); setPicked(new Set()); };

  const select = (position, { shift = false, toggle = false } = {}) => {
    const clamped = Math.max(0, Math.min(shown.length - 1, position));
    setCursor(clamped);
    const item = shown[clamped];
    if (!item) return;
    if (shift && anchor !== null) {
      const from = Math.min(anchor, clamped);
      const to = Math.max(anchor, clamped);
      setPicked(new Set(shown.slice(from, to + 1).map(x => x.index)));
    } else if (toggle) {
      setPicked(prev => { const next = new Set(prev); if (next.has(item.index)) next.delete(item.index); else next.add(item.index); return next; });
      setAnchor(clamped);
    } else { setAnchor(clamped); }
  };

  useEffect(() => {
    const onKey = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (help) setHelp(false);
        else if (tagging) { setTagging(false); setTagDraft(''); }
        else if (typing && event.target === searchRef.current && search) setSearch('');
        else if (typing) event.target.blur();
        else if (picked.size) setPicked(new Set());
        else onClose();
        return;
      }
      if (typing) {
        if (event.key === 'ArrowDown' && event.target === searchRef.current) { event.preventDefault(); searchRef.current.blur(); select(0); }
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'a') { event.preventDefault(); setPicked(new Set(shown.map(x => x.index))); }
        else if (event.key.toLowerCase() === 'z') { event.preventDefault(); doUndo(); }
        return;
      }
      const key = event.key;
      if (['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', 'e', ' ', 'Delete', 'Backspace', 'x', 'd', 't', 'a', 'n', '/', '?'].includes(key)) event.stopPropagation(); // keep the editor's own shortcuts from firing underneath
      if (key === 'ArrowDown' || key === 'j') { event.preventDefault(); select(at + 1, { shift: event.shiftKey }); }
      else if (key === 'ArrowUp' || key === 'k') { event.preventDefault(); select(at - 1, { shift: event.shiftKey }); }
      else if (key === 'Home') { event.preventDefault(); select(0, { shift: event.shiftKey }); }
      else if (key === 'End') { event.preventDefault(); select(shown.length - 1, { shift: event.shiftKey }); }
      else if (key === 'PageDown') { event.preventDefault(); select(at + 10); }
      else if (key === 'PageUp') { event.preventDefault(); select(at - 10); }
      else if (key === 'Enter' || key === 'e') { if (current) { event.preventDefault(); onEdit(current.index); } }
      else if (key === ' ') { event.preventDefault(); select(at, { toggle: true }); }
      else if (key === 'Delete' || key === 'Backspace' || key === 'x') { event.preventDefault(); remove(targets); }
      else if (key === 'd') { event.preventDefault(); duplicate(targets); }
      else if (key === 't') { event.preventDefault(); setTagging(true); }
      else if (key === 'a') setSide(s => (s === 'answer' ? 'question' : 'answer'));
      else if (key === 'n') setNight(v => !v);
      else if (key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      else if (key === '?') setHelp(v => !v);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toggleOnly = (name) => setOnly(prev => ({ ...prev, [name]: !prev[name] }));
  const detail = current?.card;
  const sameTags = detail ? (detail.tags || []) : [];

  return (
    <div className="cb" role="dialog" aria-modal="true" aria-label="Browse cards">
      <header className="cb-top">
        <div className="cb-title"><span className="section-eyebrow">BROWSE</span><h2>{deckName || 'Default Deck'} <em>{shown.length}{shown.length !== cards.length ? ` of ${cards.length}` : ''} cards</em></h2></div>
        <label className="cb-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); setCursor(0); }} placeholder="Search text, answers, tags…   ( / )" aria-label="Search cards" autoFocus /></label>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort cards">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button type="button" className="cb-btn" onClick={() => setHelp(v => !v)} title="Keyboard shortcuts (?)">⌨ Keys</button>
        <button type="button" className="cb-btn cb-close" onClick={onClose} aria-label="Close card browser" title="Close (Esc)">✕</button>
      </header>

      <div className="cb-filters" role="toolbar" aria-label="Filters">
        {TYPES.map(name => <button type="button" key={name} className={type === name ? 'on' : ''} onClick={() => { setType(name); setCursor(0); }}>{name}</button>)}
        <i />
        <button type="button" className={only.pills ? 'on' : ''} onClick={() => toggleOnly('pills')}>Has pills</button>
        <button type="button" className={only.image ? 'on' : ''} onClick={() => toggleOnly('image')}>Has image</button>
        <button type="button" className={only.dupes ? 'on' : ''} onClick={() => toggleOnly('dupes')}>Duplicates</button>
        {(tag || type !== 'All' || only.pills || only.image || only.dupes || search) && <button type="button" className="cb-clear" onClick={() => { setTag(''); setType('All'); setOnly({ pills: false, image: false, dupes: false }); setSearch(''); }}>Clear filters</button>}
      </div>

      {(picked.size > 0 || tagging) && (
        <div className="cb-bulk">
          <b>{picked.size || 1} selected</b>
          {tagging ? (
            <form onSubmit={e => { e.preventDefault(); addTag(targets, tagDraft); setTagging(false); setTagDraft(''); }}>
              <input ref={tagRef} value={tagDraft} onChange={e => setTagDraft(e.target.value)} placeholder="tag name, e.g. Pathology::Anemia" aria-label="Tag to add" list="cb-taglist" />
              <datalist id="cb-taglist">{tagCounts.map(([t]) => <option key={t} value={t} />)}</datalist>
              <button type="submit" className="cb-btn">Add tag</button>
              <button type="button" className="cb-btn" onClick={() => { setTagging(false); setTagDraft(''); }}>Cancel</button>
            </form>
          ) : (
            <>
              <button type="button" className="cb-btn" onClick={() => setTagging(true)}>+ Tag (t)</button>
              <button type="button" className="cb-btn" onClick={() => duplicate(targets)}>Duplicate (d)</button>
              <button type="button" className="cb-btn cb-danger" onClick={() => remove(targets)}>Delete (x)</button>
              {folders && folders.list.length > 1 && (
                <select className="cb-move" value="" aria-label="Move selected cards to a folder" onChange={e => { const moved = onMove(targets, e.target.value); setPicked(new Set()); setUndo(null); if (moved) setMoveNote(`Moved ${moved} card${moved === 1 ? '' : 's'}`); }}>
                  <option value="">Move to folder…</option>
                  {folders.list.filter(f => f.id !== folders.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
              <button type="button" className="cb-btn" onClick={() => setPicked(new Set())}>Unselect</button>
            </>
          )}
        </div>
      )}

      <div className="cb-body">
        <aside className="cb-tags" aria-label="Tags">
          <span className="cb-h">TAGS</span>
          <button type="button" className={!tag ? 'on' : ''} onClick={() => { setTag(''); setCursor(0); }}><span>All cards</span><b>{cards.length}</b></button>
          {tagCounts.map(([name, count]) => <button type="button" key={name} className={tag === name ? 'on' : ''} onClick={() => { setTag(name); setCursor(0); }} title={name}><span>{formatTag(name)}</span><b>{count}</b></button>)}
          {!tagCounts.length && <p className="cb-none">No tags yet. Select cards and press <kbd>t</kbd>.</p>}
        </aside>

        <div className="cb-list" ref={listRef} role="listbox" aria-label="Cards" aria-multiselectable="true">
          {shown.map((item, position) => {
            const { card, index } = item;
            const isCurrent = position === at;
            const isPicked = picked.has(index);
            return (
              <div key={`${card.created}-${index}`} role="option" aria-selected={isCurrent} data-current={isCurrent} className={`cb-row${isCurrent ? ' cur' : ''}${isPicked ? ' pick' : ''}`}
                onClick={e => select(position, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey })} onDoubleClick={() => onEdit(index)}>
                <input type="checkbox" checked={isPicked} onChange={() => select(position, { toggle: true })} onClick={e => e.stopPropagation()} aria-label="Select card" tabIndex={-1} />
                <span className="cb-num">{String(cards.length - index).padStart(2, '0')}</span>
                <span className="cb-main"><strong>{flat(getCardPreview(card.question)) || (card.type === 'Image Occlusion' ? 'Image occlusion' : '(empty)')}</strong><small>{card.type === 'Image Occlusion' ? `${(card.masks || []).length} hidden regions` : getCardPreview(card.answer) || 'No answer'}</small></span>
                <span className="cb-badges">
                  {item.dupe && <em className="warn" title="Another card has the same text">dup</em>}
                  {item.hasPills && <em title="Has pills">pills</em>}
                  {item.hasImage && card.type !== 'Image Occlusion' && <em title="Has an image">img</em>}
                  <em className="t">{card.type === 'Image Occlusion' ? 'IO' : card.type === 'Cloze' ? 'Cloze' : 'Basic'}</em>
                </span>
              </div>
            );
          })}
          {!shown.length && <div className="cb-empty">{cards.length ? 'No cards match. Try clearing the filters.' : 'This deck has no cards yet.'}</div>}
        </div>

        <section className="cb-detail" aria-label="Card preview">
          {current ? (
            <>
              <div className="cb-detail-bar">
                <span>Card {cards.length - current.index}</span>
                {detail.type !== 'Image Occlusion' && <div className="cb-seg"><button type="button" className={side === 'question' ? 'on' : ''} onClick={() => setSide('question')}>Question</button><button type="button" className={side === 'answer' ? 'on' : ''} onClick={() => setSide('answer')}>Answer</button></div>}
                <div className="cb-seg"><button type="button" className={night ? 'on' : ''} onClick={() => setNight(true)}>Night</button><button type="button" className={!night ? 'on' : ''} onClick={() => setNight(false)}>Day</button></div>
                <span className="cb-spacer" />
                <button type="button" className="cb-btn" onClick={() => duplicate([current.index])}>Duplicate</button>
                <button type="button" className="cb-btn cb-danger" onClick={() => remove([current.index])}>Delete</button>
                <button type="button" className="cb-btn cb-primary" onClick={() => onEdit(current.index)}>Edit</button>
              </div>
              <div className="cb-preview">
                {detail.type === 'Image Occlusion'
                  ? <div className="cb-io"><img src={detail.imageData} alt="Image occlusion" /><span>{(detail.masks || []).length} hidden regions · {detail.occlusionMode || 'hide-all'}</span>{detail.answer && <div dangerouslySetInnerHTML={{ __html: detail.answer }} />}</div>
                  : <CardPreviewFrame key={`${current.index}-${detail.created}`} type={detail.type === 'Cloze' ? 'Cloze' : 'Basic'} front={detail.question || ''} back={detail.answer || ''} pills={detail.pills} sequential={Boolean(detail.sequential)} side={side} night={night} clozeOrd={1} device="desktop" />}
              </div>
              <div className="cb-meta">
                {sameTags.map(name => <span key={name} className="cb-chip">{formatTag(name)}<button type="button" onClick={() => removeTag([current.index], name)} aria-label={`Remove tag ${name}`}>×</button></span>)}
                <button type="button" className="cb-chip add" onClick={() => setTagging(true)}>+ tag</button>
                {(detail.pills || []).map((p, i) => (plain(p) || /<img/i.test(p || '') ? <span key={i} className="cb-chip pill">{pillLabel(i)}</span> : null))}
              </div>
            </>
          ) : <div className="cb-empty">Select a card to preview it.</div>}
        </section>
      </div>

      <footer className="cb-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> edit</span><span><kbd>Space</kbd> select</span><span><kbd>x</kbd> delete</span><span><kbd>t</kbd> tag</span><span><kbd>a</kbd> answer</span><span><kbd>/</kbd> search</span><span><kbd>?</kbd> all keys</span>
        {moveNote && <span className="cb-undo" role="status">{moveNote}</span>}
        {undo && <button type="button" className="cb-undo" onClick={doUndo}>{undo.note} · Undo (Ctrl+Z)</button>}
      </footer>

      {help && (
        <div className="cb-help" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
          <div onClick={e => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <dl>{SHORTCUTS.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl>
            <p>Press Esc or ? to close.</p>
          </div>
        </div>
      )}
    </div>
  );
}
