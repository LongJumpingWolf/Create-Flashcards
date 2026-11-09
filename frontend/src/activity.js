// A small log of how many cards were added each day (and in which folder). It feeds the heatmap on the Folders screen.
// It only counts from the day it was introduced: older cards carry no date, so they cannot be placed on the calendar.
import { readFolders } from './folders';

const KEY = 'beerus-activity-v1';
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function readActivity() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function logAdded(count = 1) {
  if (!count) return;
  const log = readActivity();
  const day = dayKey();
  const entry = log[day] || { n: 0, f: {} };
  const folder = readFolders().active;
  entry.n += count;
  entry.f[folder] = (entry.f[folder] || 0) + count;
  log[day] = entry;
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* storage full */ }
  window.dispatchEvent(new Event('beerus-activity'));
}

/** Weeks (columns, Monday first like Anki) covering `weeks` weeks up to `endDate`; each day carries its count (null = future). */
export function buildHeatmap(log, weeks = 53, endDate = new Date()) {
  const today = new Date();
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7); // the Monday that starts the first column
  const columns = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w += 1) {
    const column = [];
    for (let d = 0; d < 7; d += 1) {
      const key = dayKey(cursor);
      const future = cursor > today;
      column.push({ key, date: new Date(cursor), count: future ? null : (log[key]?.n || 0) });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(column);
  }
  return columns;
}

export function activityStats(log, today = new Date()) {
  const keys = Object.keys(log).filter(key => log[key]?.n > 0).sort();
  const total = keys.reduce((sum, key) => sum + log[key].n, 0);
  const todayCount = log[dayKey(today)]?.n || 0;
  let week = 0;
  for (let i = 0; i < 7; i += 1) { const d = new Date(today); d.setDate(d.getDate() - i); week += log[dayKey(d)]?.n || 0; }
  // current streak: consecutive days ending today (or yesterday if nothing yet today)
  let streak = 0;
  const probe = new Date(today);
  if (!(log[dayKey(probe)]?.n > 0)) probe.setDate(probe.getDate() - 1);
  while (log[dayKey(probe)]?.n > 0) { streak += 1; probe.setDate(probe.getDate() - 1); }
  // longest streak
  let longest = 0; let run = 0; let prev = null;
  keys.forEach(key => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    run = prev && Math.round((date - prev) / 86400000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  });
  const best = keys.reduce((top, key) => (log[key].n > (top?.n || 0) ? { key, n: log[key].n } : top), null);
  return { total, today: todayCount, week, streak, longest, activeDays: keys.length, best };
}

export function folderToday(log, folderId, today = new Date()) {
  return log[dayKey(today)]?.f?.[folderId] || 0;
}
