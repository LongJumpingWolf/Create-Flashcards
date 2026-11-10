// Undo / redo for the card fields (Front, Back, pill boxes) that follows what you actually did.
// The browser's own undo only knows about typing-style edits; clozes, table actions, colours added by code and
// inserted pictures were skipped, so Ctrl+Z reverted an older step instead. Here every change to a field is
// recorded as a snapshot, Ctrl+Z / Ctrl+Y walk through them, and a short toast says which action was undone.

const FIELD = '.editable-content, .pill-field-box';
const MAX_STEPS = 120;
const MAX_CHARS = 24_000_000; // memory guard when fields hold large pictures

const INPUT_LABELS = {
  insertText: 'Typing', insertCompositionText: 'Typing', insertReplacementText: 'Typing',
  insertLineBreak: 'Line break', insertParagraph: 'Line break',
  deleteContentBackward: 'Delete', deleteContentForward: 'Delete', deleteWordBackward: 'Delete', deleteWordForward: 'Delete',
  deleteByCut: 'Cut', insertFromPaste: 'Paste', insertFromPasteAsQuotation: 'Paste', insertFromDrop: 'Drop',
  formatBold: 'Bold', formatItalic: 'Italic', formatUnderline: 'Underline', formatStrikeThrough: 'Strikethrough',
  formatSuperscript: 'Superscript', formatSubscript: 'Subscript',
  insertOrderedList: 'Numbered list', insertUnorderedList: 'Bulleted list',
  formatJustifyLeft: 'Align left', formatJustifyCenter: 'Center', formatJustifyRight: 'Align right', formatJustifyFull: 'Justify',
  formatIndent: 'Indent', formatOutdent: 'Outdent', formatFontColor: 'Text colour', formatBackColor: 'Highlight', formatRemove: 'Clear formatting',
};

const states = new WeakMap();
let nextLabel = null;
let nextLabelAt = 0;
let inputLabel = null;
let applying = false;
let toastNode = null;
let toastTimer = 0;

/** Names the action that is about to change a field, so the undo toast can say what was undone. */
export function setActionLabel(label) { nextLabel = label; nextLabelAt = Date.now(); }

const takeLabel = () => {
  const explicit = nextLabel && Date.now() - nextLabelAt < 600 ? nextLabel : null;
  const label = explicit || inputLabel || 'Edit';
  nextLabel = null; inputLabel = null;
  return label;
};

const fieldOf = (node) => {
  const el = node && node.closest ? node.closest(FIELD) : null;
  return el && el.isContentEditable ? el : null;
};

const offsetIn = (el, node, offset) => {
  try { const range = document.createRange(); range.selectNodeContents(el); range.setEnd(node, offset); return range.toString().length; } catch { return null; }
};
const captureSelection = (el) => {
  const selection = window.getSelection();
  if (!selection.rangeCount || !el.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const start = offsetIn(el, range.startContainer, range.startOffset);
  const end = offsetIn(el, range.endContainer, range.endOffset);
  return start === null || end === null ? null : [start, end];
};
const pointAt = (el, target) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = target; let last = null; let node;
  while ((node = walker.nextNode())) {
    last = node;
    if (remaining <= node.data.length) return [node, remaining];
    remaining -= node.data.length;
  }
  return last ? [last, last.data.length] : [el, el.childNodes.length];
};
const restoreSelection = (el, saved) => {
  el.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  if (saved) {
    const [startNode, startOffset] = pointAt(el, saved[0]);
    const [endNode, endOffset] = pointAt(el, saved[1]);
    range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
  } else { range.selectNodeContents(el); range.collapse(false); }
  selection.removeAllRanges(); selection.addRange(range);
};

function toast(message) {
  if (!toastNode) {
    toastNode = document.createElement('div');
    toastNode.className = 'undo-toast';
    toastNode.setAttribute('role', 'status');
    document.body.appendChild(toastNode);
  }
  toastNode.textContent = message;
  toastNode.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastNode?.classList.remove('show'), 1700);
}

function stateOf(el) {
  let state = states.get(el);
  if (!state) {
    state = { stack: [{ html: el.innerHTML, sel: captureSelection(el), label: 'Start', t: 0 }], idx: 0, chars: el.innerHTML.length };
    states.set(el, state);
    const observer = new MutationObserver(() => record(el));
    observer.observe(el, { childList: true, characterData: true, attributes: true, subtree: true });
    state.observer = observer;
  }
  return state;
}

function record(el) {
  const state = states.get(el);
  if (!state) return;
  if (applying) { state.observer.takeRecords(); return; }
  if (document.activeElement !== el) return; // changes made while the field is not being edited (a card loading) are not steps
  const html = el.innerHTML;
  const top = state.stack[state.idx];
  if (html === top.html) return;
  const label = takeLabel();
  state.stack.length = state.idx + 1; // a new edit ends the redo path
  const now = Date.now();
  const mergeable = (label === 'Typing' || label === 'Delete') && top.label === label && now - top.t < 1000 && state.idx > 0;
  if (mergeable) {
    state.chars += html.length - top.html.length;
    state.stack[state.idx] = { html, sel: captureSelection(el), label, t: now };
  } else {
    state.stack.push({ html, sel: captureSelection(el), label, t: now });
    state.idx += 1;
    state.chars += html.length;
  }
  while (state.stack.length > MAX_STEPS || (state.chars > MAX_CHARS && state.stack.length > 2)) {
    state.chars -= state.stack[0].html.length;
    state.stack.shift(); state.idx -= 1;
  }
}

function apply(el, snapshot) {
  applying = true;
  el.innerHTML = snapshot.html;
  restoreSelection(el, snapshot.sel);
  el.dispatchEvent(new Event('input', { bubbles: true })); // lets the editor save the new content
  states.get(el)?.observer.takeRecords();
  applying = false;
}

export function undoField(el) {
  const state = stateOf(el);
  if (state.idx <= 0) { toast('Nothing to undo'); return; }
  const undone = state.stack[state.idx].label;
  state.idx -= 1;
  apply(el, state.stack[state.idx]);
  toast(`Undid: ${undone}`);
}

export function redoField(el) {
  const state = stateOf(el);
  if (state.idx >= state.stack.length - 1) { toast('Nothing to redo'); return; }
  state.idx += 1;
  apply(el, state.stack[state.idx]);
  toast(`Redid: ${state.stack[state.idx].label}`);
}

export function installFieldHistory() {
  const onFocus = (event) => {
    const el = fieldOf(event.target);
    if (!el) return;
    const state = states.get(el);
    if (!state) { stateOf(el); return; }
    // The field was changed from outside while it was not focused (a card was loaded or cleared): start a fresh history.
    if (state.stack[state.idx].html !== el.innerHTML) {
      state.stack = [{ html: el.innerHTML, sel: captureSelection(el), label: 'Start', t: 0 }]; state.idx = 0; state.chars = el.innerHTML.length;
      state.observer.takeRecords();
    }
  };
  const onBeforeInput = (event) => {
    if (!fieldOf(event.target)) return;
    inputLabel = INPUT_LABELS[event.inputType] || inputLabel;
  };
  const onKey = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const wantsUndo = key === 'z' && !event.shiftKey;
    const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
    if (!wantsUndo && !wantsRedo) return;
    const el = fieldOf(event.target);
    if (!el) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (wantsUndo) undoField(el); else redoField(el);
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('beforeinput', onBeforeInput, true);
    window.removeEventListener('keydown', onKey, true);
    toastNode?.remove(); toastNode = null;
  };
}
