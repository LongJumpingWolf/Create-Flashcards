// Share your Settings with someone else: a short code / link that carries the settings (without embedded pictures).
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { DEFAULT_SETTINGS, normalizeSettings } from './beerus';

const PREFIX = 'BRS1.';
const toB64Url = (bytes) => { let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64Url = (text) => { const b64 = text.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
const isData = (value) => typeof value === 'string' && value.startsWith('data:');

/** The settings as shared: pictures embedded in pills / the watermark cannot travel in a link, so those fall back to defaults. */
export function settingsForSharing(settings) {
  const copy = JSON.parse(JSON.stringify(settings));
  let droppedImages = 0;
  copy.pills = (copy.pills || []).map((pill, index) => {
    if (pill.iconType === 'image' && isData(pill.iconData)) {
      droppedImages += 1;
      const fallback = DEFAULT_SETTINGS.pills[index] || DEFAULT_SETTINGS.pills[0];
      return { ...pill, iconType: 'emoji', icon: pill.icon || fallback.icon, iconData: '' };
    }
    return pill;
  });
  if (copy.watermark && copy.watermark.iconType === 'image' && isData(copy.watermark.iconData)) {
    droppedImages += 1;
    copy.watermark = { ...copy.watermark, iconType: 'default', iconData: '' };
  }
  return { settings: copy, droppedImages };
}

export function encodeSettings(settings) {
  const { settings: clean, droppedImages } = settingsForSharing(settings);
  const code = PREFIX + toB64Url(deflateSync(strToU8(JSON.stringify(clean)), { level: 9 }));
  return { code, droppedImages };
}

export function decodeSettings(input) {
  const text = String(input || '').trim();
  const code = text.includes('#shared=') ? text.split('#shared=')[1] : text;
  if (!code.startsWith(PREFIX)) throw new Error('This does not look like a BeeRus settings code.');
  try {
    const json = strFromU8(inflateSync(fromB64Url(code.slice(PREFIX.length))));
    return normalizeSettings(JSON.parse(json));
  } catch {
    throw new Error('This link or code is damaged or cut short. Ask the sender to share it again.');
  }
}

export const shareLink = (code) => `${window.location.origin}${window.location.pathname}#shared=${code}`;

/** A few human-readable lines about what a shared settings code changes. */
export function describeSettings(settings) {
  const a = settings.appearance;
  return [
    `Card text: ${a.fontSize}px, line height ${a.lineHeight}`,
    `Pills: ${settings.pills.map(p => p.label).join(', ')}`,
    `Pill look: ${settings.pillStyle.style}, size ${settings.pillStyle.scale}%`,
    `Pill text: ${settings.pillBody.fontSize}px, ${settings.pillBody.spacing} spacing`,
    settings.watermark.enabled ? 'Watermark: on' : 'Watermark: off',
  ];
}
