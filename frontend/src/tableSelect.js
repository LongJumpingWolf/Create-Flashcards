// Word-style table cell selection for every editable field (Front, Back, pills): drag from one cell to another (or
// Shift+click) and the whole rectangle of cells is selected, instead of the browser's text-flow selection that
// paints a ragged stripe through every row. The highlight is drawn by overlay boxes, so nothing is written into the
// card's HTML. Toolbar formatting applies to every selected cell; Delete empties them; Ctrl+C copies them as a table.

let cells = [];
let overlays = [];
let anchor = null;
let tableEl = null;
let dragging = false;
let active = false;

const cellOf = (node) => (node && node.closest ? node.closest('td, th') : null);
const editableOf = (node) => (node && node.closest ? node.closest('[contenteditable="true"]') : null);
const IGNORE = '.editor-toolbar, [data-wc-menu], [data-toolbar-menu], .toolbar-menu, .cb-root';

function dropClass() {
  if (!tableEl) return;
  tableEl.classList.remove('cell-selecting');
  if (!tableEl.classList.length) tableEl.removeAttribute('class'); // leave the card's HTML exactly as it was
}

function draw() {
  overlays.forEach(box => box.remove());
  overlays = cells.filter(cell => cell.isConnected).map(cell => {
    const rect = cell.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'cell-sel-box';
    Object.assign(box.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.appendChild(box);
    return box;
  });
}

export function clearCellSelection() {
  cells = []; active = false;
  overlays.forEach(box => box.remove());
  overlays = [];
  dropClass();
}

/** The currently selected cells that live inside `root` (empty when none). */
export function getSelectedCells(root) {
  return cells.filter(cell => cell.isConnected && (!root || root.contains(cell)));
}

function select(a, b) {
  const table = a.closest('table');
  const rows = [...table.rows];
  const pos = (cell) => ({ r: rows.indexOf(cell.parentElement), c: cell.cellIndex });
  const p = pos(a); const q = pos(b);
  const r1 = Math.min(p.r, q.r); const r2 = Math.max(p.r, q.r);
  const c1 = Math.min(p.c, q.c); const c2 = Math.max(p.c, q.c);
  cells = [];
  rows.slice(r1, r2 + 1).forEach(row => [...row.cells].forEach(cell => { if (cell.cellIndex >= c1 && cell.cellIndex <= c2) cells.push(cell); }));
  draw();
}

const tableHtml = () => {
  const rows = new Map();
  cells.forEach(cell => { const row = cell.parentElement; if (!rows.has(row)) rows.set(row, []); rows.get(row).push(cell); });
  return { text: [...rows.values()].map(list => list.map(cell => cell.innerText.replace(/\s+/g, ' ').trim()).join('\t')).join('\n'), html: `<table>${[...rows.values()].map(list => `<tr>${list.map(cell => cell.outerHTML).join('')}</tr>`).join('')}</table>` };
};

export function installTableSelection() {
  const onDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest?.(IGNORE)) return; // toolbar clicks keep the selection
    const cell = cellOf(event.target);
    if (cell && editableOf(cell)) {
      if (event.shiftKey && anchor && anchor.closest('table') === cell.closest('table')) {
        event.preventDefault();
        window.getSelection().removeAllRanges();
        active = true; tableEl = cell.closest('table'); select(anchor, cell);
        return;
      }
      clearCellSelection();
      anchor = cell; tableEl = cell.closest('table'); dragging = true;
    } else { clearCellSelection(); dragging = false; anchor = null; }
  };
  const onMove = (event) => {
    if (!dragging || !anchor) return;
    const cell = cellOf(document.elementFromPoint(event.clientX, event.clientY));
    if (!cell || cell.closest('table') !== tableEl) return;
    if (!active && cell === anchor) return;
    if (!active) { active = true; tableEl.classList.add('cell-selecting'); window.getSelection().removeAllRanges(); }
    event.preventDefault();
    select(anchor, cell);
  };
  const onUp = () => {
    dragging = false;
    dropClass();
    if (active && cells.length === 1) clearCellSelection(); // a click inside one cell is just a click
  };
  const onKey = (event) => {
    if (!cells.length) return;
    const live = cells.filter(cell => cell.isConnected);
    if (!live.length) { clearCellSelection(); return; }
    const editor = editableOf(live[0]);
    if (event.key === 'Escape') { clearCellSelection(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      live.forEach(cell => { cell.innerHTML = '<br>'; });
      editor?.dispatchEvent(new Event('input', { bubbles: true }));
      draw();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) clearCellSelection();
  };
  const onCopy = (event) => {
    if (!cells.length) return;
    const { text, html } = tableHtml();
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
  };
  const reposition = () => { if (cells.length) draw(); };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('copy', onCopy, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  return () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('copy', onCopy, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    clearCellSelection();
  };
}
