// Parses and validates AI-generated card batches (see skills/anking-card-generator/SKILL.md).
// Accepts raw JSON, JSON inside ``` fences (a whole chat reply works), an array of cards, or
// { deck_name, cards: [...] }. Nothing is added to the deck until the user confirms.
import { sanitizePastedHtml } from './components/editorHelpers';
import { normalizePills } from './beerus';

const TYPE_ALIASES = { cloze: 'Cloze', basic: 'Basic', 'image occlusion': 'Image Occlusion', io: 'Image Occlusion', occlusion: 'Image Occlusion' };
const OCCLUSION_MODES = ['hide-all', 'hide-one', 'sequential', 'random'];
const MAX_CARDS = 1000;

// Keeps the cloze markup so sibling cards that hide different words of one sentence are not flagged.
const duplicateKey = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function jsonCandidates(text) {
  const fenced = [...text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(match => match[1].trim()).filter(Boolean);
  const pool = fenced.length ? fenced : [text.trim()];
  const parsed = [];
  const errors = [];
  pool.forEach((chunk, index) => {
    try { parsed.push(JSON.parse(chunk)); return; } catch { /* try the outermost braces below */ }
    // One card object per line (JSON Lines) is accepted too.
    const lineCards = chunk.split(/\r?\n/).map(line => line.trim().replace(/,$/, '')).filter(line => line.startsWith('{') && line.endsWith('}')).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    if (lineCards.length) { parsed.push({ cards: lineCards }); return; }
    const first = Math.min(...['{', '['].map(char => { const at = chunk.indexOf(char); return at < 0 ? Infinity : at; }));
    const last = Math.max(chunk.lastIndexOf('}'), chunk.lastIndexOf(']'));
    if (Number.isFinite(first) && last > first) {
      try { parsed.push(JSON.parse(chunk.slice(first, last + 1))); return; } catch (error) { errors.push(`Block ${index + 1}: ${error.message}`); return; }
    }
    errors.push(`Block ${index + 1}: no JSON found`);
  });
  return { parsed, errors };
}

function cleanTags(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const seen = new Set();
  const out = [];
  list.forEach(tag => {
    const clean = String(tag).trim().replace(/\s+/g, '_').replace(/"/g, '');
    if (clean && !seen.has(clean)) { seen.add(clean); out.push(clean); }
  });
  return out.slice(0, 50);
}

function checkCloze(question) {
  const warnings = [];
  const numbers = [...question.matchAll(/\{\{c(\d+)::/g)].map(match => Number(match[1]));
  if (!numbers.length) return { error: 'Cloze card has no {{c1::…}} deletion', warnings };
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  if (distinct[0] !== 1 || distinct.some((value, index) => value !== index + 1)) warnings.push(`cloze numbers are not 1…n without gaps (${distinct.join(', ')})`);
  if (/\{\{c\d+::(?:(?!\}\}).)*\{\{c\d+::/s.test(question)) warnings.push('nested clozes will not work in Anki');
  if ((question.match(/\{\{/g) || []).length !== (question.match(/\}\}/g) || []).length) return { error: 'unbalanced {{ }} in cloze', warnings };
  if (/\{\{c\d+::\s*(::[^}]*)?\}\}/.test(question)) return { error: 'empty cloze answer', warnings };
  return { warnings };
}

function normalizeMasks(rawMasks) {
  if (!Array.isArray(rawMasks) || !rawMasks.length) return { error: 'no masks' };
  const masks = [];
  for (let index = 0; index < rawMasks.length; index += 1) {
    const mask = rawMasks[index] || {};
    const shape = ['rect', 'ellipse', 'polygon'].includes(mask.shape) ? mask.shape : 'rect';
    const box = ['x', 'y', 'width', 'height'].map(key => Number(mask[key]));
    if (box.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return { error: `mask ${index + 1}: x, y, width, height must be numbers between 0 and 1` };
    const normalized = { id: String(mask.id || `mask-${index + 1}`), shape, x: box[0], y: box[1], width: box[2], height: box[3], label: String(mask.label || '') };
    if (mask.hint) normalized.hint = String(mask.hint).slice(0, 200);
    if (mask.group) normalized.group = String(mask.group);
    if (shape === 'polygon') {
      const points = (mask.points || []).map(point => ({ x: Number(point?.x), y: Number(point?.y) }));
      if (points.length < 3 || points.some(point => !(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1))) return { error: `mask ${index + 1}: polygon needs ≥ 3 points in 0…1` };
      normalized.points = points;
    }
    masks.push(normalized);
  }
  return { masks };
}

export function validateImportedCard(raw, index) {
  const label = `Card ${index + 1}`;
  const problems = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object') return { problems: [`${label}: not an object`], warnings };
  const type = TYPE_ALIASES[String(raw.type || '').trim().toLowerCase()];
  if (!type) return { problems: [`${label}: unknown type "${raw.type}" (use Cloze, Basic or Image Occlusion)`], warnings };
  const question = type === 'Image Occlusion' ? '' : sanitizePastedHtml(String(raw.question ?? ''));
  const answer = sanitizePastedHtml(String(raw.answer ?? ''));
  // Pills: "pills": [html, html, html, html] or { "1": html, ... } or pill_1 ... pill_4 keys.
  const pillSource = raw.pills ?? Object.fromEntries([1, 2, 3, 4].filter(n => raw[`pill_${n}`] != null).map(n => [n, raw[`pill_${n}`]]));
  const pills = normalizePills(pillSource).map(html => (html ? sanitizePastedHtml(html) : ''));
  const tags = cleanTags(raw.tags);

  if (type === 'Cloze') {
    if (!stripTags(question)) return { problems: [`${label}: empty question`], warnings };
    const check = checkCloze(question);
    if (check.error) return { problems: [`${label}: ${check.error}`], warnings };
    check.warnings.forEach(message => warnings.push(`${label}: ${message}`));
    if (raw.sequential && new Set([...question.matchAll(/\{\{c(\d+)::/g)].map(match => match[1])).size < 2 && (question.match(/\{\{c\d+::/g) || []).length < 2) warnings.push(`${label}: "one by one" with a single cloze behaves like a normal cloze`);
    return { card: { type, question, answer, tags, sequential: Boolean(raw.sequential), pills }, problems, warnings };
  }
  if (type === 'Basic') {
    if (!stripTags(question)) return { problems: [`${label}: empty question`], warnings };
    if (!stripTags(answer) && !/<img|<audio|<table/i.test(answer)) return { problems: [`${label}: Basic card needs an answer`], warnings };
    if (/\{\{c\d+::/.test(question)) warnings.push(`${label}: contains cloze markup but type is Basic`);
    return { card: { type, question, answer, tags, pills }, problems, warnings };
  }
  // Image occlusion
  const maskResult = normalizeMasks(raw.masks);
  const mode = OCCLUSION_MODES.includes(raw.occlusion_mode) ? raw.occlusion_mode : 'hide-all';
  if (!OCCLUSION_MODES.includes(raw.occlusion_mode) && raw.occlusion_mode) warnings.push(`${label}: unknown occlusion_mode "${raw.occlusion_mode}", using hide-all`);
  if (typeof raw.image_data !== 'string' || !raw.image_data.startsWith('data:image/')) {
    return { plan: { label, image_ref: raw.image_ref || '(no image)', mode, masks: raw.masks, answer, tags }, problems: [`${label}: Image Occlusion needs "image_data" (a data URL). Attach the picture in the app and draw the masks; the labels are kept as a plan.`], warnings };
  }
  if (maskResult.error) return { problems: [`${label}: ${maskResult.error}`], warnings };
  return { card: { type, question: '', answer, tags, pills, header: String(raw.header || '').slice(0, 500), imageData: raw.image_data, imageWidth: Math.min(1800, Math.max(180, Math.round(Number(raw.image_width) || 720))), masks: maskResult.masks, occlusionMode: mode }, problems, warnings };
}

/**
 * @param text       pasted/loaded text
 * @param existing   cards already in the deck (for duplicate warnings)
 */
export function parseCardImport(text, existing = []) {
  const { parsed, errors } = jsonCandidates(String(text || ''));
  let deckName = '';
  const rawCards = [];
  const plans = [];
  parsed.forEach(block => {
    const blocks = Array.isArray(block) ? [{ cards: block }] : [block];
    blocks.forEach(item => {
      if (!item || typeof item !== 'object') return;
      if (!deckName && typeof item.deck_name === 'string') deckName = item.deck_name.trim();
      if (Array.isArray(item.cards)) rawCards.push(...item.cards);
      if (Array.isArray(item.image_occlusion_plans)) plans.push(...item.image_occlusion_plans);
    });
  });

  const cards = [];
  const problems = [...errors];
  const warnings = [];
  const skippedPlans = [...plans.map((plan, index) => ({ label: `Plan ${index + 1}`, image_ref: plan.image_ref || '(no image)', mode: plan.occlusion_mode, masks: plan.masks, answer: plan.answer, tags: cleanTags(plan.tags) }))];
  rawCards.slice(0, MAX_CARDS).forEach((raw, index) => {
    const result = validateImportedCard(raw, index);
    result.problems.forEach(problem => problems.push(problem));
    result.warnings.forEach(warning => warnings.push(warning));
    if (result.card) cards.push(result.card);
    if (result.plan) skippedPlans.push(result.plan);
  });
  if (rawCards.length > MAX_CARDS) problems.push(`Only the first ${MAX_CARDS} cards are imported.`);

  const existingKeys = new Set(existing.filter(card => card.type !== 'Image Occlusion').map(card => duplicateKey(card.question)));
  const seen = new Set();
  let duplicates = 0;
  cards.forEach(card => {
    if (card.type === 'Image Occlusion') return;
    const key = duplicateKey(card.question);
    if (key && (existingKeys.has(key) || seen.has(key))) duplicates += 1;
    seen.add(key);
  });
  if (duplicates) warnings.push(`${duplicates} card${duplicates > 1 ? 's look' : ' looks'} like duplicates of cards already in your deck or in this batch.`);

  const counts = cards.reduce((totals, card) => ({ ...totals, [card.sequential ? 'Cloze (one by one)' : card.type]: (totals[card.sequential ? 'Cloze (one by one)' : card.type] || 0) + 1 }), {});
  return { deckName, cards, problems, warnings, plans: skippedPlans, counts, total: rawCards.length };
}
