import { useEffect } from "react";
import FlashcardEditor from "./components/FlashcardEditor";
import './index.css'; // Make sure the styles are imported

function App() {
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
      {/* This renders your new custom component */}
      <FlashcardEditor />
    </div>
  );
}

export default App;
