import { useEffect, useMemo, useRef, useState } from 'react';
import { readFolders, readSnapshot } from '../folders';
import { activityStats, buildHeatmap, dayKey, folderToday, readActivity } from '../activity';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LIST_KEY = 'beerus-folders-collapsed';
const level = (n) => (n === null ? -1 : n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);
const send = (type, detail = {}) => window.dispatchEvent(new CustomEvent('beerus-folder-action', { detail: { type, ...detail } }));
const activeCardCount = () => { try { return (JSON.parse(localStorage.getItem('ankiDeckBuilderState') || '{}').cards || []).length; } catch { return 0; } };
const readCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(LIST_KEY) || '[]')); } catch { return new Set(); } };

/** Folders named Parent::Child become a tree like Anki's deck list (a parent that is not a folder itself is just a heading). */
function buildTree(list, own) {
  const root = { path: '', label: '', children: new Map(), folder: null, cards: 0, today: 0 };
  list.forEach(folder => {
    const parts = (folder.name || 'Untitled').split('::').map(part => part.trim()).filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('::');
      if (!node.children.has(part)) node.children.set(part, { path, label: part, children: new Map(), folder: null, cards: 0, today: 0 });
      node = node.children.get(part);
    });
    node.folder = folder;
    node.cards += own(folder).cards;
    node.today += own(folder).today;
  });
  const total = (node) => { node.children.forEach(child => { const t = total(child); node.cards += t.cards; node.today += t.today; }); return node; };
  total(root);
  return root;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return (
    <div className="fp-clock" aria-label="Current time">
      <strong>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</strong>
      <span>{DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</span>
    </div>
  );
}

function Heatmap({ log }) {
  const [shift, setShift] = useState(0); // years back
  const end = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - shift * 364); return d; }, [shift]);
  const columns = useMemo(() => buildHeatmap(log, 53, end), [log, end]);
  const labels = columns.map((column, index) => {
    const first = column[0].date;
    return index === 0 || first.getMonth() !== columns[index - 1][0].date.getMonth() ? `${MONTHS[first.getMonth()]} '${String(first.getFullYear()).slice(2)}` : '';
  });
  return (
    <div className="fp-heat">
      <div className="fp-heat-nav">
        <button type="button" onClick={() => setShift(s => s + 1)} aria-label="Previous year">‹</button>
        <button type="button" onClick={() => setShift(0)} aria-label="Back to today" title="Today">○</button>
        <button type="button" onClick={() => setShift(s => Math.max(0, s - 1))} disabled={shift === 0} aria-label="Next year">›</button>
      </div>
      <div className="fp-heat-scroll">
        <div className="fp-heat-grid" role="img" aria-label="Cards added per day">
          <div className="fp-heat-days">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="fp-heat-cols" style={{ gridTemplateColumns: `repeat(${columns.length}, 12px)` }}>
            {columns.map((column, c) => (
              <div key={c} className="fp-col">
                {column.map(day => (
                  <i key={day.key} className={`fp-day l${level(day.count)}${day.key === dayKey() ? ' now' : ''}`} title={day.count === null ? '' : `${day.count} card${day.count === 1 ? '' : 's'} added on ${day.date.getDate()} ${MONTHS[day.date.getMonth()]} ${day.date.getFullYear()}`} />
                ))}
              </div>
            ))}
          </div>
          <span />
          <div className="fp-heat-months" style={{ gridTemplateColumns: `repeat(${columns.length}, 12px)` }}>{labels.map((label, i) => <span key={i}>{label}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

const isInside = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}::`);
const allPaths = (node, out = []) => { node.children.forEach(child => { out.push(child.path); allPaths(child, out); }); return out; };

function DeckRow({ node, depth, collapsed, toggle, active, openNode, menu, setMenu, dnd, targets, moveTo }) {
  const hasChildren = node.children.size > 0;
  const isCollapsed = collapsed.has(node.path);
  const open = node.folder && node.folder.id === active;
  const isMenu = menu === node.path;
  const [picking, setPicking] = useState(false);
  const [pos, setPos] = useState(null);
  const dragging = dnd.drag === node.path;
  const over = dnd.over === node.path;
  const valid = dnd.drag && dnd.canDrop(dnd.drag, node.path);
  return (
    <>
      <tr className={`fp-row${open ? ' cur' : ''}${dragging ? ' drag' : ''}${over && valid ? ' drop' : ''}${over && !valid ? ' nodrop' : ''}`}
        draggable
        onDragStart={event => { event.dataTransfer.setData('text/plain', `beerus-deck:${node.path}`); event.dataTransfer.effectAllowed = 'move'; dnd.start(node.path); }}
        onDragEnd={dnd.end}
        onDragOver={event => { if (!dnd.drag) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = valid ? 'move' : 'none'; dnd.hover(node.path, hasChildren && isCollapsed); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); dnd.drop(node.path); }}>
        <td className="fp-name" style={{ paddingLeft: 10 + depth * 22 }}>
          <span className="fp-grip" aria-hidden="true" title="Drag onto another deck to make it a subdeck">⋮⋮</span>
          {hasChildren
            ? <button type="button" className="fp-twist" onClick={() => toggle(node.path)} aria-label={isCollapsed ? `Expand ${node.label}` : `Collapse ${node.label}`}>{isCollapsed ? '+' : '−'}</button>
            : <span className="fp-twist none" />}
          <button type="button" className={`fp-deck${node.folder ? '' : ' head'}`} onClick={() => (node.folder ? openNode(node.folder.id) : toggle(node.path))}>{node.label}</button>
        </td>
        <td className={`fp-num${node.cards ? ' has' : ''}`}>{node.cards}</td>
        <td className={`fp-num new${node.today ? ' has' : ''}`}>{node.today}</td>
        <td className="fp-gear">
          <button type="button" onClick={e => { e.stopPropagation(); setPicking(false); const r = e.currentTarget.getBoundingClientRect(); setPos({ right: Math.max(8, window.innerWidth - r.right), below: r.bottom + 4, above: window.innerHeight - r.top + 4, flip: r.bottom > window.innerHeight - 300 }); setMenu(isMenu ? '' : node.path); }} aria-label={`Options for ${node.label}`} aria-expanded={isMenu}>⚙</button>
          {isMenu && (
            <div className="fp-pop" role="menu" style={pos ? { position: 'fixed', right: pos.right, ...(pos.flip ? { bottom: pos.above, maxHeight: Math.max(160, window.innerHeight - 40 - (window.innerHeight - pos.above)) } : { top: pos.below, maxHeight: window.innerHeight - pos.below - 12 }), overflowY: 'auto' } : undefined} onClick={e => e.stopPropagation()}>
              {!picking && <>
                {node.folder && <button type="button" role="menuitem" onClick={() => { setMenu(''); openNode(node.folder.id); }}>Open</button>}
                {node.folder && <button type="button" role="menuitem" onClick={() => { setMenu(''); const next = window.prompt('Deck name', node.folder.name); if (next && next.trim()) send('rename', { id: node.folder.id, name: next.trim() }); }}>Rename</button>}
                <button type="button" role="menuitem" onClick={() => { setMenu(''); const next = window.prompt(`New subdeck under ${node.path}`, `${node.path}::`); if (next && next.trim() && next.trim() !== `${node.path}::`) { send('create', { name: next.trim() }); } }}>Add subdeck</button>
                <button type="button" role="menuitem" onClick={() => setPicking(true)}>Move to…</button>
                {node.folder && <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(''); send('delete', { id: node.folder.id }); }}>Delete</button>}
              </>}
              {picking && <div className="fp-pick">
                <span>Move “{node.label}” under:</span>
                {node.path.includes('::') && <button type="button" role="menuitem" onClick={() => { setMenu(''); moveTo(node.path, ''); }}>Top level</button>}
                {targets.filter(path => dnd.canDrop(node.path, path)).map(path => <button type="button" role="menuitem" key={path} onClick={() => { setMenu(''); moveTo(node.path, path); }}>{path.split('::').join(' › ')}</button>)}
                <button type="button" role="menuitem" onClick={() => setPicking(false)}>‹ Back</button>
              </div>}
            </div>
          )}
        </td>
      </tr>
      {hasChildren && !isCollapsed && [...node.children.values()].map(child => (
        <DeckRow key={child.path} node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} active={active} openNode={openNode} menu={menu} setMenu={setMenu} dnd={dnd} targets={targets} moveTo={moveTo} />
      ))}
    </>
  );
}

export default function FoldersPage({ onClose, onOpenSettings }) {
  const [folders, setFolders] = useState(readFolders);
  const [log, setLog] = useState(readActivity);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menu, setMenu] = useState('');
  const [, bump] = useState(0);
  const statsRef = useRef(null);

  useEffect(() => {
    const refresh = () => { setFolders(readFolders()); setLog(readActivity()); bump(n => n + 1); };
    window.addEventListener('beerus-folders-changed', refresh);
    window.addEventListener('beerus-activity', refresh);
    return () => { window.removeEventListener('beerus-folders-changed', refresh); window.removeEventListener('beerus-activity', refresh); };
  }, []);
  useEffect(() => {
    const esc = (event) => { if (event.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) { if (menu) setMenu(''); else onClose(); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, menu]);

  const stats = useMemo(() => activityStats(log), [log]);
  const tree = useMemo(() => buildTree(folders.list, folder => ({ cards: folder.id === folders.active ? activeCardCount() : (readSnapshot(folder.id)?.cards?.length || 0), today: folderToday(log, folder.id) })), [folders, log]);
  const foldersToday = folders.list.filter(folder => folderToday(log, folder.id) > 0).length;

  // Anki-style summary under the calendar
  const year = useMemo(() => { let n = 0; let days = 0; const d = new Date(); for (let i = 0; i < 365; i += 1) { const c = log[dayKey(d)]?.n || 0; n += c; if (c) days += 1; d.setDate(d.getDate() - 1); } return { n, days }; }, [log]);

  // ---- drag and drop: drop a deck on another to make it a subdeck, or on the strip below to make it top level ----
  const [drag, setDrag] = useState('');
  const [over, setOver] = useState('');
  const [note, setNote] = useState('');
  const hoverTimer = useRef(null);
  const noteTimer = useRef(null);
  const say = (text) => { setNote(text); window.clearTimeout(noteTimer.current); noteTimer.current = window.setTimeout(() => setNote(''), 3200); };
  const canDrop = (from, to) => {
    if (!from) return false;
    if (to === '') return from.includes('::'); // top level only makes sense for a subdeck
    if (isInside(to, from)) return false; // not into itself or its own children
    return to !== from.split('::').slice(0, -1).join('::'); // already there
  };
  const moveTo = (from, to) => {
    if (!canDrop(from, to)) return;
    const leaf = from.split('::').pop();
    const base = to ? `${to}::${leaf}` : leaf;
    const affected = folders.list.filter(folder => isInside(folder.name || '', from));
    const renames = affected.map(folder => ({ id: folder.id, name: `${base}${(folder.name || '').slice(from.length)}` }));
    const taken = new Set(folders.list.filter(folder => !affected.includes(folder)).map(folder => folder.name));
    if (renames.some(r => taken.has(r.name))) { say(`There is already a deck called “${base}”.`); return; }
    if (!affected.length) { say(`“${leaf}” is only a heading; move its subdecks one by one.`); return; }
    send('rename-many', { renames });
    if (to) setCollapsed(prev => { const next = new Set(prev); next.delete(to); return next; });
    say(`Moved “${leaf}” ${to ? `into ${to.split('::').join(' › ')}` : 'to the top level'}.`);
  };
  const dnd = {
    drag, over, canDrop,
    start: (path) => setDrag(path),
    end: () => { setDrag(''); setOver(''); window.clearTimeout(hoverTimer.current); },
    hover: (path, collapsedNode) => {
      if (over !== path) {
        setOver(path);
        window.clearTimeout(hoverTimer.current);
        if (collapsedNode) hoverTimer.current = window.setTimeout(() => setCollapsed(prev => { const next = new Set(prev); next.delete(path); return next; }), 650); // open a closed deck while you hover on it
      }
    },
    drop: (path) => { const from = drag; setDrag(''); setOver(''); window.clearTimeout(hoverTimer.current); moveTo(from, path); },
  };
  const targets = useMemo(() => allPaths(tree), [tree]);

  const toggle = (path) => setCollapsed(prev => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); try { localStorage.setItem(LIST_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ } return next; });
  const openNode = (id) => { send('switch', { id }); onClose(); };
  const createDeck = () => { const name = window.prompt('Name for the new deck (use :: for a subdeck, e.g. Pathology::Anemia)'); if (name && name.trim()) { send('create', { name: name.trim() }); onClose(); } };

  return (
    <div className="fp" role="dialog" aria-label="Decks" onClick={() => menu && setMenu('')}>
      <header className="fp-top">
        <nav className="fp-nav" aria-label="Main">
          <button type="button" className="on">Decks</button>
          <button type="button" onClick={onClose}>Add</button>
          <button type="button" onClick={() => { send('browse'); onClose(); }}>Browse</button>
          <button type="button" onClick={() => statsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Stats</button>
          <button type="button" onClick={() => onOpenSettings?.()}>Settings</button>
        </nav>
        <Clock />
      </header>

      <main className="fp-main">
        <table className="fp-table">
          <thead><tr><th className="fp-name">Deck</th><th>Cards</th><th className="new">New</th><th /></tr></thead>
          <tbody>
            {[...tree.children.values()].map(node => (
              <DeckRow key={node.path} node={node} depth={0} collapsed={collapsed} toggle={toggle} active={folders.active} openNode={openNode} menu={menu} setMenu={setMenu} dnd={dnd} targets={targets} moveTo={moveTo} />
            ))}
          </tbody>
        </table>
        {drag && drag.includes('::') && (
          <div className={`fp-root${over === '' && dnd.canDrop(drag, '') ? ' drop' : ''}`}
            onDragOver={event => { event.preventDefault(); dnd.hover('', false); }} onDrop={event => { event.preventDefault(); dnd.drop(''); }}>
            Drop here to make “{drag.split('::').pop()}” a top-level deck
          </div>
        )}
        {note && <p className="fp-toast" role="status">{note}</p>}

        <p className="fp-today">Added {stats.today} card{stats.today === 1 ? '' : 's'} today{stats.today ? ` in ${foldersToday} deck${foldersToday === 1 ? '' : 's'}` : ''}.</p>

        <section ref={statsRef} className="fp-stats" aria-label="Activity">
          <Heatmap log={log} />
          <div className="fp-sum">
            <span>Daily average: <b>{year.days ? Math.round(year.n / year.days) : 0} cards</b></span>
            <span>Days added: <b>{year.days}</b> <small>({Math.round((year.days / 365) * 100)}%)</small></span>
            <span>Longest streak: <b>{stats.longest} {stats.longest === 1 ? 'day' : 'days'}</b></span>
            <span>Current streak: <b>{stats.streak} {stats.streak === 1 ? 'day' : 'days'}</b></span>
          </div>
          <p className="fp-note">Counts cards added from the day this calendar was introduced; older cards were not dated.</p>
        </section>

        <div className="fp-bottom">
          <button type="button" onClick={createDeck}>Create Deck</button>
          <button type="button" onClick={() => { send('import'); onClose(); }}>Import File</button>
        </div>
      </main>
    </div>
  );
}
