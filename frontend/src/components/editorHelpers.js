// Non-visual helpers for the Anki-style editor tools: math wrappers, audio capture,
// paste sanitising and duplicate detection.
import { useCallback, useEffect, useRef, useState } from 'react';

export const HIGHLIGHT_COLORS = ['#fff176', '#ffcc80', '#f8bbd0', '#b2ebf2', '#c5e1a5', '#d1c4e9'];

// --- Math / LaTeX ------------------------------------------------------------------
export const MATH_WRAPPERS = {
  'mathjax-inline': ['\\(', '\\)', 'Inline MathJax', 'Ctrl+M, M'],
  'mathjax-block': ['\\[', '\\]', 'Display MathJax', 'Ctrl+M, E'],
  'latex': ['[latex]', '[/latex]', 'LaTeX', ''],
  'latex-math': ['[$]', '[/$]', 'LaTeX math', ''],
  'latex-equation': ['[$$]', '[/$$]', 'LaTeX equation', ''],
};

// Wraps the current selection (or leaves the caret between the delimiters) using
// insertText so the browser's undo stack keeps working.
export function wrapSelection(editor, before, after) {
  if (!editor) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return false;
  const selected = selection.toString();
  document.execCommand('insertText', false, `${before}${selected}${after}`);
  if (!selected) {
    for (let step = 0; step < after.length; step += 1) selection.modify?.('move', 'backward', 'character');
  }
  return true;
}

// --- Audio -------------------------------------------------------------------------
const AUDIO_EXTENSIONS = { mpeg: 'mp3', mp3: 'mp3', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'aac', wav: 'wav', 'x-wav': 'wav', webm: 'webm', ogg: 'ogg', opus: 'opus', flac: 'flac' };

export const audioExtension = (mime) => AUDIO_EXTENSIONS[(mime.split('/')[1] || '').split(';')[0].toLowerCase()] || 'mp3';

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export const audioHtml = (dataUrl) => `<audio controls preload="none" src="${dataUrl}"></audio>&nbsp;`;

// Safari records AAC (audio/mp4), Chrome/Firefox record Opus. Prefer mp4 where
// available because Anki on iOS can't play WebM.
export const pickRecorderMime = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type)) || '';
};

export const MAX_RECORDING_SECONDS = 90;
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

export function useAudioRecorder(onFinished, onError) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const callbacksRef = useRef({ onFinished, onError });
  callbacksRef.current = { onFinished, onError };

  const cleanup = useCallback(() => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const mime = pickRecorderMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) { callbacksRef.current.onError?.('Audio recording is not supported in this browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const type = recorder.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        if (!blob.size) return;
        if (blob.size > MAX_AUDIO_BYTES) { callbacksRef.current.onError?.('That recording is too large. Keep clips under about a minute.'); return; }
        try { callbacksRef.current.onFinished?.(await fileToDataUrl(blob)); } catch { callbacksRef.current.onError?.('Could not read the recording.'); }
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setRecording(true);
      const began = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - began) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) stop();
      }, 250);
    } catch (error) {
      cleanup();
      callbacksRef.current.onError?.(error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start recording.');
    }
  }, [cleanup, stop]);

  useEffect(() => () => { if (recorderRef.current?.state === 'recording') { recorderRef.current.onstop = null; recorderRef.current.stop(); } cleanup(); }, [cleanup]);

  return { recording, seconds, start, stop };
}

// --- Paste handling ----------------------------------------------------------------
const PASTE_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'SPAN', 'FONT', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'MARK', 'AUDIO']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'CANVAS']);
const KEEP_STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'vertical-align'];

// Keeps meaningful formatting from a web page / Word / PDF paste but drops the junk
// (classes, ids, scripts, fonts, sizes, event handlers) that makes cards ugly or unsafe.
export function sanitizePastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName;
      if (DROP_WITH_CONTENT.has(tag.toUpperCase())) { child.remove(); return; }
      walk(child);
      if (!PASTE_TAGS.has(tag)) { child.replaceWith(...child.childNodes); return; }
      const keep = {};
      if (tag === 'A') { const href = child.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(href)) keep.href = href; }
      if (tag === 'IMG') { const src = child.getAttribute('src') || ''; if (/^(https?:|data:image\/)/i.test(src)) keep.src = src; keep.alt = child.getAttribute('alt') || ''; }
      if (tag === 'AUDIO') { const src = child.getAttribute('src') || ''; if (/^data:audio\//i.test(src)) { keep.src = src; keep.controls = ''; } else { child.remove(); return; } }
      const style = child.style;
      const styles = KEEP_STYLES.map(prop => [prop, style.getPropertyValue(prop)]).filter(([prop, value]) => value && !(prop === 'font-weight' && (value === '400' || value === 'normal')) && !(prop === 'font-style' && value === 'normal') && !(prop === 'background-color' && /transparent|rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)|white/i.test(value)));
      [...child.attributes].forEach(attribute => child.removeAttribute(attribute.name));
      Object.entries(keep).forEach(([name, value]) => child.setAttribute(name, value));
      if (styles.length && tag !== 'IMG') child.setAttribute('style', styles.map(([prop, value]) => `${prop}:${value}`).join(';'));
      if (tag === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      // Unstyled wrapper spans carry no information.
      if ((tag === 'SPAN' || tag === 'FONT') && !child.getAttribute('style')) child.replaceWith(...child.childNodes);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/(&nbsp;|\s){3,}/g, ' ').trim();
}

export const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const plainTextToHtml = (text) => escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');

// --- Duplicate detection (Anki warns when the first field already exists) ------------
export function duplicateKey(html) {
  if (!html) return '';
  return html
    .replace(/<audio\b[^>]*>(<\/audio>)?/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' [img] ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/gis, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function findDuplicates(frontHtml, cards, ignoreIndex = null) {
  const key = duplicateKey(frontHtml);
  if (key.length < 2 || key === '[img]') return [];
  const matches = [];
  cards.forEach((card, index) => {
    if (index === ignoreIndex || card.type === 'Image Occlusion') return;
    if (duplicateKey(card.question) === key) matches.push(index);
  });
  return matches;
}
