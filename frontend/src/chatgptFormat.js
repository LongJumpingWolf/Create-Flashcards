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
import { isImageHref } from './imageHosts';

export const GPT_CLASS = 'gpt';
const BADGE_COLORS = new Set(['info', 'warning', 'success', 'danger', 'neutral']);

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Structured web content (several paragraphs / headings / lists / a table): worth cleaning up into the ChatGPT look. */
export function isRichHtml(html) {
  if (!html) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = doc.body.querySelectorAll('p, h1, h2, h3, h4, ul, ol, table, blockquote, pre');
  return blocks.length >= 3 || doc.body.querySelectorAll('h1, h2, h3, h4, table, ul, ol').length >= 1;
}

/** Converts whatever is on the clipboard, without any detection (used by the "Convert anyway" / "Paste as ChatGPT" buttons). */
export function chatgptForce({ html, text }) {
  if (html) { const out = chatgptHtmlToGpt(html); if (out) return out; }
  if (text) return looksLikeMarkdown(text) ? markdownToGpt(text) : `<div class="${GPT_CLASS}">${text.split(/\n{2,}/).map(part => `<p>${esc(part.trim()).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  return null;
}

/**
 * Content that an older version of the site pasted from ChatGPT is stored as a pile of wrapper <div>s (and headings that wrap
 * whole sections), without the ChatGPT panel and without pictures. Recognise that signature and rebuild it in the ChatGPT
 * look, so saved cards fix themselves. Anything else (including your own notes) is returned untouched.
 */
export function repairOldChatGptPaste(html) {
  const text = String(html ?? '');
  if (!text || /class="gpt"/.test(text)) return text;
  const looksOld = /<li><div><div><p>|<h[1-6]><div>|<div><div><p>|href="https:\/\/images\.openai\.com|<div><div><\/div><div>/.test(text);
  if (!looksOld) return text;
  try { return chatgptHtmlToGpt(text) || text; } catch { return text; }
}

/** True when clipboard HTML clearly comes from a ChatGPT answer. */
export function isChatGptHtml(html) {
  return /data-d-component=|data-message-author-role|data-turn-id|data-start="\d+"|class="[^"]*\b(?:markdown|prose|TextBase|Badge)[\w-]*/i.test(html || '');
}

// ChatGPT colours text with theme variables (danger = red, success = green ...); keep that meaning as a class the card CSS draws.
const colorClass = (node) => { const m = /--color-text-(danger|success|warning|info)/.exec(node.getAttribute?.('style') || ''); return m ? `gpt-c-${m[1]}` : ''; };
// Chrome writes the colour ChatGPT gave a run of text (e.g. a red conclusion) into the custom property --d-stream-ink; the normal
// text ink is near-black, so any clearly coloured ink is kept as a real text colour.
const inkColor = (node) => {
  const m = /--d-stream-ink:\s*rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(node.getAttribute?.('style') || '');
  if (!m) return '';
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return ''; // grey / black / white: default text
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};
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
    // Chrome writes the computed weight onto copied elements, so a weight >= 600 on a span/div/font outside a title means bold text.
    const weight = parseInt(node.style?.fontWeight || '0', 10);
    const boldByStyle = weight >= 600 && ['span', 'font', 'div', 'p'].includes(tag) && !node.closest('h1, h2, h3, h4, h5, h6, th, [data-d-component="title"]');
    const bold = tag === 'b' || tag === 'strong' || node.hasAttribute('data-d-default-strong') || boldByStyle;
    const italic = tag === 'i' || tag === 'em' || node.style?.fontStyle === 'italic' || node.hasAttribute('data-d-default-em');
    const underline = tag === 'u' || /underline/.test(node.style?.textDecorationLine || node.style?.textDecoration || '');
    let out = inner();
    if (!out.trim() && !/<br>/.test(out)) return out;
    const tone = colorClass(node);
    if (tone && !/^H[1-6]$/.test(node.tagName) && kind !== 'title') out = `<span class="${tone}">${out}</span>`;
    const ink = node.closest('a, code, pre, [data-d-component="badge"], [data-d-component="pressable"]') ? '' : inkColor(node); // links, code and badges keep their own look
    if (ink) out = `<span style="color:${ink}">${out}</span>`;
    if (tag === 'sub' || tag === 'sup') out = `<${tag}>${out}</${tag}>`;
    if (bold) out = `<b>${out}</b>`;
    if (italic) out = `<i>${out}</i>`;
    if (underline) out = `<u>${out}</u>`;
    return out;
  };

  // a block whose only content is a link (web-search source cards / citation chips) is not part of the answer
  const isSourceCard = (node) => node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'LI' && node.querySelector('a[href]') && !/^(UL|OL|TABLE|P)$/.test(node.tagName) && [...node.querySelectorAll('a[href]')].every(a => a.closest('p, li, td, th') === null) && node.textContent.trim() === [...node.querySelectorAll('a[href]')].map(a => a.textContent.trim()).join('').trim();

  // ChatGPT shows a picture as a card: a link to the image (title as text), the image and a source chip with the domain.
  // On the clipboard the <img> is often missing, but the link to the picture is there.
  const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const mediaBlock = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const links = [...node.querySelectorAll('a[href]')];
    const imageLinks = links.filter(a => isImageHref(a.getAttribute('href')));
    const imgs = [...node.querySelectorAll('img[src]')].filter(i => /^(https?:|data:image\/)/i.test(i.getAttribute('src')));
    if (!imageLinks.length && !imgs.length) return null;
    const squash = (text) => text.replace(/\s+/g, '');
    if (squash(node.textContent) !== squash(links.map(a => a.textContent).join(''))) return null; // real text around it: not a pure picture card
    const src = imgs[0]?.getAttribute('src') || imageLinks[0].getAttribute('href');
    const alt = imgs[0]?.getAttribute('alt') || imageLinks[0]?.textContent.trim() || '';
    const domain = links.map(a => a.textContent.trim()).find(isDomainLike) || '';
    return `<div class="gpt-img"><img src="${attr(src)}" alt="${attr(alt)}">${domain ? `<span class="gpt-src">${esc(domain)}</span>` : ''}</div>`;
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

  // ChatGPT's boxed diagrams (a bordered, centred column of lines with arrow icons between them, maybe a coloured title)
  const flowBox = (node) => {
    if (!node.textContent.trim()) return '';
    const bordered = node.hasAttribute('data-d-has-border') || /border:/.test(node.getAttribute('style') || '');
    if (!bordered) return [...node.children].map(block).join('');
    const arrow = node.getAttribute('data-d-direction') === 'row' ? '→' : '↓';
    const kids = [...node.children];
    let parts;
    if (kids.some(isIcon)) parts = kids.map(child => (isIcon(child) ? (isArrowIcon(child) ? `<p class="gpt-arrow">${arrow}</p>` : '') : block(child))).join('');
    else { // the arrows did not make it onto the clipboard: a bordered column of short lines is a flow, so put the arrows back
      const items = kids.map(block).filter(Boolean);
      parts = items.length >= 3 && kids.every(hasText) ? items.join(`<p class="gpt-arrow">${arrow}</p>`) : items.join('');
    }
    return parts ? `<div class="gpt-flow">${parts.replace(/<(\/?)h3/g, '<$1h2')}</div>` : '';
  };

  // A flow diagram whose box frame did not make it onto the clipboard (selecting only the lines inside the box): lines
  // separated by arrow icons. Chrome keeps the arrows as <svg data-d-component="icon">, so a text line, an icon and another text
  // line in a row is a flowchart.
  // Guard rails: only ChatGPT's own down-arrow glyph counts as a flow arrow (other icons such as ticks, warnings or copy buttons never do),
  // and a flow line is a short plain line, not a paragraph, list or table.
  const DOWN_ARROW = /M12\.707 18\.707|v9\.586|L11 15\.586/;
  const isIcon = (n) => n && n.nodeType === Node.ELEMENT_NODE && (n.tagName.toLowerCase() === 'svg' || comp(n) === 'icon') && !n.textContent.trim();
  const isArrowIcon = (n) => isIcon(n) && DOWN_ARROW.test([...n.querySelectorAll('path')].map(path => path.getAttribute('d') || '').join(' '));
  const hasText = (n) => n && n.nodeType === Node.ELEMENT_NODE && !isIcon(n) && n.textContent.trim() !== '' && n.textContent.trim().length <= 160 && !/^(UL|OL|TABLE|PRE|BLOCKQUOTE)$/.test(n.tagName) && !n.querySelector('ul, ol, table, pre, blockquote');
  // A line that is bold from start to end ("Chronic inflammation"), as ChatGPT writes the steps of a flow.
  const isBoldLine = (n) => {
    if (!n || n.nodeType !== Node.ELEMENT_NODE || n.tagName !== 'P') return false;
    const text = n.textContent.replace(/\s+/g, '');
    if (!text || n.textContent.trim().length > 80) return false;
    const bolds = [...n.querySelectorAll('b, strong, [data-d-default-strong]')].filter(el => !el.parentElement.closest('b, strong, [data-d-default-strong]') || !n.contains(el.parentElement.closest('b, strong, [data-d-default-strong]')));
    return bolds.map(el => el.textContent.replace(/\s+/g, '')).join('') === text;
  };
  const isColoredTitle = (n) => n && n.nodeType === Node.ELEMENT_NODE && (/^H[1-4]$/.test(n.tagName) || comp(n) === 'title') && n.textContent.trim().length <= 80 && Boolean(inkColor(n) || [...n.querySelectorAll('[style*="--d-stream-ink"]')].some(inkColor) || colorClass(n));
  function blocks(nodes) {
    const list = nodes.filter(n => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      // Guard rails: three or more bold-only short lines in a row, with no text between them, are a flow whose arrows and box
      // frame did not come along (the last step may be a coloured title).
      if (isBoldLine(list[i]) && isBoldLine(list[i + 1]) && isBoldLine(list[i + 2])) {
        let end = i + 2;
        while (isBoldLine(list[end + 1])) end += 1;
        if (isColoredTitle(list[end + 1])) end += 1;
        const items = list.slice(i, end + 1).map(block);
        out.push(`<div class="gpt-flow">${items.join('<p class="gpt-arrow">↓</p>').replace(/<(\/?)h3/g, '<$1h2')}</div>`);
        i = end;
        continue;
      }
      if (hasText(list[i]) && isArrowIcon(list[i + 1]) && hasText(list[i + 2])) {
        const items = [block(list[i])];
        while (isArrowIcon(list[i + 1]) && hasText(list[i + 2])) { items.push('<p class="gpt-arrow">↓</p>', block(list[i + 2])); i += 2; }
        out.push(`<div class="gpt-flow">${items.join('').replace(/<(\/?)h3/g, '<$1h2')}</div>`);
      } else out.push(block(list[i]));
    }
    return out.join('');
  }

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
    const media = mediaBlock(node);
    if (media) return media;
    if (isSourceCard(node)) return '';
    if (kind === 'image') return '';
    if (kind === 'box') return flowBox(node);
    if (node.classList?.contains('gpt-flow')) return node.outerHTML; // an already converted diagram box
    // a "heading" that wraps whole sections (it happens on the clipboard) is just a container
    if ((/^H[1-6]$/.test(tag) || kind === 'title') && (hasBlockChild(node) || node.textContent.trim().length > 220)) return blocks([...node.childNodes]);
    if (/^H[1-6]$/.test(tag) || kind === 'title') {
      // ChatGPT's rich answers mark their title size (lg = 18px, md = 16px); in classic markdown h1-h3 are the section titles.
      const sized = node.getAttribute('data-d-size');
      const level = sized ? (sized === 'lg' ? 2 : 3) : (/^H[1-6]$/.test(tag) ? (Number(tag[1]) <= 3 ? 2 : 3) : 3);
      const text = [...node.childNodes].map(inline).join('').trim();
      const tone = colorClass(node);
      return text ? `<${level <= 2 ? 'h2' : 'h3'}${tone ? ` class="${tone}"` : ''}>${text}</${level <= 2 ? 'h2' : 'h3'}>` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = [...node.children].filter(child => child.tagName === 'LI').map(listItem).join('');
      return items ? `<${tag.toLowerCase()}>${items}</${tag.toLowerCase()}>` : '';
    }
    if (tag === 'PRE') return `<pre><code>${esc(node.textContent.replace(/\n$/, ''))}</code></pre>`;
    if (tag === 'BLOCKQUOTE') { const body = blocks([...node.childNodes]).replace(/<\/?p>/g, ' ').trim(); return `<blockquote>${body}</blockquote>`; }
    if (tag === 'HR') return '<hr>';
    if (tag === 'IMG') { const src = node.getAttribute('src') || ''; return /^(https?:|data:image\/)/i.test(src) ? `<img src="${src.replace(/"/g, '&quot;')}">` : ''; }
    // a short, large, bold line that is not marked up as a heading (classic ChatGPT section titles) is a title
    if ((tag === 'DIV' || tag === 'P' || tag === 'SPAN') && !hasBlockChild(node) && parseInt(node.style?.fontWeight || '0', 10) >= 600 && parseFloat(node.style?.fontSize || '0') >= 17.5 && node.textContent.trim().length < 110 && !node.closest('li, td, th')) {
      const title = [...node.childNodes].map(inline).join('').replace(/<\/?b>/g, '').trim();
      if (title) return `<h2>${title}</h2>`;
    }
    if (tag === 'P' || (kind === 'text' && !hasBlockChild(node))) {
      const text = [...node.childNodes].map(inline).join('').trim();
      return text ? `<p>${text}</p>` : '';
    }
    if (hasBlockChild(node) || ['DIV', 'SECTION', 'ARTICLE', 'BODY', 'SPAN'].includes(tag) === false) return blocks([...node.childNodes]);
    // a div/span that only holds inline content = one paragraph; mixed content is walked child by child
    if (!hasBlockChild(node)) {
      const text = [...node.childNodes].map(inline).join('').trim();
      return text ? `<p>${text}</p>` : '';
    }
    return blocks([...node.childNodes]);
  }

  const body = blocks([...doc.body.childNodes]);
  let cleaned = body.replace(/<p>\s*<\/p>/g, '').replace(/(<br>)+<\/(p|li)>/g, '</$2>');
  if (!cleaned.trim()) {
    const plain = (doc.body.innerText || doc.body.textContent || '').split(/\n{1,}/).map(line => line.trim()).filter(Boolean);
    cleaned = plain.map(line => `<p>${esc(line)}</p>`).join('');
  }
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
  // 'auto' converts ChatGPT's markup and any other rich (headings / lists / tables) web paste; 'ChatGPT look (always)' converts every pasted HTML.
  if (html && (format === 'chatgpt' || isChatGptHtml(html) || isRichHtml(html))) {
    const out = chatgptHtmlToGpt(html);
    if (out) return out;
  }
  if (format === 'chatgpt' && text && looksLikeMarkdown(text)) return markdownToGpt(text);
  return null;
}
