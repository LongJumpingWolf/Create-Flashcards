// Folders = separate decks you can switch between on the site. The folder you are working in lives in the normal editor
// state; every other folder is kept as a snapshot under its own key, so nothing about the editor's own storage changes.
const INDEX_KEY = 'beerus-folders-v1';
const snapKey = (id) => `beerus-folder-${id}`;

export function readFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if (raw && Array.isArray(raw.list) && raw.list.length) {
      const active = raw.list.some(f => f.id === raw.active) ? raw.active : raw.list[0].id;
      return { active, list: raw.list };
    }
  } catch { /* fall through to default */ }
  return { active: 'main', list: [{ id: 'main', name: 'Default Deck' }] };
}

export function writeFolders(index) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* storage full */ }
}

export function readSnapshot(id) {
  try { return JSON.parse(localStorage.getItem(snapKey(id)) || 'null'); } catch { return null; }
}

export function writeSnapshot(id, snapshot) {
  try { localStorage.setItem(snapKey(id), JSON.stringify(snapshot)); return true; } catch { return false; }
}

export function removeSnapshot(id) {
  try { localStorage.removeItem(snapKey(id)); } catch { /* storage unavailable */ }
}

export const newFolderId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function cardCount(id, activeId, activeCards) {
  if (id === activeId) return activeCards;
  return readSnapshot(id)?.cards?.length || 0;
}
