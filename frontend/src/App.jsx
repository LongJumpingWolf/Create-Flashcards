import FlashcardEditor from "./components/FlashcardEditor";
import './index.css'; // Make sure the styles are imported

function App() {
  return (
    <div className="min-h-screen">
      {/* This renders your new custom component */}
      <FlashcardEditor />
    </div>
  );
}

export default App;