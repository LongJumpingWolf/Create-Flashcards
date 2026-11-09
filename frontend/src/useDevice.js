import { useEffect, useState } from 'react';

const FULL_KEY = 'beerus-full-editor';
const PHONE_QUERY = '(max-width: 767px)';

/** 'phone' (simple capture UI), 'tablet' (every feature, touch friendly) or 'desktop'. */
export function readDevice() {
  if (typeof window === 'undefined') return 'desktop';
  let forceFull = false;
  try { forceFull = localStorage.getItem(FULL_KEY) === '1'; } catch { /* storage unavailable */ }
  if (!forceFull && window.matchMedia(PHONE_QUERY).matches) return 'phone';
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  return touch && window.innerWidth < 1200 ? 'tablet' : 'desktop';
}

export function setFullEditor(on) {
  try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export default function useDevice() {
  const [device, setDevice] = useState(readDevice);
  useEffect(() => {
    const update = () => setDevice(readDevice());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); };
  }, []);
  useEffect(() => { document.documentElement.dataset.device = device; }, [device]);
  return device;
}
