import { useEffect, useRef, useState } from 'react';
import { cardCount } from '../folders';
import { Layers3, ChevronDown, PlusCircle, Trash2 } from './Icons';

/** Header button that lists the folders (decks) and lets you switch, create or delete them. */
export default function FolderMenu({ folders, activeCards, onSwitch, onCreate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const box = useRef(null);
  const active = folders.list.find(f => f.id === folders.active);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    const esc = (event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  const create = (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onCreate(clean);
    setName('');
    setOpen(false);
  };

  return (
    <div className="fm" ref={box}>
      <button type="button" className="icon-button fm-btn" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="menu" title="Folders: keep separate decks and switch between them">
        <Layers3 size={18} /><span>{active?.name || 'Folder'}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div className="fm-menu" role="menu" aria-label="Folders">
          <span className="fm-h">FOLDERS</span>
          <div className="fm-list">
            {folders.list.map(folder => (
              <div key={folder.id} className={`fm-row${folder.id === folders.active ? ' on' : ''}`}>
                <button type="button" role="menuitem" onClick={() => { onSwitch(folder.id); setOpen(false); }}>
                  <span>{folder.name || 'Untitled'}</span><b>{cardCount(folder.id, folders.active, activeCards)}</b>
                </button>
                {folders.list.length > 1 && <button type="button" className="fm-del" onClick={() => onDelete(folder.id)} aria-label={`Delete folder ${folder.name}`} title="Delete folder"><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
          <form className="fm-new" onSubmit={create}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="New folder name…" aria-label="New folder name" autoFocus />
            <button type="submit" aria-label="Create folder"><PlusCircle size={16} /></button>
          </form>
          <p className="fm-note">Each folder is its own deck with its own cards. Export exports the open folder. Use :: in a name for sub-decks in Anki (Anatomy::Head).</p>
        </div>
      )}
    </div>
  );
}
