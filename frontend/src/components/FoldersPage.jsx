import { useEffect, useMemo, useState } from 'react';
import { readFolders, readSnapshot } from '../folders';
import { activityStats, buildHeatmap, folderToday, readActivity } from '../activity';
import { BookOpen, ChevronLeft, PlusCircle, Trash2, Edit, Layers3 } from './Icons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const level = (n) => (n === null ? -1 : n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);
const send = (type, detail = {}) => window.dispatchEvent(new CustomEvent('beerus-folder-action', { detail: { type, ...detail } }));
const activeCardCount = () => { try { return (JSON.parse(localStorage.getItem('ankiDeckBuilderState') || '{}').cards || []).length; } catch { return 0; } };

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="fp-clock" aria-label="Current time">
      <strong>{time}</strong>
      <span>{DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</span>
    </div>
  );
}

function Heatmap({ log }) {
  const columns = useMemo(() => buildHeatmap(log), [log]);
  const total = columns.flat().reduce((sum, day) => sum + (day.count || 0), 0);
  const labels = columns.map((column, index) => {
    const first = column[0].date;
    return index === 0 || first.getMonth() !== columns[index - 1][0].date.getMonth() ? MONTHS[first.getMonth()] : '';
  });
  return (
    <div className="fp-heat">
      <div className="fp-heat-head"><b>{total}</b> card{total === 1 ? '' : 's'} added in the last year</div>
      <div className="fp-heat-scroll">
        <div className="fp-heat-grid" role="img" aria-label={`${total} cards added in the last year`}>
          <div className="fp-heat-months" style={{ gridTemplateColumns: `repeat(${columns.length}, 13px)` }}>{labels.map((label, i) => <span key={i}>{label}</span>)}</div>
          <div className="fp-heat-days"><span>Mon</span><span>Wed</span><span>Fri</span></div>
          <div className="fp-heat-cols" style={{ gridTemplateColumns: `repeat(${columns.length}, 13px)` }}>
            {columns.map((column, c) => (
              <div key={c} className="fp-col">
                {column.map(day => (
                  <i key={day.key} className={`fp-day l${level(day.count)}`} title={day.count === null ? '' : `${day.count} card${day.count === 1 ? '' : 's'} on ${day.date.getDate()} ${MONTHS[day.date.getMonth()]} ${day.date.getFullYear()}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="fp-legend">Less <i className="fp-day l0" /><i className="fp-day l1" /><i className="fp-day l2" /><i className="fp-day l3" /><i className="fp-day l4" /> More</div>
    </div>
  );
}

export default function FoldersPage({ onClose }) {
  const [folders, setFolders] = useState(readFolders);
  const [log, setLog] = useState(readActivity);
  const [name, setName] = useState('');
  const [, bump] = useState(0);

  useEffect(() => {
    const refresh = () => { setFolders(readFolders()); setLog(readActivity()); bump(n => n + 1); };
    window.addEventListener('beerus-folders-changed', refresh);
    window.addEventListener('beerus-activity', refresh);
    return () => { window.removeEventListener('beerus-folders-changed', refresh); window.removeEventListener('beerus-activity', refresh); };
  }, []);
  useEffect(() => {
    const esc = (event) => { if (event.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const stats = useMemo(() => activityStats(log), [log]);
  const count = (id) => (id === folders.active ? activeCardCount() : (readSnapshot(id)?.cards?.length || 0));
  const totalCards = folders.list.reduce((sum, folder) => sum + count(folder.id), 0);

  const create = (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    send('create', { name: clean });
    onClose();
    setName('');
  };

  return (
    <div className="fp" role="dialog" aria-label="Folders">
      <header className="fp-top">
        <button type="button" className="quiet-button" onClick={onClose}><ChevronLeft size={16} /><span>Back to editor</span></button>
        <div className="fp-title"><span className="section-eyebrow">YOUR WORKSPACE</span><h1>Folders</h1></div>
        <Clock />
      </header>

      <div className="fp-body">
        <section className="fp-left" aria-label="Folders">
          <div className="fp-grid">
            {folders.list.map(folder => {
              const cards = count(folder.id);
              const today = folderToday(log, folder.id);
              const open = folder.id === folders.active;
              return (
                <article key={folder.id} className={`fp-folder${open ? ' open' : ''}`}>
                  <div className="fp-folder-head"><Layers3 size={18} /><h2 title={folder.name}>{folder.name || 'Untitled'}</h2>{open && <em>open</em>}</div>
                  <div className="fp-folder-nums"><div><b>{cards}</b><span>cards</span></div><div><b>{today}</b><span>new today</span></div></div>
                  <div className="fp-folder-actions">
                    <button type="button" className="fp-go" onClick={() => { send('switch', { id: folder.id }); onClose(); }}><BookOpen size={15} /> {open ? 'Continue' : 'Open'}</button>
                    <button type="button" onClick={() => { const next = window.prompt('Folder name', folder.name); if (next && next.trim()) send('rename', { id: folder.id, name: next.trim() }); }} aria-label={`Rename ${folder.name}`} title="Rename"><Edit size={15} /></button>
                    {folders.list.length > 1 && <button type="button" className="danger" onClick={() => send('delete', { id: folder.id })} aria-label={`Delete ${folder.name}`} title="Delete"><Trash2 size={15} /></button>}
                  </div>
                </article>
              );
            })}
            <form className="fp-folder fp-new" onSubmit={create}>
              <div className="fp-folder-head"><PlusCircle size={18} /><h2>New folder</h2></div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pathology::Anemia" aria-label="New folder name" />
              <button type="submit" className="fp-go" disabled={!name.trim()}>Create and open</button>
              <p>Each folder is its own deck. Use :: for sub-decks in Anki.</p>
            </form>
          </div>
        </section>

        <aside className="fp-right" aria-label="Activity">
          <div className="fp-tiles">
            <div className="fp-tile hot"><span>New cards today</span><b>{stats.today}</b></div>
            <div className="fp-tile"><span>This week</span><b>{stats.week}</b></div>
            <div className="fp-tile"><span>Current streak</span><b>{stats.streak}<small>{stats.streak === 1 ? ' day' : ' days'}</small></b></div>
            <div className="fp-tile"><span>Longest streak</span><b>{stats.longest}<small>{stats.longest === 1 ? ' day' : ' days'}</small></b></div>
            <div className="fp-tile"><span>All cards</span><b>{totalCards}</b></div>
            <div className="fp-tile"><span>Best day</span><b>{stats.best ? stats.best.n : 0}<small>{stats.best ? ` on ${stats.best.key.slice(5).replace('-', '/')}` : ''}</small></b></div>
          </div>
          <Heatmap log={log} />
          <p className="fp-note">The calendar counts cards added from today onward (older cards were not dated). {stats.activeDays} active day{stats.activeDays === 1 ? '' : 's'} so far.</p>
        </aside>
      </div>
    </div>
  );
}
