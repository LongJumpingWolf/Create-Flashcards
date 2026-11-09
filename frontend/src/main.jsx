import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cache the app so it opens and works with no connection (production builds only).
// A new version is downloaded in the background; without this prompt it would wait for every tab to close,
// so people kept seeing the old site after an update.
function showUpdateBanner(applyUpdate) {
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100000;display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:12px;background:#1f2937;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18)';
  const text = document.createElement('span');
  text.textContent = 'A new version is ready.';
  const reload = document.createElement('button');
  reload.textContent = 'Reload now';
  reload.style.cssText = 'padding:6px 12px;border-radius:8px;border:0;background:#6aa9ff;color:#06121f;font:700 13px system-ui,sans-serif;cursor:pointer';
  reload.onclick = () => applyUpdate();
  const later = document.createElement('button');
  later.textContent = 'Later';
  later.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer';
  later.onclick = () => bar.remove();
  bar.append(text, reload, later);
  document.body.appendChild(bar);
}

if (import.meta.env.PROD) {
  // The new service worker takes over by itself (skipWaiting + clientsClaim); tell the person a reload gets the new version.
  const hadController = Boolean(navigator.serviceWorker?.controller);
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(() => window.location.reload()); });
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => registration.update().catch(() => {});
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
}
