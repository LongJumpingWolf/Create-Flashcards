import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import FlashcardEditor from "./components/FlashcardEditor";
import useDevice from './useDevice';
import './index.css'; // Make sure the styles are imported

const MobileShell = lazy(() => import('./components/MobileShell'));

const SettingsPage = lazy(() => import('./components/SettingsPage'));
const IconMaker = lazy(() => import('./components/IconMaker'));
const FoldersPage = lazy(() => import('./components/FoldersPage'));
const SharedSettingsPrompt = lazy(() => import('./components/SettingsDialogs').then(m => ({ default: m.SharedSettingsPrompt })));
const routeFromHash = () => {
  if (typeof window === 'undefined') return '';
  return window.location.hash === '#settings' ? 'settings' : window.location.hash === '#icons' ? 'icons' : window.location.hash === '#folders' ? 'folders' : '';
};

function App() {
  const device = useDevice();
  const [sharedLink, setSharedLink] = useState(() => typeof window !== 'undefined' && window.location.hash.startsWith('#shared='));
  const [route, setRoute] = useState(routeFromHash);
  const go = useCallback((next) => {
    if (next) window.location.hash = next;
    else if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    setRoute(next);
  }, []);
  useEffect(() => {
    const sync = () => { setRoute(routeFromHash()); if (window.location.hash.startsWith('#shared=')) setSharedLink(true); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    const preventPagePinch = (event) => event.preventDefault();
    const preventPagePinchMove = (event) => {
      if (event.touches?.length > 1 && !event.target?.closest?.('.pdf-page-viewport')) {
        event.preventDefault();
      }
    };

    document.addEventListener('gesturestart', preventPagePinch, { passive: false });
    document.addEventListener('gesturechange', preventPagePinch, { passive: false });
    document.addEventListener('gestureend', preventPagePinch, { passive: false });
    document.addEventListener('touchmove', preventPagePinchMove, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', preventPagePinch);
      document.removeEventListener('gesturechange', preventPagePinch);
      document.removeEventListener('gestureend', preventPagePinch);
      document.removeEventListener('touchmove', preventPagePinchMove);
    };
  }, []);

  const sharedPrompt = sharedLink ? <Suspense fallback={null}><SharedSettingsPrompt onDone={() => setSharedLink(false)} /></Suspense> : null;

  if (device === 'phone') {
    return <><Suspense fallback={<div className="set-loading">Loading…</div>}><MobileShell /></Suspense>{sharedPrompt}</>;
  }

  return (
    <div className="min-h-screen">
      {sharedPrompt}
      {/* The editor stays mounted (hidden) while settings are open, so nothing in progress is lost. */}
      <div hidden={route !== ''}><FlashcardEditor onOpenSettings={() => go('settings')} onOpenFolders={() => go('folders')} /></div>
      {route === 'settings' && <Suspense fallback={<div className="set-loading">Loading settings…</div>}><SettingsPage onClose={() => go('')} onOpenIcons={() => go('icons')} /></Suspense>}
      {route === 'folders' && <Suspense fallback={<div className="set-loading">Loading folders…</div>}><FoldersPage onClose={() => go('')} onOpenSettings={() => go('settings')} /></Suspense>}
      {route === 'icons' && <Suspense fallback={<div className="set-loading">Loading icon maker…</div>}><IconMaker onClose={() => go('settings')} /></Suspense>}
    </div>
  );
}

export default App;
