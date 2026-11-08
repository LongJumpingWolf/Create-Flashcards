import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import FlashcardEditor from "./components/FlashcardEditor";
import './index.css'; // Make sure the styles are imported

const SettingsPage = lazy(() => import('./components/SettingsPage'));
const settingsRequested = () => typeof window !== 'undefined' && window.location.hash === '#settings';

function App() {
  const [showSettings, setShowSettings] = useState(settingsRequested);
  const openSettings = useCallback(() => { window.location.hash = 'settings'; setShowSettings(true); }, []);
  const closeSettings = useCallback(() => { if (window.location.hash === '#settings') history.replaceState(null, '', window.location.pathname + window.location.search); setShowSettings(false); }, []);
  useEffect(() => {
    const sync = () => setShowSettings(settingsRequested());
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
    const preventBrowserZoomWheel = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.target?.closest?.('.pdf-page-viewport')) {
        event.preventDefault();
      }
    };

    document.addEventListener('gesturestart', preventPagePinch, { passive: false });
    document.addEventListener('gesturechange', preventPagePinch, { passive: false });
    document.addEventListener('gestureend', preventPagePinch, { passive: false });
    document.addEventListener('touchmove', preventPagePinchMove, { passive: false });
    document.addEventListener('wheel', preventBrowserZoomWheel, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', preventPagePinch);
      document.removeEventListener('gesturechange', preventPagePinch);
      document.removeEventListener('gestureend', preventPagePinch);
      document.removeEventListener('touchmove', preventPagePinchMove);
      document.removeEventListener('wheel', preventBrowserZoomWheel);
    };
  }, []);

  return (
    <div className="min-h-screen">
      {/* The editor stays mounted (hidden) while settings are open, so nothing in progress is lost. */}
      <div hidden={showSettings}><FlashcardEditor onOpenSettings={openSettings} /></div>
      {showSettings && <Suspense fallback={<div className="set-loading">Loading settings…</div>}><SettingsPage onClose={closeSettings} /></Suspense>}
    </div>
  );
}

export default App;
