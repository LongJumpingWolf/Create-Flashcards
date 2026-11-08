// "Smart typing" for the card editor: markdown-style shortcuts that turn into real
// formatting as you type, symbol replacements, smart markdown paste and output tidying.
// Everything goes through document.execCommand so the browser's undo stack keeps working,
// and Backspace right after a conversion reverts it (like Google Docs / Notion).
import { escapeHtml, sanitizePastedHtml } from './editorHelpers';

export const SMART_DEFAULTS = { markdown: true, typography: true, paste: true };

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'TH', 'TR', 'TABLE', 'PRE', 'HR']);

// True when `node` is the first thing on its line (start of a block or right after a <br>).
function atLineStart(node, editor) {
  let current = node;
  while (current && current !== editor) {
    const previous = current.previousSibling;
    if (previous) {
      if (previous.nodeName === 'BR') return true;
      if (previous.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(previous.nodeName)) return true;
      if (previous.nodeType === Node.TEXT_NODE && previous.textContent === '') { current = previous; continue; }
      return false;
    }
    const parent = current.parentNode;
    if (!parent || parent === editor || BLOCK_TAGS.has(parent.nodeName)) return true;
    current = parent;
  }
  return true;
}

const insideTag = (node, editor, names) => {
  for (let current = node; current && current !== editor; current = current.parentNode) {
    if (current.nodeType === Node.ELEMENT_NODE && names.includes(current.nodeName)) return current;
  }
  return null;
};

const selectBeforeCaret = (selection, node, offset, length) => {
  const range = document.createRange();
  range.setStart(node, offset - length);
  range.setEnd(node, offset);
  selection.removeAllRanges();
  selection.addRange(range);
};

const exec = (command, value = null) => document.execCommand(command, false, value);

// --- Block shortcuts: typed at the start of a line, then Space -------------------------
const LINE_RULES = [
  { test: /^[-*•] $/, apply: () => exec('insertUnorderedList'), undo: () => exec('insertUnorderedList'), skipIn: ['LI'] },
  { test: /^(\d{1,3})[.)] $/, skipIn: ['LI'], undo: () => exec('insertOrderedList'), apply: (match, editor) => {
    exec('insertOrderedList');
    const start = Number(match[1]);
    if (start > 1) {
      const selection = window.getSelection();
      const list = insideTag(selection.anchorNode, editor, ['OL']);
      if (list) list.setAttribute('start', String(start));
    }
  } },
  { test: /^> $/, apply: () => exec('formatBlock', 'blockquote'), undo: () => exec('formatBlock', 'div'), skipIn: ['BLOCKQUOTE'] },
  { test: /^(#{1,3}) $/, undo: () => exec('formatBlock', 'div'), apply: (match) => exec('formatBlock', match[1].length === 1 ? 'h2' : match[1].length === 2 ? 'h3' : 'h4') },
  { test: /^\[ ?\] $/, apply: () => exec('insertText', '☐ ') },
  { test: /^\[[xX]\] $/, apply: () => exec('insertText', '☑ ') },
];

// --- Inline shortcuts: typed closing delimiter completes the pair ----------------------
const code = (text) => `<code style="font-family:monospace;background-color:#eceff1;color:#1b1b1b;padding:0 4px;border-radius:3px">${text}</code>`;
const INLINE_RULES = [
  { key: '*', re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, prefix: false, wrap: (t) => `<b>${t}</b>` },
  { key: '~', re: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, prefix: false, wrap: (t) => `<s>${t}</s>` },
  { key: '=', re: /==([^=\s](?:[^=]*[^=\s])?)==$/, prefix: false, wrap: (t) => `<span style="background-color:#fff176">${t}</span>` },
  { key: '`', re: /`([^`]+)`$/, prefix: false, wrap: code },
  { key: '*', re: /(^|[\s(])\*([^*\s](?:[^*]*[^*\s])?)\*$/, prefix: true, wrap: (t) => `<i>${t}</i>` },
  { key: '_', re: /(^|[\s(])_([^_\s](?:[^_]*[^_\s])?)_$/, prefix: true, wrap: (t) => `<i>${t}</i>` },
  { key: '~', re: /(^|[^~])~([^~\s]{1,14})~$/, prefix: true, wrap: (t) => `<sub>${t}</sub>` },
  { key: '^', re: /(^|[^^])\^([^^\s]{1,14})\^$/, prefix: true, wrap: (t) => `<sup>${t}</sup>` },
];

// --- Symbols --------------------------------------------------------------------------
const TYPOGRAPHY = [
  ['←>', '↔'], ['≤>', '⇔'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['!=', '≠'],
  ['>=', '≥'], ['<=', '≤'], ['+-', '±'], ['...', '…'],
];

/**
 * Called from the editor's input event. Returns true when it rewrote the text.
 */
export function smartTyping(event, editor, prefs) {
  if (!editor || event.inputType !== 'insertText' || !event.data || event.data.length !== 1) return false;
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return false;
  if (insideTag(node, editor, ['PRE', 'CODE'])) return false;
  const offset = selection.anchorOffset;
  const before = node.textContent.slice(0, offset);
  const typed = event.data;

  if (prefs.markdown && typed === ' ' && atLineStart(node, editor)) {
    for (const rule of LINE_RULES) {
      const match = before.match(rule.test);
      if (!match || (rule.skipIn && insideTag(node, editor, rule.skipIn))) continue;
      selectBeforeCaret(selection, node, offset, before.length);
      exec('delete');
      rule.apply(match, editor);
      // Backspace right after the conversion restores the typed marker.
      return { revert: rule.undo ? () => { rule.undo(); exec('insertText', before); } : null };
    }
  }

  if (prefs.markdown) {
    for (const rule of INLINE_RULES) {
      if (rule.key !== typed) continue;
      const match = before.match(rule.re);
      if (!match) continue;
      const content = match[match.length - 1];
      const prefixLength = rule.prefix ? match[1].length : 0;
      const length = match[0].length - prefixLength;
      selectBeforeCaret(selection, node, offset, length);
      // The zero-width space keeps the caret outside the new element; it is stripped on save.
      exec('insertHTML', rule.wrap(escapeHtml(content)) + '\u200B');
      return { revert: null };
    }
  }

  if (prefs.typography) {
    for (const [pattern, symbol] of TYPOGRAPHY) {
      if (!before.endsWith(pattern) || pattern[pattern.length - 1] !== typed) continue;
      selectBeforeCaret(selection, node, offset, pattern.length);
      exec('insertText', symbol);
      return { revert: null };
    }
  }
  return false;
}

/** Enter on a line that is just --- (or ***) becomes a horizontal rule. */
export function smartEnter(editor) {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node) || !atLineStart(node, editor)) return false;
  const text = node.textContent.slice(0, selection.anchorOffset);
  if (!/^(-{3,}|\*{3,}|_{3,})$/.test(text) || selection.anchorOffset !== node.textContent.length) return false;
  selectBeforeCaret(selection, node, selection.anchorOffset, text.length);
  exec('delete');
  exec('insertHTML', '<hr><div><br></div>');
  return true;
}

/** Tab / Shift+Tab inside a list item nests or un-nests it. */
export function listTab(editor, outdent) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !insideTag(selection.anchorNode, editor, ['LI'])) return false;
  exec(outdent ? 'outdent' : 'indent');
  return true;
}

// --- Markdown paste ---------------------------------------------------------------------
export function looksLikeMarkdown(text) {
  if (!text || text.length < 3) return false;
  return /(^|\n)[ \t]{0,3}(#{1,6} |[-*+] |\d{1,3}[.)] |> |```)/.test(text)
    || /(^|\n)\|.+\|[ \t]*\n\|?[ \t]*:?-{2,}/.test(text)
    || /\*\*[^*\n]+\*\*/.test(text)
    || /(^|\n)[ \t]*([-*_])\2{2,}[ \t]*(\n|$)/.test(text)
    || /\[[^\]\n]+\]\(https?:[^)\s]+\)/.test(text);
}

const inlineMarkdown = (raw) => {
  const codes = [];
  let text = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, content) => { codes.push(content); return `\u0000${codes.length - 1}\u0000`; });
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/==([^=]+)==/g, '<span style="background-color:#fff176">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index) => code(codes[Number(index)]));
};

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => { if (paragraph.length) { out.push(`<div>${paragraph.join('<br>')}</div>`); paragraph = []; } };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      flush();
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) { body.push(lines[index]); index += 1; }
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { flush(); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flush(); const tag = heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4'; out.push(`<${tag}>${inlineMarkdown(heading[2])}</${tag}>`); continue; }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[index + 1])) {
      flush();
      const head = splitRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitRow(lines[index])); index += 1; }
      index -= 1;
      out.push(`<table><tbody><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr>${rows.map(row => `<tr>${head.map((_h, column) => `<td>${inlineMarkdown(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) { quote.push(inlineMarkdown(lines[index].replace(/^>\s?/, ''))); index += 1; }
      index -= 1;
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d{1,3}[.)])\s+/.test(line)) {
      flush();
      let html = '';
      const stack = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/);
        if (!item) break;
        const indent = item[1].replace(/\t/g, '    ').length;
        const tag = /\d/.test(item[2]) ? 'ol' : 'ul';
        const body = inlineMarkdown(item[3].replace(/^\[ \]\s*/, '☐ ').replace(/^\[[xX]\]\s*/, '☑ '));
        while (stack.length && indent < stack[stack.length - 1].indent) { html += `</li></${stack.pop().tag}>`; }
        const top = stack[stack.length - 1];
        if (!top || indent > top.indent) { html += `<${tag}><li>${body}`; stack.push({ indent, tag }); }
        else if (top.tag !== tag) { html += `</li></${stack.pop().tag}><${tag}><li>${body}`; stack.push({ indent: top.indent, tag }); }
        else html += `</li><li>${body}`;
        index += 1;
      }
      index -= 1;
      while (stack.length) html += `</li></${stack.pop().tag}>`;
      out.push(html);
      continue;
    }

    paragraph.push(inlineMarkdown(line.trim()));
  }
  flush();
  return sanitizePastedHtml(out.join(''));
}

// HTML that is only a plain-text wrapper (e.g. from an editor) carries no formatting of its own.
export const isPlainHtml = (html) => !html || !/<(b|strong|i|em|u|ul|ol|li|table|h[1-6]|a|img|blockquote)\b/i.test(html);

// --- Output tidying ----------------------------------------------------------------------
export function tidyHtml(html) {
  let out = html.replace(/\u200B/g, '');
  const emptyLine = '(?:<br\\s*\\/?>|<div>\\s*(?:<br\\s*\\/?>)?\\s*<\\/div>|<p>\\s*(?:<br\\s*\\/?>)?\\s*<\\/p>|&nbsp;|\\s)';
  out = out.replace(new RegExp(`^${emptyLine}+`, 'i'), '').replace(new RegExp(`${emptyLine}+$`, 'i'), '');
  // Chrome sprinkles &nbsp; between words; a normal space lets lines wrap properly.
  out = out.replace(/([^\s>;])&nbsp;(?=[^\s<])/g, '$1 ');
  for (let pass = 0; pass < 3; pass += 1) out = out.replace(/<(span|b|i|u|s|font|strong|em)(\s[^>]*)?>\s*<\/\1>/gi, '');
  out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  return out.trim();
}
