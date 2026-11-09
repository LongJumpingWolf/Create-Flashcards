// ChatGPT formatting preset.
//
// Two kinds of clipboard content come out of ChatGPT:
//  * selecting text and copying gives HTML. Chrome keeps ChatGPT's tags/classes and data-d-* attributes and adds
//    huge inline computed styles (colours, sizes, the page background), which are page-theme specific;
//  * the "Copy" button gives Markdown text.
// Both are turned into clean semantic HTML wrapped in <div class="gpt">; the note type's CSS (beerus.js gptCss, measured
// from a saved ChatGPT page: 16px/26px text, 18px/28px 600 titles, 12px soft pill badges, 14px tables, 16px rounded
// panel) draws it, so it also adapts to Anki's night mode instead of freezing the colours of the page it came from.
import { markdownToHtml, looksLikeMarkdown } from './components/smartTyping';

export const GPT_CLASS = 'gpt';
const BADGE_COLORS = new Set(['info', 'warning', 'success', 'danger', 'neutral']);

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** True when clipboard HTML clearly comes from a ChatGPT answer. */
export function isChatGptHtml(html) {
  return /data-d-component=|data-message-author-role|data-turn-id|data-start="\d+"|class="[^"]*\b(?:markdown|prose|TextBase|Badge)[\w-]*/i.test(html || '');
}

const isDomainLike = (text) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text.trim());

export function chatgptHtmlToGpt(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const comp = (el) => el.getAttribute?.('data-d-component') || '';

  const inline = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent.replace(/\s+/g, ' '));
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const kind = comp(node);
    if (['script', 'style', 'svg', 'button'].includes(tag)) return '';
    if (kind === 'icon' || kind === 'pressable' || kind === 'loading-block') return '';
    const inner = () => [...node.childNodes].map(inline).join('');
    if (tag === 'br') return '<br>';
    if (tag === 'a') return isDomainLike(node.textContent) ? '' : inner();
    if (tag === 'img') return '';
    if (tag === 'code') return `<code>${esc(node.textContent)}</code>`;
    const bold = tag === 'b' || tag === 'strong' || node.hasAttribute('data-d-default-strong');
    const italic = tag === 'i' || tag === 'em' || node.style?.fontStyle === 'italic' || node.hasAttribute('data-d-default-em');
    const underline = tag === 'u' || /underline/.test(node.style?.textDecorationLine || node.style?.textDecoration || '');
    let out = inner();
    if (!out.trim() && !/<br>/.test(out)) return out;
    if (tag === 'sub' || tag === 'sup') out = `<${tag}>${out}</${tag}>`;
    if (bold) out = `<b>${out}</b>`;
    if (italic) out = `<i>${out}</i>`;
    if (underline) out = `<u>${out}</u>`;
    return out;
  };

  const hasBlockChild = (node) => [...node.children].some(child => /^(P|DIV|UL|OL|LI|H[1-6]|TABLE|PRE|BLOCKQUOTE|HR|SECTION|ARTICLE)$/.test(child.tagName));

  const listItem = (li) => {
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { const t = esc(node.textContent.replace(/\s+/g, ' ')); if (t.trim()) parts.push(t); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'UL' || tag === 'OL') { parts.push(block(node)); return; }
      if (tag === 'P' || comp(node) === 'text' && tag === 'P') { parts.push(inline(node)); return; }
      if (hasBlockChild(node)) { [...node.childNodes].forEach(visit); return; }
      parts.push(inline(node));
    };
    [...li.childNodes].forEach(visit);
    return `<li>${parts.join('<br>').replace(/<br>(<(?:ul|ol))/g, '$1').replace(/(<\/(?:ul|ol)>)<br>/g, '$1')}</li>`;
  };

  const table = (root) => {
    const rows = [...root.querySelectorAll('tr')].map(tr => {
      const cells = [...tr.children].filter(c => /^(TD|TH)$/.test(c.tagName)).map(cell => {
        const text = [...cell.childNodes].map(inline).join('').trim();
        return `<${cell.tagName.toLowerCase()}>${text}</${cell.tagName.toLowerCase()}>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return rows.length ? `<table><tbody>${rows.join('')}</tbody></table>` : '';
  };

  function block(node) {
    if (node.nodeType === Node.TEXT_NODE) { const t = node.textContent.replace(/\s+/g, ' ').trim(); return t ? `<p>${esc(t)}</p>` : ''; }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    const kind = comp(node);
    if (/^(SCRIPT|STYLE|SVG|BUTTON|NOSCRIPT)$/.test(tag)) return '';
    if (kind === 'icon' || kind === 'pressable' || kind === 'loading-block') return '';
    if (kind === 'badge') {
      const color = node.getAttribute('data-color');
      const label = [...node.childNodes].map(inline).join('').trim();
      return label ? `<div class="gpt-badgerow"><span class="gpt-badge gpt-badge-${BADGE_COLORS.has(color) ? color : 'info'}">${label}</span></div>` : '';
    }
    if (kind === 'table' || tag === 'TABLE') return table(node);
    if (kind === 'box' || kind === 'image') {
      const img = node.querySelector('img[src]');
      const src = img?.getAttribute('src') || '';
      return /^(https?:|data:image\/)/i.test(src) ? `<img src="${src.replace(/"/g, '&quot;')}">` : '';
    }
    if (/^H[1-6]$/.test(tag) || kind === 'title') {
      const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : (node.getAttribute('data-d-size') === 'lg' ? 2 : 3);
      const text = [...node.childNodes].map(inline).join('').trim();
      return text ? `<${level <= 2 ? 'h2' : 'h3'}>${text}</${level <= 2 ? 'h2' : 'h3'}>` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = [...node.children].filter(child => child.tagName === 'LI').map(listItem).join('');
      return items ? `<${tag.toLowerCase()}>${items}</${tag.toLowerCase()}>` : '';
    }
    if (tag === 'PRE') return `<pre><code>${esc(node.textContent.replace(/\n$/, ''))}</code></pre>`;
    if (tag === 'BLOCKQUOTE') { const body = [...node.childNodes].map(block).join('').replace(/<\/?p>/g, ' ').trim(); return `<blockquote>${body}</blockquote>`; }
    if (tag === 'HR') return '<hr>';
    if (tag === 'IMG') { const src = node.getAttribute('src') || ''; return /^(https?:|data:image\/)/i.test(src) ? `<img src="${src.replace(/"/g, '&quot;')}">` : ''; }
    if (tag === 'P' || (kind === 'text' && !hasBlockChild(node))) {
      const text = [...node.childNodes].map(inline).join('').trim();
      return text ? `<p>${text}</p>` : '';
    }
    if (hasBlockChild(node) || ['DIV', 'SECTION', 'ARTICLE', 'BODY', 'SPAN'].includes(tag) === false) return [...node.childNodes].map(block).join('');
    // a div/span that only holds inline content = one paragraph; mixed content is walked child by child
    if (!hasBlockChild(node)) {
      const text = [...node.childNodes].map(inline).join('').trim();
      return text ? `<p>${text}</p>` : '';
    }
    return [...node.childNodes].map(block).join('');
  }

  const body = [...doc.body.childNodes].map(block).join('');
  const cleaned = body.replace(/<p>\s*<\/p>/g, '').replace(/(<br>)+<\/(p|li)>/g, '</$2>');
  return cleaned ? `<div class="${GPT_CLASS}">${cleaned}</div>` : '';
}

/** Markdown (the ChatGPT "Copy" button) -> the same ChatGPT-look HTML. */
export function markdownToGpt(markdown) {
  const html = markdownToHtml(markdown);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // markdownToHtml wraps paragraphs in <div>; ChatGPT uses <p> and h2/h3 (# -> h2, ## and below -> h3).
  doc.body.querySelectorAll(':scope > div').forEach(div => { const p = doc.createElement('p'); p.innerHTML = div.innerHTML; div.replaceWith(p); });
  // ChatGPT answers use '#' and '##' for section titles (18px) and '###' and below for sub-titles (16px).
  doc.body.querySelectorAll('h3').forEach(h => { const h2 = doc.createElement('h2'); h2.innerHTML = h.innerHTML; h.replaceWith(h2); });
  doc.body.querySelectorAll('h4').forEach(h => { const h3 = doc.createElement('h3'); h3.innerHTML = h.innerHTML; h.replaceWith(h3); });
  doc.body.querySelectorAll('strong').forEach(s => { const b = doc.createElement('b'); b.innerHTML = s.innerHTML; s.replaceWith(b); });
  doc.body.querySelectorAll('li > div').forEach(div => { div.replaceWith(...div.childNodes); });
  return `<div class="${GPT_CLASS}">${doc.body.innerHTML}</div>`;
}

/**
 * Decides what a paste into a pill should become.
 * format: 'auto' (convert only clear ChatGPT HTML), 'chatgpt' (also convert Markdown text), 'plain' (never).
 * Returns an HTML string, or null to let the normal paste handling run.
 */
export function chatgptFromClipboard({ html, text }, format = 'auto') {
  if (format === 'plain') return null;
  if (html && isChatGptHtml(html)) {
    const out = chatgptHtmlToGpt(html);
    if (out) return out;
  }
  if (format === 'chatgpt' && text && looksLikeMarkdown(text)) return markdownToGpt(text);
  return null;
}
