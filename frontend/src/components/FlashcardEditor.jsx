import React, { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from 'react-dom';
// NEW: Import the modal component
import DocumentationModal from './DocumentationModal';
import { hasSavedPdf } from '../pdfResumeStorage';

const PdfStudyPanel = lazy(() => import('./PdfStudyPanel'));

class PdfPanelErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('PDF workspace failed to initialize:', error); }
  render() {
    if (this.state.error) return <section className="pdf-study-panel pdf-load-error"><h2>PDF tools couldn’t start</h2><p>{this.state.error.message || 'A browser PDF component failed to load.'}</p><button onClick={() => this.props.onClose?.()}>Close PDF tools</button><button onClick={() => window.location.reload()}>Reload workspace</button></section>;
    return this.props.children;
  }
}
import { Trash2, FileText, Download, PlusCircle, Tag, Settings, XCircle, Palette, Ban, HelpCircle, Edit, ChevronRight, ChevronDown, Link, Upload, ArrowUp, ArrowDown, AlignCenter, Layers3, Search, Check, LoaderCircle, Eye, BookOpen, Sparkles, Crop } from './Icons';

const initialDecks = ["Default Deck"];
const baseInputStyle = "px-3 py-2 rounded-lg border border-neutral-700 bg-neutral-800 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500";
const inputStyle = `${baseInputStyle} w-full`;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV
  ? `http://${window.location.hostname || '127.0.0.1'}:8000`
  : "https://create-flashcards-api.vercel.app");
const MAIN_LS_KEY = "ankiDeckBuilderState";
const FRONT_LS_KEY = "ankiDeckBuilderState_front";
const CLOZE_COLOR_LS_KEY = "ankiDeckBuilderState_clozeColor";
const BASIC_COLORS_LS_KEY = "ankiDeckBuilderState_basicColors";
const CARD_TYPES = ["Basic", "Cloze", "Image Occlusion"];
const BASE_IMAGE_WIDTH = 300; // Define a constant for base image width

const PRESET_COLORS = [
  '#60A5FA',
  '#F87171',
  '#A78BFA',
  '#22D3EE',
  '#FBBF24',
];
const DEFAULT_CLOZE_COLOR = PRESET_COLORS[0];
const DEFAULT_BASIC_PRESETS = [PRESET_COLORS[0], PRESET_COLORS[2], PRESET_COLORS[1]];
const LEGACY_BASIC_PRESETS = ['#4ADE80', '#60A5FA', '#FCD34D'];
const CLEAR_COLOR = '#F1F5F9';
const ANKI_LINK_COLOR = '#38BDF8'; // A bright, contrast-safe blue

// Helper to remove color spans for export/parsing
const cleanColorSpans = (html) => {
    html = html.replace(/<font\s+color="[^"]*">(.*?)<\/font>/gi, '$1');
    return html.replace(/<span\s+style="color:[^"]*;">(.*?)<\/span>/gi, '$1');
}

// Helper to apply color styling only to valid cloze deletions
const colorClozeContent = (html, color) => {
    let cleanedHtml = cleanColorSpans(html);

    const clozePattern = /(\{\{c\d+::.*?\}\})/gi;

    return cleanedHtml.replace(clozePattern, (match, p1) => {
        return `<span style="color:${color};">${p1}</span>`;
    });
}

function OcclusionPreview({ image, masks, imageWidth = 720, mode = 'hide-all', cardIndex = 0, answerSide = false }) {
  const [dimensions, setDimensions] = useState(null);
  const groups = [...new Set(masks.map((mask, index) => String(mask.group || mask.id || `mask-${index + 1}`)))];
  const activeGroup = groups[cardIndex] || groups[0];
  const shownMasks = masks.filter((mask, index) => {
    const isActive = String(mask.group || mask.id || `mask-${index + 1}`) === activeGroup;
    return mode === 'hide-one' ? (!answerSide && isActive) : (!answerSide || !isActive);
  });
  return (
    <div className="preview-occlusion-image">
      <img
        src={image}
        alt="Image occlusion card source"
        style={{ width: `${imageWidth}px` }}
        onLoad={event => setDimensions({
          src: image,
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })}
      />
      {dimensions?.src === image && dimensions.width > 0 && dimensions.height > 0 && (
        <svg
          className="preview-occlusion-masks"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
          aria-label={`${groups.length} image occlusion cards`}
        >
          {shownMasks.map((mask, index) => {
            const isQuestionMask = String(mask.group || mask.id || `mask-${index + 1}`) === activeGroup;
            const x = mask.x * dimensions.width;
            const y = mask.y * dimensions.height;
            const width = mask.width * dimensions.width;
            const height = mask.height * dimensions.height;
            const common = {
              key: mask.id || index,
              fill: isQuestionMask ? '#ff8e8e' : '#ffeba2',
              stroke: isQuestionMask ? '#b94d4d' : '#b89a3a',
              strokeWidth: 1.25,
              style: { fill: isQuestionMask ? '#ff8e8e' : '#ffeba2', stroke: isQuestionMask ? '#b94d4d' : '#b89a3a' },
              vectorEffect: 'non-scaling-stroke',
            };
            if (mask.shape === 'polygon' && mask.points?.length >= 3) {
              return <polygon {...common} points={mask.points.map(point => `${point.x * dimensions.width},${point.y * dimensions.height}`).join(' ')} />;
            }
            if (mask.shape === 'ellipse') {
              return <ellipse {...common} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
            }
            return <rect {...common} x={x} y={y} width={width} height={height} />;
          })}
        </svg>
      )}
    </div>
  );
}

const listStyles = `
  .editable-content {
    color: ${CLEAR_COLOR};
  }
  .editable-content ul {
    list-style-type: disc;
    padding-left: 20px;
    margin: 8px 0;
  }
  .editable-content ol {
    list-style-type: decimal;
    padding-left: 20px;
    margin: 8px 0;
  }
  .editable-content li {
    margin: 4px 0;
  }
  .toolbar-button {
    display: inline-flex;
    min-width: 30px;
    height: 30px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: #d4d4d4;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .toolbar-button:hover:not(:disabled) { background: #404040; color: #fff; }
  .toolbar-button:disabled { opacity: .4; cursor: not-allowed; }
  .tag-suggestions {
    position: absolute;
    z-index: 50;
    background: #262626;
    border: 1px solid #404040;
    border-radius: 8px;
    max-height: 200px;
    overflow-y: auto;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
  }
  .tag-suggestion-item {
      padding: 8px 12px;
      cursor: pointer;
  }
  .tag-suggestion-item:hover,
  .tag-suggestion-item.selected {
    background: #404040;
  }
  .preview-content img {
    max-width: 100%;
    max-height: 60vh;
    height: auto;
    object-fit: contain;
    display: inline-block; 
  }
`;

const getCardPreview = (content) => {
    if (!content) return '';
    content = cleanColorSpans(content);
    if (/<img[^>]*>/i.test(content)) {
        return "[IMAGE] " + content.replace(/<img[^>]*>/gi, '').substring(0, 50).trim() + '...';
    }
    const cleanText = content.replace(/<[^>]*>/g, '');
    return cleanText.substring(0, 100) + (cleanText.length > 100 ? '...' : '');
};

const getHighestClozeNumber = (text) => {
  if (!text) return 0;
  text = cleanColorSpans(text);
  const matches = text.match(/\{\{c(\d+)::.*?\}\}/g);
  if (!matches || matches.length === 0) return 0;

  const numbers = matches.map(match => {
    const numMatch = match.match(/c(\d+)/);
    return numMatch ? parseInt(numMatch[1]) : 0;
  });
  return Math.max(0, ...numbers);
};

const formatTagForDisplay = (tag) => {
  return tag.replace(/::/g, ' > ');
};

const buildTagHierarchy = (allTags, currentSearch = '') => {
  const root = { name: '__ROOT__', children: new Map() };

  const addTagToHierarchy = (node, parts, fullTag) => {
    if (parts.length === 0) return;

    const [currentPart, ...rest] = parts;

    const normalizedKey = currentPart.toLowerCase();

    if (!node.children.has(normalizedKey)) {
      node.children.set(normalizedKey, {
        name: currentPart,
        fullTag: rest.length === 0 ? fullTag : '',
        children: new Map(),
      });
    }
    addTagToHierarchy(node.children.get(normalizedKey), rest, fullTag);
  };

  const filteredTags = Array.from(allTags).filter(tag => tag.toLowerCase().includes(currentSearch.toLowerCase()));

  filteredTags.forEach(tag => {
    addTagToHierarchy(root, tag.split('::'), tag);
  });

  const convertMapToArray = (node) => {
    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      const isAParent = a.children.size > 0;
      const isBParent = b.children.size > 0;
      if (isAParent && !isBParent) return -1;
      if (!isAParent && isBParent) return 1;
      return a.name.localeCompare(b.name);
    });

    return sortedChildren.map(child => ({
      ...child,
      children: convertMapToArray(child),
    }));
  };

  return convertMapToArray(root);
};


// --- Recursive Component to Render Tag Hierarchy (Outside for scope) ---
const RenderTagHierarchy = ({ nodes, level = 0, currentTags, onSelectTag, getTagCardCount, onDeleteTag, onRenameTag }) => {
    const [expandedNodes, setExpandedNodes] = useState(new Set());

    const toggleExpand = (nodeName) => {
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(nodeName)) {
                newSet.delete(nodeName);
            } else {
                newSet.add(nodeName);
            }
            return newSet;
        });
    };

    return nodes.map((node) => {
      const isLeaf = node.children.length === 0;
      const fullTag = node.fullTag;
      const isSelected = fullTag && currentTags.includes(fullTag);
      const isExpanded = expandedNodes.has(node.name);
      const isParent = !isLeaf;

      const cardCount = isLeaf ? getTagCardCount(fullTag) : 0;

      return (
        <React.Fragment key={node.name + fullTag}>
          <div
            className={`flex justify-between items-center py-2 px-3 hover:bg-neutral-700/30 rounded transition ${isSelected ? 'bg-sky-900/50' : ''} ${isParent ? 'cursor-pointer' : ''}`}
            style={{ paddingLeft: `${12 + level * 20}px` }}
            onClick={() => isParent && toggleExpand(node.name)}
          >
            <div className="flex items-center gap-2">
              {isParent && (
                  <button className="text-neutral-400 p-0.5" onClick={(e) => { e.stopPropagation(); toggleExpand(node.name); }}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
              )}
              <span className={`font-medium ${isLeaf && cardCount === 0 ? 'text-neutral-500' : 'text-neutral-200'}`}>
                {node.name}
              </span>
              {isLeaf && (
                <span className="text-xs text-neutral-500">
                  ({cardCount} cards)
                </span>
              )}
            </div>
            {isLeaf && (
              <div className="flex items-center gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); onRenameTag(fullTag); }}
                    title="Rename Tag"
                    className="text-yellow-400 hover:text-yellow-300 p-1"
                >
                    <Edit size={14} />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTag(fullTag); }}
                    title={`Delete Tag (removes from all ${cardCount} cards)`}
                    className="text-red-400 hover:text-red-300 p-1"
                >
                    <Trash2 size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSelectTag(fullTag); }}
                  className={`px-3 py-1 text-xs rounded transition font-semibold ${
                    isSelected
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {isSelected ? 'Remove' : 'Add'}
                </button>
              </div>
            )}
          </div>
          {isParent && isExpanded && (
            <div className="border-l border-neutral-700 ml-3">
              <RenderTagHierarchy
                nodes={node.children}
                level={level + 1}
                currentTags={currentTags}
                onSelectTag={onSelectTag}
                getTagCardCount={getTagCardCount}
                onDeleteTag={onDeleteTag}
                onRenameTag={onRenameTag}
              />
            </div>
          )}
        </React.Fragment>
      );
    });
};


export default function FlashcardEditor() {
  const [deckName, setDeckName] = useState(initialDecks[0]);
  const [cardType, setCardType] = useState("Basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [currentTags, setCurrentTags] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewAnswerSide, setPreviewAnswerSide] = useState(false);
  const [previewOcclusionIndex, setPreviewOcclusionIndex] = useState(0);
  const [cards, setCards] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [contentInitialized, setContentInitialized] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [mobileView, setMobileView] = useState('editor');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [occlusionImage, setOcclusionImage] = useState(null);
  const [occlusionImageWidth, setOcclusionImageWidth] = useState(720);
  const [occlusionEditorOpen, setOcclusionEditorOpen] = useState(false);
  const [occlusionMasks, setOcclusionMasks] = useState([]);
  const [occlusionMode, setOcclusionMode] = useState('hide-all');
  const [manualMaskPreview, setManualMaskPreview] = useState(null);
  const manualMaskStartRef = useRef(null);
  const imageResizeStartRef = useRef(null);

  useEffect(() => {
    if (!occlusionEditorOpen) return undefined;
    const oldBodyOverflow = document.body.style.overflow;
    const oldRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = oldBodyOverflow;
      document.documentElement.style.overflow = oldRootOverflow;
    };
  }, [occlusionEditorOpen]);

  useEffect(() => {
    let active = true;
    hasSavedPdf().then(hasPdf => {
      if (active && hasPdf) {
        setPdfOpen(true);
        setShowLibrary(false);
        setMobileView('pdf');
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const [clozeColor, setClozeColor] = useState(DEFAULT_CLOZE_COLOR);
  const [basicColorPresets, setBasicColorPresets] = useState(DEFAULT_BASIC_PRESETS);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerTarget, setColorPickerTarget] = useState(null);
  const [customHex, setCustomHex] = useState('');

  const [editingIndex, setEditingIndex] = useState(null);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSelectorSearch, setTagSelectorSearch] = useState("");
  const [showCardBrowser, setShowCardBrowser] = useState(false);
  const [browserSearch, setBrowserSearch] = useState('');
  const [browserSelectedIndex, setBrowserSelectedIndex] = useState(null);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkHeading, setLinkHeading] = useState('');
  const [linkTargetRef, setLinkTargetRef] = useState(null);

  const [showDocumentationModal, setShowDocumentationModal] = useState(false);
  
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const [activeEditor, setActiveEditor] = useState('front');
  const [selectionContext, setSelectionContext] = useState(null);
  const savedRangeRef = useRef(null);

  const [allAvailableTags, setAllAvailableTags] = useState(new Set([
    "Medicine::Cardiology",
    "Medicine::Neurology",
    "Medicine::Pathology",
    "QBank::Incorrect",
    "QBank::HighYield",
    "Biology::Cells",
    "Biology::Genetics",
    "History::WWII",
    "ComputerScience::Algorithms",
    "ComputerScience::DataStructures",
    "Physics"
  ]));
  const [hiddenTags, setHiddenTags] = useState(new Set()); 
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);

  const tagInputRef = useRef(null);
  const tagSuggestionsRef = useRef(null);
  const cardSearchRef = useRef(null);

  const [clozeNumber, setClozeNumber] = useState(1);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [activeClozeId, setActiveClozeId] = useState(null);

  const frontRef = useRef(null);
  const backRef = useRef(null);
  const previousCardTypeRef = useRef('Basic');
  const storageTimersRef = useRef({});
  const frontSaveTimerRef = useRef(null);
  const backSaveTimerRef = useRef(null);

  const saveLocal = useCallback((key, value) => {
    window.clearTimeout(storageTimersRef.current[key]);
    setSaveStatus('Saving');
    storageTimersRef.current[key] = window.setTimeout(() => {
      try {
        localStorage.setItem(key, typeof value === 'function' ? value() : value);
        setSaveStatus('Saved');
      } catch (error) {
        console.error('Could not save local deck data', error);
        setSaveStatus('Storage full');
      }
    }, 260);
  }, []);

  useEffect(() => () => {
    Object.values(storageTimersRef.current).forEach(window.clearTimeout);
    window.clearTimeout(frontSaveTimerRef.current);
    window.clearTimeout(backSaveTimerRef.current);
  }, []);

  // =================================================================
  // CORE FUNCTIONS
  // =================================================================

  const syncFrontContent = useCallback((content, commit = false) => {
      if (frontRef.current) {
          saveLocal(FRONT_LS_KEY, cleanColorSpans(content));
          if (commit) {
            setFront(cleanColorSpans(content));
            if (cardType === 'Cloze') frontRef.current.innerHTML = colorClozeContent(content, clozeColor);
          }
      }
  }, [saveLocal, cardType, clozeColor]);

  const syncBackContent = useCallback((content, commit = false) => {
      if (backRef.current) {
          saveLocal(FRONT_LS_KEY + '_back', content);
          if (commit) setBack(content);
      }
  }, [saveLocal]);

  const scheduleEditorSave = (target) => {
    const timerRef = target === 'front' ? frontSaveTimerRef : backSaveTimerRef;
    const editorRef = target === 'front' ? frontRef : backRef;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!editorRef.current) return;
      if (target === 'front') syncFrontContent(editorRef.current.innerHTML, true);
      else syncBackContent(editorRef.current.innerHTML, true);
    }, 700);
  };

  const commitEditorSave = (target, content) => {
    const timerRef = target === 'front' ? frontSaveTimerRef : backSaveTimerRef;
    window.clearTimeout(timerRef.current);
    if (target === 'front') syncFrontContent(content, true);
    else syncBackContent(content, true);
  };

  const updateCard = useCallback(() => {
      const finalFront = frontRef.current ? frontRef.current.innerHTML.trim() : front.trim();
      const finalBack = backRef.current ? backRef.current.innerHTML.trim() : back.trim();
      const finalOcclusionImage = occlusionImage || frontRef.current?.querySelector('img')?.src || null;

      if (cardType === 'Image Occlusion' && !finalOcclusionImage) {
          setFormMessage('Add an image to this Image Occlusion card first.'); return;
      }
      if (cardType === 'Image Occlusion' && occlusionMasks.length === 0) {
          setFormMessage('This card is set to Image Occlusion, but no hidden regions were made. Draw at least one mask or switch back to the previous card type.'); return;
      }

      if (cardType === "Basic" && (!finalFront || !finalBack)) {
          setFormMessage("Add content to both sides before saving this card."); return;
      }
      if (cardType === "Cloze" && (!finalFront || !finalFront.match(/\{\{c\d+::[^}]+\}\}/))) {
          setFormMessage("Add at least one cloze deletion, such as {{c1::key term}}."); return;
      }

      setCards(prevCards => prevCards.map((card, i) => i === editingIndex ? {
          ...card,
          type: cardType,
          question: cardType === 'Image Occlusion' ? '' : finalFront,
          answer: finalBack,
          tags: currentTags,
          ...(cardType === 'Image Occlusion' ? { imageData: finalOcclusionImage, imageWidth: occlusionImageWidth, masks: occlusionMasks, occlusionMode, restoreType: card.restoreType || previousCardTypeRef.current } : {}),
      } : card));

      const nextType = cardType === 'Image Occlusion' ? previousCardTypeRef.current : cardType;
      window.clearTimeout(frontSaveTimerRef.current); window.clearTimeout(backSaveTimerRef.current);
      setEditingIndex(null);
      setCardType(nextType);
      setOcclusionImage(null);
      setOcclusionMasks([]);
      setFormMessage('');
      setFront("");
      setBack("");
      setCurrentTags([]);
      if (frontRef.current) frontRef.current.innerHTML = '';
      if (backRef.current) backRef.current.innerHTML = '';
  }, [front, back, occlusionImage, occlusionImageWidth, occlusionMasks, occlusionMode, cardType, currentTags, editingIndex]);

  const deleteCard = (indexToDelete) => {
      if (window.confirm(`Are you sure you want to delete Card #${cards.length - indexToDelete}?`)) {
          setCards(prevCards => prevCards.filter((_, i) => i !== indexToDelete));
      }
  };


  const addCard = useCallback(() => {
    const finalFront = frontRef.current ? frontRef.current.innerHTML.trim() : front.trim();
    const finalBack = backRef.current ? backRef.current.innerHTML.trim() : back.trim();

    if (cardType === 'Image Occlusion') {
      const finalOcclusionImage = occlusionImage || frontRef.current?.querySelector('img')?.src || null;
      if (!finalOcclusionImage) {
        setFormMessage('Add an image to this Image Occlusion card first.');
        return;
      }
      if (occlusionMasks.length === 0) {
        setFormMessage('This card is set to Image Occlusion, but no hidden regions were made. Draw at least one mask or switch back to the previous card type.');
        return;
      }
      const ioCard = { type: cardType, question: '', answer: finalBack, tags: currentTags, created: new Date().toLocaleTimeString(), imageData: finalOcclusionImage, imageWidth: occlusionImageWidth, masks: occlusionMasks, occlusionMode, restoreType: previousCardTypeRef.current };
      if (editingIndex !== null) return updateCard();
      setCards(prev => [ioCard, ...prev]);
      window.clearTimeout(frontSaveTimerRef.current); window.clearTimeout(backSaveTimerRef.current);
      setFormMessage('');
      setBack(''); setFront(''); setCurrentTags([]);
      setCardType(previousCardTypeRef.current);
      setOcclusionImage(null); setOcclusionMasks([]);
      if (frontRef.current) frontRef.current.innerHTML = '';
      if (backRef.current) backRef.current.innerHTML = '';
      return;
    }

    if (cardType === "Basic") {
      if (!finalFront || !finalBack) {
        setFormMessage("Add content to both sides before saving this card.");
        return;
      }
    } else if (cardType === "Cloze") {
      if (!finalFront) {
        setFormMessage("Add text to the prompt before creating a cloze card.");
        return;
      }
      if (!finalFront.match(/\{\{c\d+::[^}]+\}\}/)) {
        setFormMessage("Select key text while holding Ctrl or Command to create a cloze deletion.");
        return;
      }
    }

    if (editingIndex !== null) {
        return updateCard();
    }

    setFormMessage('');

    const newCard = {
        type: cardType,
        question: finalFront,
        answer: finalBack,
        tags: currentTags,
        created: new Date().toLocaleTimeString()
    };

    setCards([newCard, ...cards]);

    window.clearTimeout(frontSaveTimerRef.current); window.clearTimeout(backSaveTimerRef.current);
    setFront("");
    setBack("");
    setCurrentTags([]);
    setClozeNumber(1);
    setActiveClozeId(null);
    if (frontRef.current) frontRef.current.innerHTML = '';
    if (backRef.current) backRef.current.innerHTML = '';

  }, [cardType, front, back, currentTags, cards, editingIndex, updateCard, occlusionImage, occlusionImageWidth, occlusionMasks, occlusionMode]);


  const exportDeck = useCallback(async () => {
    if (cards.length === 0) {
        setExportMessage("Add at least one card before exporting.");
        return;
    }
    setIsExporting(true);
    setExportMessage('');

    const payload = {
      deck_name: deckName,
      cards: cards.map(c => ({
        type: c.type,
        question: c.question,
        answer: c.answer,
        tags: c.tags,
        ...(c.type === 'Image Occlusion' ? { image_data: c.imageData, image_width: c.imageWidth, masks: c.masks, occlusion_mode: c.occlusionMode } : {}),
      }))
    };

    console.log("Exporting deck... contacting backend.");

    try {
      const res = await fetch(`${BACKEND_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        setExportMessage(`Export failed (${res.status}): ${errorText.substring(0, 180)}`);
        return;
      }

      if (res.headers.get('content-type') && !res.headers.get('content-type').includes('application/octet-stream')) {
        const errorText = await res.text();
        setExportMessage(`Unexpected response from the export service: ${errorText.substring(0, 180)}`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = deckName.trim().replace(/[^a-z0-9\s_-]/gi, '').replace(/\s+/g, '_').toLowerCase() || 'anki_deck';
      a.download = `${filename}.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 500);

      setExportMessage('Deck exported successfully. Open the downloaded .apkg file in Anki.');

    } catch (err) {
      console.error("Network or Fetch Error:", err);
      setExportMessage(`Could not reach the export service at ${BACKEND_URL}. Check that the backend is running and try again.`);
    } finally {
      setIsExporting(false);
    }
  }, [cards, deckName]);

  const startNewDeck = () => {
    if (window.confirm(`Are you sure you want to start a new deck? All ${cards.length} unexported cards will be cleared.`)) {
        setCards([]);
        setDeckName(initialDecks[0]);
        setCardType("Basic");
        previousCardTypeRef.current = 'Basic';
        setOcclusionImage(null);
        setOcclusionMasks([]);
        setFront("");
        setBack("");
        setCurrentTags([]);
        setClozeNumber(1);
        setActiveClozeId(null);
        setEditingIndex(null);
        if (frontRef.current) frontRef.current.innerHTML = '';
        if (backRef.current) backRef.current.innerHTML = '';
        localStorage.removeItem(MAIN_LS_KEY);
        localStorage.removeItem(FRONT_LS_KEY);
        localStorage.removeItem(FRONT_LS_KEY + '_back');
        localStorage.removeItem(CLOZE_COLOR_LS_KEY);
        localStorage.removeItem(BASIC_COLORS_LS_KEY);
        setClozeColor(DEFAULT_CLOZE_COLOR);
        setBasicColorPresets(DEFAULT_BASIC_PRESETS);
    }
  }

  const loadCardForEdit = (index) => {
    const card = cards[index];
    setEditingIndex(index);
    setMobileView('editor');
    setFormMessage('');
    setCardType(card.type);
    if (card.type === 'Image Occlusion') {
      previousCardTypeRef.current = card.restoreType || 'Basic';
      setOcclusionImage(card.imageData || null);
      setOcclusionImageWidth(card.imageWidth || 720);
      setOcclusionMasks(card.masks || []);
      setOcclusionMode(card.occlusionMode || 'hide-all');
    } else {
      setOcclusionImage(null); setOcclusionMasks([]);
    }

    const displayFront = card.type === 'Cloze' ? colorClozeContent(card.question, clozeColor) : card.question;
    setFront(card.question);
    setBack(card.answer);
    setCurrentTags(card.tags);

    if (frontRef.current) frontRef.current.innerHTML = displayFront;
    if (backRef.current) backRef.current.innerHTML = card.answer;
  };

  const deleteGlobalTag = (tagToDelete) => {
    const cardCount = getTagCardCount(tagToDelete);
    if (!window.confirm(`Are you sure you want to permanently delete the tag "${formatTagForDisplay(tagToDelete)}"? It will be removed from ALL ${cardCount} cards and your suggestions list.`)) {
        return;
    }
    setAllAvailableTags(prev => {
        const newSet = new Set(prev);
        newSet.delete(tagToDelete);
        return newSet;
    });
    setCurrentTags(currentTags.filter(t => t !== tagToDelete));
    setCards(prevCards => prevCards.map(card => ({
        ...card,
        tags: card.tags.filter(t => t !== tagToDelete)
    })));
  };

  const renameGlobalTag = (oldTag) => {
    const newTag = window.prompt(`Rename tag: "${formatTagForDisplay(oldTag)}"\nEnter new tag name:`, oldTag);

    if (!newTag || newTag.trim() === oldTag) return;

    const trimmedNewTag = newTag.trim();

    if (trimmedNewTag.toLowerCase() === oldTag.toLowerCase() && trimmedNewTag !== oldTag) {
        if (!window.confirm(`The new tag name is only different by case. Do you want to proceed and replace all instances of "${oldTag}" with "${trimmedNewTag}"?`)) {
             return;
        }
    } else if (allAvailableTags.has(trimmedNewTag)) { 
        alert(`Error: The tag "${trimmedNewTag}" already exists.`); 
        return; 
    }

    if (!window.confirm(`Confirm renaming tag "${formatTagForDisplay(oldTag)}" to "${formatTagForDisplay(trimmedNewTag)}". This affects all cards.`)) {
        return;
    }
    
    setCards(prevCards => prevCards.map(card => ({
        ...card,
        tags: card.tags.map(t => t === oldTag ? trimmedNewTag : t)
    })));

    setCurrentTags(currentTags.map(t => t === oldTag ? trimmedNewTag : t));

    setAllAvailableTags(prev => {
        const newSet = new Set(prev);
        newSet.delete(oldTag);
        newSet.add(trimmedNewTag);
        return newSet;
    });

    setTagSelectorSearch('');
  };

  useEffect(() => {
    if (cardType === 'Cloze' && activeClozeId === null) {
      const highestNum = getHighestClozeNumber(front);
      setClozeNumber(highestNum + 1);
    }
  }, [front, activeClozeId, cardType]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'Control' || e.metaKey) && !isCtrlPressed) {
        setIsCtrlPressed(true);
        if (activeClozeId === null) {
          setActiveClozeId(getHighestClozeNumber(frontRef.current ? cleanColorSpans(frontRef.current.innerHTML) : front) + 1);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          addCard();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          exportDeck();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          addCard();
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA'].includes(e.target.tagName) && !e.target.isContentEditable) {
          e.preventDefault();
          setMobileView('cards');
          cardSearchRef.current?.focus();
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setIsCtrlPressed(false);
        setActiveClozeId(null);
        const currentFrontContent = frontRef.current ? frontRef.current.innerHTML : front;
        setFront(currentFrontContent);
        const highestNum = getHighestClozeNumber(currentFrontContent);
        setClozeNumber(highestNum + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isCtrlPressed, front, activeClozeId, addCard, exportDeck]);

  useEffect(() => {
    try {
      const state = JSON.parse(localStorage.getItem(MAIN_LS_KEY) || '{}');
      const frontContent = localStorage.getItem(FRONT_LS_KEY);
      const backContent = localStorage.getItem(FRONT_LS_KEY + '_back');
      const storedColor = localStorage.getItem(CLOZE_COLOR_LS_KEY);
      const storedBasicColors = JSON.parse(localStorage.getItem(BASIC_COLORS_LS_KEY) || 'null');


      setDeckName(state.deck || initialDecks[0]);
      const initialCardType = state.cardType || "Basic";
      setCardType(initialCardType);
      setCards(state.cards || []);
      setCurrentTags(state.tags || []);
      setFront(frontContent || "");
      setBack(backContent || "");

      const initialColor = storedColor || DEFAULT_CLOZE_COLOR;
      setClozeColor(initialColor);
      setCustomHex(initialColor);
      const isLegacyPalette = Array.isArray(storedBasicColors) && storedBasicColors.length === LEGACY_BASIC_PRESETS.length && storedBasicColors.every((color, index) => color.toUpperCase() === LEGACY_BASIC_PRESETS[index]);
      setBasicColorPresets(isLegacyPalette ? DEFAULT_BASIC_PRESETS : (storedBasicColors || DEFAULT_BASIC_PRESETS));

      if (state.allAvailableTags) {
        setAllAvailableTags(new Set(state.allAvailableTags));
      }
      if (state.hiddenTags) {
        setHiddenTags(new Set(state.hiddenTags));
      }

      const cleanFrontContent = frontContent || "";
      if (frontContent) {
        setClozeNumber(getHighestClozeNumber(cleanFrontContent) + 1);
      } else {
        setClozeNumber(1);
      }

      if (frontRef.current) {
          const displayContent = initialCardType === 'Cloze' ? colorClozeContent(cleanFrontContent, initialColor) : cleanFrontContent;
          frontRef.current.innerHTML = displayContent || "";
      }
      if (backRef.current) {
        backRef.current.innerHTML = backContent || "";
      }

      setIsLoaded(true);
      setContentInitialized(true);

      document.title = "Anki Deck Builder";

    } catch (e) {
      console.error("Could not load state from localStorage", e);
      setIsLoaded(true);
      setContentInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    saveLocal(MAIN_LS_KEY, () => JSON.stringify({
      deck: deckName,
      cardType,
      cards,
      tags: currentTags,
      allAvailableTags: Array.from(allAvailableTags),
      hiddenTags: Array.from(hiddenTags),
    }));
  }, [isLoaded, deckName, cardType, cards, currentTags, allAvailableTags, hiddenTags, saveLocal]);

  useEffect(() => {
    if (!isLoaded) return;
    saveLocal(FRONT_LS_KEY, front);
  }, [isLoaded, front, saveLocal]);

  useEffect(() => {
    if (!isLoaded) return;
    saveLocal(FRONT_LS_KEY + '_back', back);
  }, [isLoaded, back, saveLocal]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(CLOZE_COLOR_LS_KEY, clozeColor);
  }, [isLoaded, clozeColor]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(BASIC_COLORS_LS_KEY, JSON.stringify(basicColorPresets));
  }, [isLoaded, basicColorPresets]);

  const getFilteredSuggestions = () => {
    const query = tagInput.trim().toLowerCase();
    if (!query) return [];

    return Array.from(allAvailableTags)
      .filter(tag => tag.toLowerCase().includes(query) && !currentTags.includes(tag))
      .sort();
  };

  const filteredSuggestions = getFilteredSuggestions();

  const addTag = (tag) => {
    const cleanedTag = tag.trim();
    if (cleanedTag) {
        if (!currentTags.includes(cleanedTag)) {
            setCurrentTags([...currentTags, cleanedTag]);
        }
        setAllAvailableTags(prev => new Set([...prev, cleanedTag]));
        setTagInput("");
        setTagSuggestionIndex(-1);
        setShowTagSuggestions(false);
    }
  };

  const removeTag = (tagToRemove) => {
    setCurrentTags(currentTags.filter((t) => t !== tagToRemove));
  };

  const handleTagInputChange = (e) => {
    setTagInput(e.target.value);
    setTagSuggestionIndex(-1);
    setShowTagSuggestions(e.target.value.trim().length > 0);
  };

  const handleTagKeyDown = (e) => {
    if (filteredSuggestions.length > 0 && showTagSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTagSuggestionIndex(prev => (prev + 1) % filteredSuggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTagSuggestionIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowTagSuggestions(false);
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const trimmedInput = tagInput.trim();
      if (trimmedInput.length > 0 && !trimmedInput.endsWith('::')) {
        setTagInput(trimmedInput + '::');
        setShowTagSuggestions(true);
        setTagSuggestionIndex(-1);
        return;
      }
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagSuggestionIndex !== -1 && filteredSuggestions.length > 0) {
        addTag(filteredSuggestions[tagSuggestionIndex]);
      } else {
        addTag(tagInput);
      }
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tagSuggestionsRef.current && !tagSuggestionsRef.current.contains(e.target) &&
          tagInputRef.current && !tagInputRef.current.contains(e.target)) {
        setShowTagSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const tagCardCounts = useMemo(() => {
    const counts = new Map();
    cards.forEach(card => (card.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return counts;
  }, [cards]);
  const getTagCardCount = (tag) => tagCardCounts.get(tag) || 0;

  const getClipboardImage = (clipboardData) => {
    const item = Array.from(clipboardData?.items || []).find(entry => entry.type?.startsWith('image/'));
    const itemFile = item?.getAsFile?.();
    if (itemFile) return itemFile;
    return Array.from(clipboardData?.files || []).find(file => file.type?.startsWith('image/')) || null;
  };

  const pasteImageIntoOcclusion = (e) => {
    if (backRef.current?.contains(e.target)) return;
    const file = getClipboardImage(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      setOcclusionImage(reader.result);
      setOcclusionMasks([]);
      setManualMaskPreview(null);
      setFormMessage('Image pasted as the occlusion source. Draw hide regions over the image.');
    };
    reader.readAsDataURL(file);
  };

  const handleContentPaste = (e, targetRef) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    const file = getClipboardImage(clipboardData);
    if (!file) {
      setTimeout(() => {
        if (!targetRef.current) return;
        if (targetRef === frontRef) syncFrontContent(targetRef.current.innerHTML);
        else if (targetRef === backRef) syncBackContent(targetRef.current.innerHTML);
      }, 10);
      return;
    }

    e.preventDefault();
    const selection = window.getSelection();
    const savedRange = selection?.rangeCount && targetRef.current?.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
    const reader = new FileReader();
    reader.onload = () => {
      const editor = targetRef.current;
      if (!editor) return;
      editor.focus();
      if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
        const currentSelection = window.getSelection();
        currentSelection.removeAllRanges();
        currentSelection.addRange(savedRange);
      } else {
        const endRange = document.createRange();
        endRange.selectNodeContents(editor);
        endRange.collapse(false);
        const currentSelection = window.getSelection();
        currentSelection.removeAllRanges();
        currentSelection.addRange(endRange);
      }
      const tempImgId = `pasted-img-${crypto.randomUUID()}`;
      const imgHtml = `<img id="${tempImgId}" src="${reader.result}" alt="Pasted image" style="display:inline-block;max-width:${BASE_IMAGE_WIDTH}px;height:auto;vertical-align:middle;">&nbsp;`;
      document.execCommand('insertHTML', false, imgHtml);
      const newImage = editor.querySelector(`#${tempImgId}`);
      if (newImage) {
        newImage.removeAttribute('id');
        const newRange = document.createRange();
        newRange.selectNode(newImage);
        const currentSelection = window.getSelection();
        currentSelection.removeAllRanges();
        currentSelection.addRange(newRange);
        setSelectionContext({ type: 'image', element: newImage, size: 100, editorRef: targetRef });
        savedRangeRef.current = newRange;
      }
      if (targetRef === frontRef) syncFrontContent(editor.innerHTML);
      else if (targetRef === backRef) syncBackContent(editor.innerHTML);
    };
    reader.readAsDataURL(file);
  };
  
  const handleFileChange = (e, targetRef) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Image = event.target.result;
          if (targetRef === frontRef && cardType === 'Image Occlusion') {
            setOcclusionImage(base64Image);
            setOcclusionMasks([]);
            setManualMaskPreview(null);
            setFormMessage('Image ready. Drag a masked PDF capture here or add hide regions from the PDF snip tool.');
            return;
          }
          restoreSavedSelection(targetRef);
          const imgHtml = `<img src="${base64Image}" alt="uploaded-image" style="display: inline-block; max-width:${BASE_IMAGE_WIDTH}px; height:auto; vertical-align: middle;">`;
          const finalHtml = imgHtml + '&nbsp;';

          document.execCommand('insertHTML', false, finalHtml);

          if (targetRef === frontRef) {
            syncFrontContent(targetRef.current.innerHTML);
          } else if (targetRef === backRef) {
            syncBackContent(targetRef.current.innerHTML);
          }
        };
        reader.readAsDataURL(file);
      }
    }
    e.target.value = '';
  };


  const handleMouseUpForCloze = (e, targetRef) => {
    if (cardType !== "Cloze" || targetRef !== frontRef || !isCtrlPressed || activeClozeId === null) return;
  
    const selection = window.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed) return;
  
    const selectedText = selection.toString().trim();
    if (!selectedText) return;
  
    range.deleteContents();
  
    const span = document.createElement('span');
    span.style.color = clozeColor;
    span.textContent = `{{c${activeClozeId}::${selectedText}}}`;
  
    range.insertNode(span);
  
    // Move cursor to after the new node and collapse selection
    range.setStartAfter(span);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  
    // Use a non-breaking space to ensure the cursor stays visible and outside the span
    const space = document.createTextNode('\u00A0');
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  
    syncFrontContent(frontRef.current.innerHTML);
  };

  const restoreSavedSelection = (targetRef) => {
    if (!targetRef?.current) return false;
    targetRef.current.focus();
    const range = savedRangeRef.current;
    if (!range || !targetRef.current.contains(range.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const applyFormat = (type, targetRef, value = null) => {
    if (targetRef.current) {
        restoreSavedSelection(targetRef);
        document.execCommand(type, false, value);

        setTimeout(() => {
            if (targetRef === frontRef) {
                syncFrontContent(targetRef.current.innerHTML);
            } else if (targetRef === backRef) {
                syncBackContent(backRef.current.innerHTML);
            }
        }, 10);
    }
  };

  const handleSelectionChange = (e) => {
      const editorRef = e.currentTarget === frontRef.current ? frontRef : backRef;
      setActiveEditor(editorRef === frontRef ? 'front' : 'back');
      
      if (e.target && e.target.nodeName === 'IMG') {
          const imageElement = e.target;
          const selection = window.getSelection();
          const newRange = document.createRange();
          newRange.selectNode(imageElement);
          selection.removeAllRanges();
          selection.addRange(newRange);
          savedRangeRef.current = newRange;

          let percentage;
          const isProcessed = imageElement.dataset.editorProcessed === 'true';

          if (!isProcessed) {
              imageElement.style.maxWidth = `${BASE_IMAGE_WIDTH}px`;
              imageElement.style.height = 'auto';
              imageElement.removeAttribute('width');
              imageElement.removeAttribute('height');
              imageElement.dataset.editorProcessed = 'true';
              percentage = 100;
              
              if (editorRef === frontRef) {
                  syncFrontContent(editorRef.current.innerHTML);
              } else {
                  syncBackContent(editorRef.current.innerHTML);
              }
          } else {
              const currentWidth = parseInt(imageElement.style.maxWidth, 10) || BASE_IMAGE_WIDTH;
              percentage = Math.round((currentWidth / BASE_IMAGE_WIDTH) * 100);
          }
          
          setSelectionContext({
              type: 'image',
              element: imageElement,
              size: percentage,
              editorRef: editorRef
          });
          return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
          if (e.target !== selectionContext?.element) {
              setSelectionContext(null);
          }
          return;
      }
      
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      
      if (!editorRef.current.contains(container)) {
          setSelectionContext(null);
          return;
      }

      savedRangeRef.current = range.cloneRange();
      if (selection.isCollapsed) {
          setSelectionContext(null);
          return;
      }
      let size = 16;
      
      let styleNode = container.nodeType === 1 ? container : container.parentElement;
      let parentWithSize = styleNode.closest('[style*="font-size"]');

      if (parentWithSize) {
          const sizeMatch = parentWithSize.style.fontSize.match(/(\d+)px/);
          if (sizeMatch && sizeMatch[1]) {
              size = parseInt(sizeMatch[1], 10);
          }
      }
      
      setSelectionContext({
          type: 'text',
          size: size,
          editorRef: editorRef,
      });
  };

  const resizeContent = (delta) => {
      if (!selectionContext || !savedRangeRef.current) return;

      const { type, editorRef } = selectionContext;
      const targetRef = editorRef;

      targetRef.current.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);

      if (type === 'image') {
          const imageElement = selectionContext.element;
          if (!imageElement || imageElement.nodeName !== 'IMG') return;

          const currentPercentage = selectionContext.size;
          const step = 10;
          let targetPercentage = currentPercentage + (delta * step);

          const finalPercentage = Math.max(10, Math.min(200, targetPercentage));
          const newWidth = (finalPercentage / 100) * BASE_IMAGE_WIDTH;

          imageElement.style.maxWidth = `${newWidth}px`;
          imageElement.style.height = 'auto';
          
          setSelectionContext(prev => ({ ...prev, size: finalPercentage }));

          const newRange = document.createRange();
          newRange.selectNode(imageElement);
          selection.removeAllRanges();
          selection.addRange(newRange);
          savedRangeRef.current = newRange;
      } 
      else if (type === 'text') {
          const range = savedRangeRef.current;
          const fragment = range.cloneContents();
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(fragment);
          const selectedHtml = tempDiv.innerHTML;

          const currentPxSize = selectionContext.size;
          const TEXT_SIZE_MIN = 12;
          const TEXT_SIZE_MAX = 36;
          const TEXT_SIZE_STEP = 2;
          
          const newPxSize = Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, currentPxSize + delta * TEXT_SIZE_STEP));

          const cleanedHtml = selectedHtml.replace(/<span\s+style="font-size:[^"]*;">(.*?)<\/span>/gi, '$1');
          const finalHtml = `<span style="font-size: ${newPxSize}px;">${cleanedHtml}</span>`;

          document.execCommand('insertHTML', false, finalHtml);
          
          const parent = range.commonAncestorContainer;
          const newSpan = Array.from(parent.querySelectorAll(`span[style*="font-size: ${newPxSize}px"]`)).pop();
          
          if(newSpan){
              const newRange = document.createRange();
              newRange.selectNodeContents(newSpan);
              selection.removeAllRanges();
              selection.addRange(newRange);
              savedRangeRef.current = newRange;
          }

          setSelectionContext(prev => ({ ...prev, size: newPxSize }));
      }

      setTimeout(() => {
          if (targetRef === frontRef) syncFrontContent(targetRef.current.innerHTML);
          if (targetRef === backRef) syncBackContent(targetRef.current.innerHTML);
      }, 10);
  };


  const insertCloze = (targetRef) => {
    if (cardType !== "Cloze" || targetRef !== frontRef || !targetRef.current) return;

    restoreSavedSelection(targetRef);
    const selection = window.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : document.createRange();
  
    const selectedText = selection.toString().trim();
    const placeholderText = selectedText || 'text';
    const isPlaceholder = !selectedText;
  
    if (selectedText) {
      range.deleteContents();
    }
  
    const currentClozeNum = getHighestClozeNumber(frontRef.current.innerHTML) + 1;
  
    const span = document.createElement('span');
    span.style.color = clozeColor;
    span.textContent = `{{c${currentClozeNum}::${placeholderText}}}`;
  
    range.insertNode(span);
  
    if (isPlaceholder) {
      // If we inserted a placeholder, we need to select the word "text"
      const textNode = span.firstChild;
      const startIndex = span.textContent.indexOf(placeholderText);
      const endIndex = startIndex + placeholderText.length;
      
      const selectRange = document.createRange();
      selectRange.setStart(textNode, startIndex);
      selectRange.setEnd(textNode, endIndex);
      
      selection.removeAllRanges();
      selection.addRange(selectRange);
    } else {
      // Otherwise, just move the cursor after the inserted cloze
      range.setStartAfter(span);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  
    setTimeout(() => {
      syncFrontContent(frontRef.current.innerHTML);
    }, 10);
  };

  const insertHyperlink = (ref) => {
    setLinkUrl('');
    setLinkHeading('');
    setLinkTargetRef(ref);
    setShowLinkModal(true);
  };

  const handleLinkInsertion = (url, heading) => {
    if (!linkTargetRef || !linkTargetRef.current || !url || !heading) return;

    restoreSavedSelection(linkTargetRef);

    const cleanUrl = url.trim().replace(/^https?:\/\//i, '');
    const linkHtml = `<a href="https://${cleanUrl}" style="color: ${ANKI_LINK_COLOR};">(${heading})</a>`;

    document.execCommand('insertHTML', false, linkHtml);
    document.execCommand('insertHTML', false, '&nbsp;');
    document.execCommand('foreColor', false, CLEAR_COLOR);

    setTimeout(() => {
        if (linkTargetRef === frontRef) {
            syncFrontContent(linkTargetRef.current.innerHTML);
        } else if (linkTargetRef === backRef) {
            syncBackContent(linkTargetRef.current.innerHTML);
        }
    }, 10);

    setShowLinkModal(false);
    setLinkTargetRef(null);
  };

  const moveFrontContentToExtra = (sourceImage = null) => {
    if (!frontRef.current) return;
    const content = document.createElement('div');
    content.innerHTML = frontRef.current.innerHTML;
    if (sourceImage) {
      const image = [...content.querySelectorAll('img')].find(node => node.src === sourceImage || node.getAttribute('src') === sourceImage);
      image?.remove();
    }
    const remaining = content.innerHTML.trim();
    if (remaining) {
      const currentExtra = backRef.current?.innerHTML.trim() || '';
      const nextExtra = currentExtra ? `${currentExtra}<br>${remaining}` : remaining;
      if (backRef.current) backRef.current.innerHTML = nextExtra;
      syncBackContent(nextExtra, true);
    }
    frontRef.current.innerHTML = '';
    syncFrontContent('', true);
  };

  const setCaretForDrop = (targetRef, dropEvent) => {
    if (!targetRef.current) return;
    targetRef.current.focus();
    let range = document.caretRangeFromPoint?.(dropEvent.clientX, dropEvent.clientY);
    if (!range && document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(dropEvent.clientX, dropEvent.clientY);
      if (position) { range = document.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); }
    }
    if (range && targetRef.current.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); savedRangeRef.current = range.cloneRange();
    } else restoreSavedSelection(targetRef);
  };

  const insertStudySnippet = (snippet, target = 'front', dropEvent = null) => {
    const targetRef = target === 'back' ? backRef : frontRef;
    const hasOcclusion = Array.isArray(snippet.masks) && snippet.masks.length > 0;
    if (target === 'front' && (hasOcclusion || cardType === 'Image Occlusion')) {
      if (cardType !== 'Image Occlusion') previousCardTypeRef.current = cardType;
      if (cardType !== 'Image Occlusion') moveFrontContentToExtra();
      setCardType('Image Occlusion');
      setOcclusionImage(snippet.image);
      setOcclusionMasks(snippet.masks || []);
      setOcclusionMode(snippet.mode || 'hide-all');
      // The capture markup editor (or the inline image area below) is the mask
      // workspace; do not send the user through a second, redundant modal.
      setOcclusionEditorOpen(false);
      setMobileView('editor');
      setFormMessage('Occlusion source ready. Adjust the masks, then save the card.');
      return;
    }

    if (!targetRef.current) return;
    if (dropEvent) setCaretForDrop(targetRef, dropEvent);
    else {
      targetRef.current.focus();
      const saved = savedRangeRef.current;
      if (!saved || !targetRef.current.contains(saved.commonAncestorContainer)) {
        const range = document.createRange(); range.selectNodeContents(targetRef.current); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); savedRangeRef.current = range.cloneRange();
      } else restoreSavedSelection(targetRef);
    }
    const html = `<img src="${snippet.image}" alt="PDF capture" style="max-width: min(100%, 480px); height:auto; border-radius:6px;">&nbsp;`;
    document.execCommand('insertHTML', false, html);
    if (targetRef === frontRef) syncFrontContent(targetRef.current.innerHTML);
    else syncBackContent(targetRef.current.innerHTML);
    setActiveEditor(target === 'back' ? 'back' : 'front');
    setMobileView('editor');
    setFormMessage('');
  };

  const handleSnippetDrop = (event, target) => {
    const payload = event.dataTransfer.getData('application/x-anki-study-snippet');
    if (payload) {
      event.preventDefault();
      try { insertStudySnippet(JSON.parse(payload), target, event); }
      catch { setFormMessage('This capture could not be inserted. Try capturing the region again.'); }
      return;
    }
    const imageFile = [...(event.dataTransfer.files || [])].find(file => file.type.startsWith('image/'));
    const droppedHtml = event.dataTransfer.getData('text/html');
    const droppedImage = droppedHtml ? new DOMParser().parseFromString(droppedHtml, 'text/html').querySelector('img') : null;
    const imageUrl = droppedImage?.getAttribute('src') || event.dataTransfer.getData('text/uri-list').split('\n').find(line => /^https?:\/\//i.test(line.trim()))?.trim();
    if (!imageFile && !imageUrl) return;
    event.preventDefault();
    const dropPoint = { clientX: event.clientX, clientY: event.clientY };
    const placeImage = src => {
      if (target === 'front' && cardType === 'Image Occlusion') {
        setOcclusionImage(src); setOcclusionMasks([]); setManualMaskPreview(null); setOcclusionEditorOpen(true);
        setFormMessage('Image ready to occlude. Draw or adjust hide regions, then save the card.');
        return;
      }
      const targetRef = target === 'back' ? backRef : frontRef;
      if (!targetRef.current) return;
      setCaretForDrop(targetRef, dropPoint);
      const safeSrc = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      document.execCommand('insertHTML', false, `<img src="${safeSrc}" alt="Dropped image" style="display:inline-block;max-width:min(100%,480px);height:auto;vertical-align:middle;">&nbsp;`);
      if (targetRef === frontRef) syncFrontContent(targetRef.current.innerHTML);
      else syncBackContent(targetRef.current.innerHTML);
    };
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = () => placeImage(reader.result);
      reader.onerror = () => setFormMessage('That image could not be read. Try a different image.');
      reader.readAsDataURL(imageFile);
    } else if (imageUrl && (/^data:image\//i.test(imageUrl) || /^https?:\/\//i.test(imageUrl))) placeImage(imageUrl);
  };

  const handleCardTypeChange = (nextType) => {
    if (nextType === 'Image Occlusion') {
      if (cardType !== 'Image Occlusion') {
        previousCardTypeRef.current = cardType;
        const frontContent = document.createElement('div');
        frontContent.innerHTML = frontRef.current?.innerHTML || front || '';
        const source = frontContent.querySelector('img');
        if (source) {
          const imageData = source.src;
          setOcclusionImage(imageData);
          setOcclusionMasks([]);
          setOcclusionEditorOpen(true);
        }
        moveFrontContentToExtra(source?.src || null);
      }
    } else if (cardType === 'Image Occlusion') {
      previousCardTypeRef.current = nextType;
      setOcclusionImage(null); setOcclusionMasks([]);
    }
    setCardType(nextType);
  };

  const openPdfWorkspace = () => {
    setPdfOpen(true); setShowLibrary(false); setMobileView('pdf');
  };

  const manualMaskPoint = (event) => {
    const rect = (event.currentTarget.querySelector('img') || event.currentTarget).getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const finishManualMask = (event) => {
    const start = manualMaskStartRef.current;
    if (!start) return;
    const end = manualMaskPoint(event); manualMaskStartRef.current = null; setManualMaskPreview(null);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
    if (width < .01 || height < .01) return;
    setOcclusionMasks(prev => [...prev, { id: crypto.randomUUID(), shape: 'rect', x, y, width, height, points: [], label: '', group: null }]);
  };
  const beginImageResize = (event, direction) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    imageResizeStartRef.current = { x: event.clientX, y: event.clientY, width: occlusionImageWidth, direction };
  };
  const moveImageResize = (event) => {
    const start = imageResizeStartRef.current; if (!start) return;
    const image = event.currentTarget.closest('.io-editor-resize-frame')?.querySelector('img');
    const ratio = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const horizontal = start.direction.includes('e') ? dx : start.direction.includes('w') ? -dx : 0;
    const vertical = start.direction.includes('s') ? dy * ratio : start.direction.includes('n') ? -dy * ratio : 0;
    const delta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
    setOcclusionImageWidth(Math.round(Math.max(180, Math.min(1800, start.width + delta))));
  };
  const endImageResize = () => { imageResizeStartRef.current = null; };

  const handleColorChange = (color) => {
    if (colorPickerTarget === 'cloze') {
        setClozeColor(color);
    } else if (colorPickerTarget && colorPickerTarget.startsWith('basic-')) {
        const index = parseInt(colorPickerTarget.split('-')[1]);
        setBasicColorPresets(prev => {
            const newPresets = [...prev];
            newPresets[index] = color;
            return newPresets;
        });
    }
    setCustomHex(color);
    setShowColorPicker(false);
    setColorPickerTarget(null);
  };

  const handleCustomHexSubmit = () => {
    const hex = customHex.toUpperCase().trim();
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
      handleColorChange(hex);
    } else {
      alert('Error: Invalid Hex code. Must be #RRGGBB format.');
    }
  };


  const handleSelectTagInModal = (tag) => {
      const newTags = currentTags.includes(tag)
          ? currentTags.filter(t => t !== tag)
          : [...currentTags, tag];

      setCurrentTags(newTags);
      setAllAvailableTags(prev => new Set([...prev, tag]));
  };

  const tagsHierarchyForSelector = useMemo(() => buildTagHierarchy(allAvailableTags, tagSelectorSearch), [allAvailableTags, tagSelectorSearch]);
  const visibleCards = useMemo(() => {
    const query = cardSearch.trim().toLowerCase();
    return cards.map((card, index) => ({ card, index })).filter(({ card }) => !query || `${card.type} ${getCardPreview(card.question)} ${getCardPreview(card.answer)} ${(card.masks || []).map(mask => mask.label).join(' ')} ${(card.tags || []).join(' ')}`.toLowerCase().includes(query));
  }, [cards, cardSearch]);
  const browserCards = useMemo(() => {
    const query = browserSearch.trim().toLowerCase();
    return cards.map((card, index) => ({ card, index })).filter(({ card }) => !query || `${card.type} ${getCardPreview(card.question)} ${getCardPreview(card.answer)} ${(card.masks || []).map(mask => mask.label).join(' ')} ${(card.tags || []).join(' ')}`.toLowerCase().includes(query));
  }, [cards, browserSearch]);
  const browserSelection = browserCards.find(({ index }) => index === browserSelectedIndex) || browserCards[0] || null;

  const toolbarTargetRef = activeEditor === 'back' ? backRef : frontRef;

  const openImagePicker = (targetRef = toolbarTargetRef) => {
    uploadTargetRef.current = targetRef;
    fileInputRef.current?.click();
  };

  const closePdfWorkspace = () => {
    setPdfOpen(false);
    setShowLibrary(false);
    setMobileView('editor');
  };


  return (
    <div className="app-shell">
      <style>{listStyles}</style>

      {isCtrlPressed && cardType === "Cloze" && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2
                          bg-sky-700 text-white px-4 py-2 rounded-lg shadow-lg z-50 font-semibold text-sm animate-pulse">
            🎯 Cloze Mode Active (c{activeClozeId || clozeNumber}) - Select text to create deletion
          </div>
      )}

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Layers3 size={21} strokeWidth={2.2} /></div>
          <div><p className="brand-kicker">STUDY WORKSPACE</p><h1>Anki Studio</h1></div>
        </div>
        <div className="header-status"><span className={`save-dot ${saveStatus === 'Storage full' ? 'save-error' : ''}`} /><span>{saveStatus === 'Saved' ? 'All changes saved' : saveStatus}</span><span className="status-divider" /><span>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span></div>
        <div className="header-actions">
          <button onClick={() => setShowDocumentationModal(true)} title="Help and keyboard shortcuts" className="icon-button"><HelpCircle size={18} /><span>Help</span></button>
          {pdfOpen && <button onClick={() => { const opening = !(showLibrary && mobileView === 'cards'); setShowLibrary(opening); setMobileView(opening ? 'cards' : 'pdf'); }} aria-pressed={showLibrary && mobileView === 'cards'} title={showLibrary && mobileView === 'cards' ? 'Return to PDF' : 'Open card library'} className={`icon-button library-toggle ${showLibrary && mobileView === 'cards' ? 'active' : ''}`}><BookOpen size={17} /><span>Cards {cards.length}</span></button>}
          <button onClick={() => pdfOpen ? closePdfWorkspace() : openPdfWorkspace()} className="quiet-button"><FileText size={16} /><span>{pdfOpen ? 'Close PDF' : 'Open PDF'}</span></button>
          <button onClick={startNewDeck} className="quiet-button"><PlusCircle size={16} /><span>New deck</span></button>
        </div>
      </header>

      <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
        <button role="tab" data-workspace-tab="editor" aria-selected={mobileView === 'editor'} onClick={() => setMobileView('editor')}><Edit size={16} /> Write card</button>
        {pdfOpen ? <button role="tab" aria-selected={mobileView === 'pdf'} onClick={() => setMobileView('pdf')}><FileText size={16} /> PDF</button> : <button role="tab" aria-selected={mobileView === 'cards'} onClick={() => setMobileView('cards')}><BookOpen size={16} /> Cards <span className="tab-count">{cards.length}</span></button>}
      </div>

      {exportMessage && <div className={`app-notice ${exportMessage.startsWith('Deck exported') ? 'notice-success' : 'notice-error'}`} role="status"><span>{exportMessage}</span><button onClick={() => setExportMessage('')} aria-label="Dismiss message"><XCircle size={16} /></button></div>}

      <main className={`workspace-grid ${pdfOpen ? `pdf-workspace ${mobileView === 'editor' ? 'pdf-editor-view' : 'pdf-pdf-view'}` : ''}`}>

        <div className={`editor-panel ${mobileView !== 'editor' ? 'mobile-hidden' : ''}`}>

            <div className="deck-settings">
                <div className="flex-1">
                    <label className="field-label" htmlFor="deck-name">Deck name</label>
                    <input
                        id="deck-name"
                        type="text"
                        placeholder="Enter deck name (e.g., Biology Basics)"
                        value={deckName}
                        onChange={(e) => setDeckName(e.target.value)}
                        className="app-input deck-name-input"
                    />
                </div>
                <div className="card-type-control">
                    <label className="field-label" htmlFor="card-type">Card type</label>
                    <select
                        id="card-type"
                        value={cardType}
                        onChange={(e) => handleCardTypeChange(e.target.value)}
                        className="app-input"
                    >
                        {CARD_TYPES.map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </div>
            </div>

            {formMessage && <div className="form-message" role="alert">{formMessage}</div>}

            {cardType !== 'Image Occlusion' && <div className="editor-toolbar" role="toolbar" aria-label="Card formatting" onPointerDown={(e) => e.preventDefault()}>
              <div className="flex w-max min-w-full flex-nowrap items-center gap-1">
              {cardType === 'Basic' ? basicColorPresets.map((color, index) => (
                <button key={`toolbar-color-${index}`} onClick={() => applyFormat('foreColor', toolbarTargetRef, color)} onContextMenu={(e) => { e.preventDefault(); setColorPickerTarget(`basic-${index}`); setCustomHex(color); setShowColorPicker(true); }} title={`Apply color ${color}; right-click to edit`} className="h-5 w-5 rounded-full border border-neutral-500 hover:ring-2 hover:ring-white" style={{ backgroundColor: color }} />
              )) : <button onClick={() => { setColorPickerTarget('cloze'); setShowColorPicker(true); }} title="Change cloze color" className="h-6 w-6 rounded-full border border-neutral-500" style={{ backgroundColor: clozeColor }} />}
              {cardType === 'Basic' && <button onClick={() => applyFormat('removeFormat', toolbarTargetRef)} title="Clear formatting" className="toolbar-button"><Ban size={16} /></button>}
              <span aria-hidden="true" className="mx-1 h-5 border-l border-neutral-700" />
              <button onClick={() => applyFormat('bold', toolbarTargetRef)} title="Bold" className="toolbar-button font-bold">B</button>
              <button onClick={() => applyFormat('italic', toolbarTargetRef)} title="Italic" className="toolbar-button italic">I</button>
              <button onClick={() => applyFormat('underline', toolbarTargetRef)} title="Underline" className="toolbar-button underline">U</button>
              <button onClick={() => applyFormat('insertUnorderedList', toolbarTargetRef)} title="Bullet list" className="toolbar-button">☷</button>
              <button onClick={() => applyFormat('justifyCenter', toolbarTargetRef)} title="Center align" className="toolbar-button"><AlignCenter size={16} /></button>
              <button onClick={() => resizeContent(-1)} title="Decrease selected text or image size" disabled={!selectionContext || selectionContext.editorRef !== toolbarTargetRef} className="toolbar-button"><ArrowDown size={16} /></button>
              <span className="w-10 text-center font-mono text-[11px] text-neutral-400" aria-live="polite">{selectionContext?.editorRef === toolbarTargetRef ? (selectionContext.type === 'image' ? `${selectionContext.size}%` : `${selectionContext.size}px`) : '--'}</span>
              <button onClick={() => resizeContent(1)} title="Increase selected text or image size" disabled={!selectionContext || selectionContext.editorRef !== toolbarTargetRef} className="toolbar-button"><ArrowUp size={16} /></button>
              <button onClick={() => openImagePicker()} title="Insert image" className="toolbar-button"><Upload size={16} /></button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, uploadTargetRef.current || toolbarTargetRef)} />
              {activeEditor === 'back' && <button onClick={() => insertHyperlink(toolbarTargetRef)} title="Insert hyperlink" className="toolbar-button"><Link size={16} /></button>}
              {cardType === 'Cloze' && activeEditor === 'front' && <button onClick={() => insertCloze(toolbarTargetRef)} title={`Insert cloze c${clozeNumber}`} className="toolbar-button font-mono text-xs">{'{ }'}</button>}
              </div>
            </div>}

            {cardType === 'Image Occlusion' && <section className="io-source-card" data-editor-drop-target="front" tabIndex={0} aria-label="Image occlusion source image. Focus here and paste an image, or choose one." onPaste={pasteImageIntoOcclusion} onDragOver={e => e.preventDefault()} onDrop={e => handleSnippetDrop(e, 'front')}>
              <div className="io-source-heading"><div><span className="section-eyebrow">IMAGE OCCLUSION</span><h3>Choose an image, then add masks</h3></div><div className="io-source-actions">{occlusionImage && <><div className="io-region-count"><strong>{occlusionMasks.length}</strong><span>regions</span></div><button className="quiet-button" type="button" onClick={() => setOcclusionEditorOpen(true)}>Open editor</button></>}<button className="quiet-button" type="button" onClick={() => openImagePicker(frontRef)}><Upload size={16} /> Choose image</button></div></div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, frontRef)} />
              {!occlusionImage ? <div className="io-image-empty"><Crop size={22}/><span>Paste an image here, drop an occluded capture, or choose a file</span></div> : <div className="io-image-preview"><div className="io-mask-draw-area" onPointerDown={e => { if (e.target.closest('.manual-mask-remove')) return; e.currentTarget.setPointerCapture(e.pointerId); manualMaskStartRef.current = manualMaskPoint(e); setManualMaskPreview({ x: manualMaskStartRef.current.x, y: manualMaskStartRef.current.y, width: 0, height: 0 }); }} onPointerMove={e => { if (!manualMaskStartRef.current) return; const p = manualMaskPoint(e), s = manualMaskStartRef.current; setManualMaskPreview({ x: Math.min(s.x,p.x), y: Math.min(s.y,p.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }); }} onPointerUp={finishManualMask} onPointerCancel={finishManualMask}><img src={occlusionImage} alt="Image occlusion source" draggable="false"/>{occlusionMasks.map((mask,index) => <button type="button" className="manual-mask-remove" key={mask.id} title={`Remove region ${index+1}`} onPointerDown={e => e.stopPropagation()} onClick={() => setOcclusionMasks(prev => prev.filter(m => m.id !== mask.id))} style={{left:`${mask.x*100}%`,top:`${mask.y*100}%`,width:`${mask.width*100}%`,height:`${mask.height*100}%`,borderRadius:mask.shape === 'ellipse' ? '50%' : 0,clipPath:mask.shape === 'polygon' && mask.points?.length >= 3 ? `polygon(${mask.points.map(point => `${((point.x-mask.x)/Math.max(mask.width,.0001))*100}% ${((point.y-mask.y)/Math.max(mask.height,.0001))*100}%`).join(',')})` : undefined}}>{index+1} ×</button>)}{manualMaskPreview && <span className="manual-mask-draft" style={{left:`${manualMaskPreview.x*100}%`,top:`${manualMaskPreview.y*100}%`,width:`${manualMaskPreview.width*100}%`,height:`${manualMaskPreview.height*100}%`}}/>}</div><div><strong>{occlusionMasks.length} hidden region{occlusionMasks.length === 1 ? '' : 's'}</strong><span>Drag over image to add a mask; tap a mask to remove it.</span></div></div>}
              <p className="io-helper">Draw masks on a PDF capture, then drag it here. The source image and mask geometry stay attached to this card.</p>
              <label className="io-mode-select">Review mode <select value={occlusionMode} onChange={e => setOcclusionMode(e.target.value)}><option value="hide-all">Hide All, Guess One</option><option value="hide-one">Hide One, Guess One</option></select></label>
            </section>}

            {cardType === 'Image Occlusion' && occlusionImage && occlusionEditorOpen && createPortal(<div className="io-editor-backdrop" role="dialog" aria-modal="true" aria-label="Image occlusion editor" onPointerDown={e => { if (e.target === e.currentTarget) setOcclusionEditorOpen(false); }}><section className="io-editor-dialog"><header className="io-editor-header"><div><span className="section-eyebrow">IMAGE OCCLUSION</span><h2>Arrange masks</h2></div><div className="io-editor-actions"><label>Image size <input aria-label="Image width" type="range" min="180" max="1800" step="10" value={occlusionImageWidth} onChange={e => setOcclusionImageWidth(Number(e.target.value))}/><span>{occlusionImageWidth}px</span></label><button type="button" className="quiet-button" onClick={() => setOcclusionEditorOpen(false)}>Done</button></div></header><div className="io-editor-stage"><div className="io-editor-resize-frame" style={{width:`min(${occlusionImageWidth}px, calc(100vw - 64px))`}}><div className="io-mask-draw-area io-editor-mask-area" onPointerDown={e => { if (e.target.closest('.manual-mask-remove,.io-resize-handle')) return; e.currentTarget.setPointerCapture(e.pointerId); manualMaskStartRef.current = manualMaskPoint(e); setManualMaskPreview({ x: manualMaskStartRef.current.x, y: manualMaskStartRef.current.y, width: 0, height: 0 }); }} onPointerMove={e => { if (!manualMaskStartRef.current) return; const p = manualMaskPoint(e), s = manualMaskStartRef.current; setManualMaskPreview({ x: Math.min(s.x,p.x), y: Math.min(s.y,p.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }); }} onPointerUp={finishManualMask} onPointerCancel={finishManualMask}><img src={occlusionImage} alt="Image occlusion source" draggable="false"/>{occlusionMasks.map((mask,index) => <button type="button" className="manual-mask-remove" key={mask.id} title={`Remove region ${index+1}`} onPointerDown={e => e.stopPropagation()} onClick={() => setOcclusionMasks(prev => prev.filter(m => m.id !== mask.id))} style={{left:`${mask.x*100}%`,top:`${mask.y*100}%`,width:`${mask.width*100}%`,height:`${mask.height*100}%`,borderRadius:mask.shape === 'ellipse' ? '50%' : 0}}>{index+1} ×</button>)}{manualMaskPreview && <span className="manual-mask-draft" style={{left:`${manualMaskPreview.x*100}%`,top:`${manualMaskPreview.y*100}%`,width:`${manualMaskPreview.width*100}%`,height:`${manualMaskPreview.height*100}%`}}/>}</div>{['n','ne','e','se','s','sw','w','nw'].map(direction => <button type="button" key={direction} aria-label={`Resize image ${direction}`} className={`io-resize-handle ${direction}`} onPointerDown={e => beginImageResize(e,direction)} onPointerMove={moveImageResize} onPointerUp={endImageResize} onPointerCancel={endImageResize}/>)}</div></div><footer className="io-editor-footer"><span>{occlusionMasks.length} hidden region{occlusionMasks.length === 1 ? '' : 's'} · Drag to add a mask, select a mask to remove it. Resize handles keep the image proportions.</span><button type="button" className="primary-button" onClick={() => setOcclusionEditorOpen(false)}>Done</button></footer></section></div>, document.body)}

            {cardType !== 'Image Occlusion' && <section className="space-y-2 mb-4">
              <h3 className="text-sm font-medium block mb-1">
                {cardType === "Cloze" ? "Text (Ctrl+select for cloze)" : "Front"}
              </h3>
              <div
                ref={frontRef}
                data-editor-drop-target="front"
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleSnippetDrop(e, 'front')}
                contentEditable="true"
                role="textbox"
                aria-label={cardType === 'Cloze' ? 'Cloze text' : 'Card front'}
                aria-multiline="true"
                data-placeholder={cardType === 'Cloze' ? 'Write a prompt, then select key text while holding Ctrl or Command to hide it.' : 'Write a clear question or prompt...'}
                onFocus={() => setActiveEditor('front')}
                onInput={() => scheduleEditorSave('front')}
                onBlur={(e) => commitEditorSave('front', e.target.innerHTML)}
                onPaste={(e) => handleContentPaste(e, frontRef)}
                onClick={handleSelectionChange}
                onMouseUp={(e) => { handleMouseUpForCloze(e, frontRef); handleSelectionChange(e); }}
                onKeyUp={handleSelectionChange}
                className={`${baseInputStyle} min-h-[110px] p-3 editable-content inline-block min-w-full align-top focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20`}
                style={{whiteSpace: 'pre-wrap'}}
                {...(!contentInitialized && { dangerouslySetInnerHTML: { __html: front } })}
              />
            </section>}

            <section className="space-y-2 mb-4">
              <h3 className="text-sm font-medium block mb-1">{cardType === "Cloze" || cardType === 'Image Occlusion' ? "Extra (Optional)" : "Back"}</h3>
              <div
                ref={backRef}
                data-editor-drop-target="back"
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleSnippetDrop(e, 'back')}
                contentEditable="true"
                role="textbox"
                aria-label={cardType === 'Cloze' || cardType === 'Image Occlusion' ? 'Extra information' : 'Card back'}
                aria-multiline="true"
                data-placeholder={cardType === 'Cloze' || cardType === 'Image Occlusion' ? 'Add a hint, explanation, or source (optional)...' : 'Add the answer, explanation, or supporting detail...'}
                onFocus={() => setActiveEditor('back')}
                onInput={() => scheduleEditorSave('back')}
                onBlur={(e) => commitEditorSave('back', e.target.innerHTML)}
                onPaste={(e) => handleContentPaste(e, backRef)}
                onClick={handleSelectionChange}
                onMouseUp={handleSelectionChange}
                onKeyUp={handleSelectionChange}
                className={`${baseInputStyle} min-h-[110px] p-3 editable-content inline-block min-w-full align-top focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20`}
                style={{whiteSpace: 'pre-wrap'}}
                {...(!contentInitialized && { dangerouslySetInnerHTML: { __html: back } })}
              />
            </section>

            <section className="space-y-2 mb-6 relative">
                <label className="text-sm font-medium flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Tag size={16} />Tags
                  </span>
                  <button
                    onClick={() => { setBrowserSearch(''); setBrowserSelectedIndex(cards[0] ? 0 : null); setShowCardBrowser(true); }}
                    className="tag-browse-button text-xs flex items-center gap-1"
                  >
                    <BookOpen size={14} /> Browse cards
                  </button>
                </label>

                <div className="flex flex-wrap gap-2 border border-neutral-700 rounded-lg p-2 bg-neutral-800 min-h-[42px]">
                    {currentTags.length === 0 && (
                      <span className="text-neutral-500 text-xs">No tags added yet.</span>
                    )}
                    {currentTags.map((t, i) => (
                        <span key={i} className="flex items-center gap-1 px-2 py-1 bg-sky-700 text-sky-100 rounded-full text-xs font-semibold">
                            {formatTagForDisplay(t)}
                            <button onClick={() => removeTag(t)} className="ml-1 font-bold hover:text-sky-300" title="Remove from current card">×</button>
                        </span>
                    ))}
                </div>

                <div className="relative">
                  <input
                      ref={tagInputRef}
                      value={tagInput}
                      onChange={handleTagInputChange}
                      onKeyDown={handleTagKeyDown}
                      placeholder="Add tag (e.g., Biology, QBank::Incorrect)"
                      className={inputStyle}
                  />

                  {showTagSuggestions && filteredSuggestions.length > 0 && (
                    <div ref={tagSuggestionsRef} className="tag-suggestions w-full mt-1">
                      {filteredSuggestions.map((tag, index) => (
                        <div
                          key={tag}
                          onClick={() => addTag(tag)}
                          className={`tag-suggestion-item ${index === tagSuggestionIndex ? 'selected' : ''}`}
                        >
                          {formatTagForDisplay(tag)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            </section>
            
            <div className="editor-actions">
                <div className="action-hint"><span className="keyboard-key">⌘/Ctrl</span> + <span className="keyboard-key">Enter</span> to add</div>
                <div className="action-buttons">
                    <button
                        onClick={addCard}
                        className="primary-button"
                    >
                        {editingIndex !== null ? <Check size={17} /> : <PlusCircle size={17} />} {editingIndex !== null ? 'Save changes' : 'Add card'}
                    </button>
                    {editingIndex !== null && (
                         <button
                            onClick={() => { setEditingIndex(null); setFront(""); setBack(""); setCurrentTags([]); if(frontRef.current) frontRef.current.innerHTML = ""; if(backRef.current) backRef.current.innerHTML = ""; }}
                            className="secondary-button"
                        >
                            Cancel Edit
                        </button>
                    )}
                    <button
                        onClick={exportDeck}
                        className="export-button"
                        disabled={isExporting || cards.length === 0}
                    >
                        {isExporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />} {isExporting ? 'Building…' : 'Export .apkg'}
                    </button>
                    <button
                        onClick={() => { setPreviewOcclusionIndex(0); setPreviewAnswerSide(false); setShowPreview(true); }}
                        className="secondary-button preview-button"
                    >
                        <Eye size={16} /> Preview
                    </button>
                </div>
            </div>

        </div>

        {pdfOpen && <div className={mobileView === 'pdf' ? '' : 'pdf-panel-mobile-hidden'}><PdfPanelErrorBoundary onClose={closePdfWorkspace}><Suspense fallback={<section className="pdf-study-panel pdf-loading-state">Loading PDF tools…</section>}><PdfStudyPanel fieldOptions={cardType === 'Basic' ? [{ target: 'front', label: 'Front' }, { target: 'back', label: 'Back' }] : cardType === 'Cloze' ? [{ target: 'front', label: 'Text' }, { target: 'back', label: 'Extra' }] : [{ target: 'front', label: 'Image' }, { target: 'back', label: 'Extra' }]} onInsertSnippet={insertStudySnippet} isSmallScreen={false} onMobileView={setMobileView} /></Suspense></PdfPanelErrorBoundary></div>}
        <div className={`cards-panel ${mobileView !== 'cards' ? 'mobile-hidden' : ''} ${pdfOpen ? `library-drawer ${showLibrary ? 'library-open' : ''}` : ''}`}>
          <div className="library-heading">
            <div><p className="section-eyebrow">YOUR DECK</p><h2><BookOpen size={19} /> Card library <span className="library-count">{cards.length}</span></h2></div>
            {cards.length > 0 && <span className="library-meta">Newest first</span>}
          </div>
          <label className="card-search-wrap"><Search size={16} /><input ref={cardSearchRef} value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} placeholder="Find a card or tag..." aria-label="Search cards and tags" /><kbd>/</kbd></label>
          <div className="card-list">
            {visibleCards.map(({ card, index }) => (
              <article key={`${card.created}-${index}`} className="card-item">
                <div className="card-item-top">
                  <span className="card-index">{String(cards.length - index).padStart(2, '0')}</span>
                  <span className="card-type-pill">{card.type || "Basic"}</span>
                  <span className="card-created">{card.created}</span>
                </div>
                <button className="card-content-button" onClick={() => loadCardForEdit(index)} aria-label={`Edit card ${cards.length - index}`}>
                  {card.type === 'Image Occlusion' ? <div className="io-library-preview"><img src={card.imageData} alt=""/><span>{(card.masks || []).length} occlusion region{(card.masks || []).length === 1 ? '' : 's'}</span></div> : <div className="card-preview-line"><strong>{card.type === "Cloze" ? "Text" : "Front"}</strong><span>{getCardPreview(card.question) || 'Empty card content'}</span></div>}
                  {card.type !== "Cloze" && card.type !== 'Image Occlusion' && <div className="card-preview-line answer-line"><strong>Back</strong><span>{getCardPreview(card.answer) || 'No answer added'}</span></div>}
                  {card.type === "Cloze" && card.answer && <div className="card-preview-line answer-line"><strong>Extra</strong><span>{getCardPreview(card.answer)}</span></div>}
                  {card.type === 'Image Occlusion' && card.answer && <div className="card-preview-line answer-line"><strong>Extra</strong><span>{getCardPreview(card.answer)}</span></div>}
                </button>
                <div className="card-item-bottom">
                  <div className="card-tags">{(card.tags || []).map((tag, tagIndex) => <span key={tagIndex}>{formatTagForDisplay(tag)}</span>)}</div>
                  <div className="card-tools">
                    <button onClick={() => loadCardForEdit(index)} aria-label="Edit card" title="Edit card"><Edit size={15} /></button>
                    <button onClick={() => deleteCard(index)} aria-label="Delete card" title="Delete card"><Trash2 size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
            {cards.length === 0 && <div className="empty-library"><div className="empty-icon"><Sparkles size={19} /></div><h3>Your deck starts here</h3><p>Add your first card and it will appear here.</p><button onClick={() => setMobileView('editor')}>Create a card <ChevronRight size={15} /></button></div>}
            {cards.length > 0 && visibleCards.length === 0 && <div className="empty-library"><Search size={18} /><p>No cards match "{cardSearch}".</p></div>}
          </div>
        </div>

      </main >

      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-800 rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-neutral-700">
            
            <h2 className="text-lg font-semibold py-3 px-4 border-b border-neutral-700 text-center bg-neutral-900 text-neutral-100">
              Current Card Preview
            </h2>

            <div className="flex-1 overflow-y-auto p-6 text-center">
              <div className="preview-content space-y-6">
                {cardType === 'Image Occlusion' ? <>
                  <div className="io-reviewer-controls">
                    <button type="button" aria-label="Previous occlusion card" disabled={previewOcclusionIndex <= 0} onClick={() => { setPreviewOcclusionIndex(index => Math.max(0, index - 1)); setPreviewAnswerSide(false); }}>‹</button>
                    <span>Card <strong>{Math.min(previewOcclusionIndex + 1, Math.max(1, new Set(occlusionMasks.map((mask, index) => mask.group || mask.id || `mask-${index + 1}`)).size))}</strong> of {new Set(occlusionMasks.map((mask, index) => mask.group || mask.id || `mask-${index + 1}`)).size}</span>
                    <button type="button" aria-label="Next occlusion card" disabled={previewOcclusionIndex >= new Set(occlusionMasks.map((mask, index) => mask.group || mask.id || `mask-${index + 1}`)).size - 1} onClick={() => { setPreviewOcclusionIndex(index => Math.min(Math.max(0, new Set(occlusionMasks.map((mask, i) => mask.group || mask.id || `mask-${i + 1}`)).size - 1), index + 1)); setPreviewAnswerSide(false); }}>›</button>
                    <div className="io-reviewer-flip"><button type="button" aria-pressed={!previewAnswerSide} onClick={() => setPreviewAnswerSide(false)}>Question</button><button type="button" aria-pressed={previewAnswerSide} onClick={() => setPreviewAnswerSide(true)}>Show answer</button></div>
                  </div>
                  <div className="io-reviewer-image">
                    {occlusionImage ? <OcclusionPreview image={occlusionImage} imageWidth={occlusionImageWidth} masks={occlusionMasks} mode={occlusionMode} cardIndex={previewOcclusionIndex} answerSide={previewAnswerSide} /> : <span>Add an image to preview this card.</span>}
                  </div>
                  {previewAnswerSide && back && <div className="io-reviewer-extra"><span>Back extra</span><div dangerouslySetInnerHTML={{ __html: back }} /></div>}
                </> : <>
                  <div>
                    <h3 className="font-medium mb-2 text-neutral-400">{cardType === "Cloze" ? "Text" : "Front"}</h3>
                    <div className="p-4 border border-neutral-700 rounded-lg text-xl bg-neutral-900 text-neutral-200">
                      <div dangerouslySetInnerHTML={{ __html: cleanColorSpans(front) || "(empty)" }} />
                    </div>
                  </div>
                  {cardType === "Basic" && <div><h3 className="font-medium mb-2 text-neutral-400">Back</h3><div className="p-4 border border-neutral-700 rounded-lg text-xl bg-neutral-900 text-neutral-200" dangerouslySetInnerHTML={{ __html: back || "(empty)" }} /></div>}
                  {cardType === "Cloze" && back && <div><h3 className="font-medium mb-2 text-neutral-400">Extra</h3><div className="p-4 border border-neutral-700 rounded-lg text-xl bg-neutral-900 text-neutral-200" dangerouslySetInnerHTML={{ __html: back }} /></div>}
                </>}
                <div className="text-xs text-neutral-400 pt-4">Tags: {currentTags.map(formatTagForDisplay).join(", ") || "None"}</div>
              </div>
            </div>

            <div className="p-4 border-t border-neutral-700 bg-neutral-900">
              <button
                onClick={() => setShowPreview(false)}
                className="w-full px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showColorPicker && colorPickerTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-800 rounded-xl shadow-lg max-w-sm w-full p-6 border border-neutral-700">
            <h2 className="text-xl font-bold mb-4">
                {colorPickerTarget === 'cloze' ? 'Select Cloze Color' : `Set Preset Color ${parseInt(colorPickerTarget.split('-')[1]) + 1}`}
            </h2 >
            <p className="text-sm text-neutral-400 mb-4">
                Current Color:
                <span style={{color: colorPickerTarget === 'cloze' ? clozeColor : basicColorPresets[parseInt(colorPickerTarget.split('-')[1])]}}>
                    {colorPickerTarget === 'cloze' ? clozeColor : basicColorPresets[parseInt(colorPickerTarget.split('-')[1])]}
                </span >
            </p>

            <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Preset Colors</h3 >
                <div className="flex gap-4 flex-wrap">
                    {PRESET_COLORS.map(color => (
                        <button
                            key={color}
                            onClick={() => handleColorChange(color)}
                            className={`w-10 h-10 rounded-full border-2 transition ${
                                (colorPickerTarget === 'cloze' && clozeColor.toUpperCase() === color.toUpperCase()) ||
                                (colorPickerTarget && colorPickerTarget.startsWith('basic-') && basicColorPresets[parseInt(colorPickerTarget.split('-')[1])].toUpperCase() === color.toUpperCase())
                                ? 'border-white' : 'border-transparent hover:border-neutral-500'}`
                            }
                            style={{backgroundColor: color}}
                            title={color}
                        />
                    ))}
                </div >
            </div >

            {colorPickerTarget.startsWith('basic-') && (
                <div className="mb-6">
                    <h3 className="text-lg font-medium mb-2">Choose Slot to Set</h3 >
                    <div className="flex gap-4">
                        {[0, 1, 2].map(index => (
                            <button
                                key={`slot-${index}`}
                                onClick={() => { setColorPickerTarget(`basic-${index}`); setCustomHex(basicColorPresets[index]); }}
                                className={`px-3 py-1 text-sm rounded-lg border-2 transition ${colorPickerTarget === `basic-${index}` ? 'border-sky-500 bg-sky-700' : 'border-neutral-600 hover:bg-neutral-700'}`}
                            >
                                Preset {index + 1}
                            </button>
                        ))}
                    </div >
                </div >
            )}


            <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Custom Hex Code</h3 >
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={customHex}
                        onChange={(e) => setCustomHex(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && handleCustomHexSubmit()}
                        placeholder="#RRGGBB"
                        className={inputStyle + " flex-1"}
                    />
                    <button
                        onClick={handleCustomHexSubmit}
                        className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm hover:bg-sky-700 transition"
                    >
                        Apply
                    </button>
                </div >
            </div >

            <button
              onClick={() => { setShowColorPicker(false); setColorPickerTarget(null); }}
              className="w-full px-4 py-2 bg-neutral-700 text-white rounded-lg hover:bg-neutral-600 transition"
            >
              Close
            </button>
          </div >
        </div >
      )}

      {showCardBrowser && (
        <div className="card-browser-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowCardBrowser(false); }}>
          <section className="card-browser" role="dialog" aria-modal="true" aria-label="Browse cards">
            <header className="card-browser-header"><div><span className="section-eyebrow">BROWSE</span><h2>Cards</h2></div><button className="card-browser-close" onClick={() => setShowCardBrowser(false)} aria-label="Close card browser"><XCircle size={21} /></button></header>
            <div className="card-browser-search"><Search size={17} /><input autoFocus value={browserSearch} onChange={event => { setBrowserSearch(event.target.value); setBrowserSelectedIndex(null); }} placeholder="Search cards…" aria-label="Search cards" /><span>{browserCards.length} cards</span></div>
            <div className="card-browser-body">
              <aside className="card-browser-decks"><span className="card-browser-section-title">DECKS</span><button className="card-browser-deck active"><Layers3 size={16} /><span>{deckName || 'Default Deck'}</span><b>{cards.length}</b></button></aside>
              <div className="card-browser-results" role="listbox" aria-label="Cards">
                <div className="card-browser-columns"><span>Card</span><span>Type</span><span>Tags</span></div>
                {browserCards.map(({ card, index }) => <button key={`${card.created}-${index}`} role="option" aria-selected={browserSelection?.index === index} className="card-browser-row" onClick={() => setBrowserSelectedIndex(index)}><span className="card-browser-row-content"><strong>{getCardPreview(card.question) || 'Image occlusion'}</strong><small>{card.type === 'Image Occlusion' ? `${(card.masks || []).length} hidden regions` : getCardPreview(card.answer) || 'No answer'}</small></span><span className="card-type-pill">{card.type || 'Basic'}</span><span className="card-browser-tags">{(card.tags || []).slice(0, 2).map(formatTagForDisplay).join(', ') || '—'}</span></button>)}
                {!browserCards.length && <div className="card-browser-empty">{cards.length ? 'No cards match this search.' : 'This deck has no cards yet.'}</div>}
              </div>
              <aside className="card-browser-detail">{browserSelection ? <><div className="card-browser-detail-heading"><span className="card-type-pill">{browserSelection.card.type || 'Basic'}</span><span>Card {cards.length - browserSelection.index}</span></div>{browserSelection.card.type === 'Image Occlusion' ? <div className="card-browser-io"><img src={browserSelection.card.imageData} alt="Card image occlusion" /><span>{(browserSelection.card.masks || []).length} hidden regions</span></div> : <><section><span>{browserSelection.card.type === 'Cloze' ? 'TEXT' : 'FRONT'}</span><div dangerouslySetInnerHTML={{ __html: browserSelection.card.question || '(empty)' }} /></section>{browserSelection.card.type !== 'Cloze' && <section><span>BACK</span><div dangerouslySetInnerHTML={{ __html: browserSelection.card.answer || '(empty)' }} /></section>}{browserSelection.card.type === 'Cloze' && browserSelection.card.answer && <section><span>EXTRA</span><div dangerouslySetInnerHTML={{ __html: browserSelection.card.answer }} /></section>}</>}{(browserSelection.card.tags || []).length > 0 && <div className="card-browser-detail-tags">{browserSelection.card.tags.map(tag => <span key={tag}>{formatTagForDisplay(tag)}</span>)}</div>}<button className="primary-button" onClick={() => { loadCardForEdit(browserSelection.index); setShowCardBrowser(false); }}>Edit card</button></> : <div className="card-browser-placeholder"><BookOpen size={25} /><span>Select a card to preview it</span></div>}</aside>
            </div>
          </section>
        </div>
      )}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-800 rounded-xl shadow-lg max-w-sm w-full p-6 border border-neutral-700">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Insert Hyperlink</h2 >
                    <button
                        onClick={() => setShowLinkModal(false)}
                        className="p-1 rounded-full text-neutral-400 hover:text-white"
                    >
                        <XCircle size={24} />
                    </button>
                </div >
                <p className="text-sm text-neutral-400 mb-4">Appears as <span style={{color: ANKI_LINK_COLOR, fontWeight: 'bold'}}>{`(${linkHeading || 'Link Name'})`}</span></p>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-neutral-400 block mb-1">Link Name (Heading)</label>
                        <input
                            type="text"
                            value={linkHeading}
                            onChange={(e) => setLinkHeading(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && linkUrl && handleLinkInsertion(linkUrl, linkHeading)}
                            placeholder="e.g., definition, image"
                            className={inputStyle}
                        />
                    </div >
                    <div>
                        <label className="text-xs text-neutral-400 block mb-1">URL</label>
                        <input
                            type="url"
                            value={linkUrl}
                            onChange={(e) => setLinkUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && linkHeading && handleLinkInsertion(linkUrl, linkHeading)}
                            placeholder="e.g., www.wikipedia.org/cat"
                            className={inputStyle}
                        />
                    </div >
                </div >

                <button
                    onClick={() => handleLinkInsertion(linkUrl, linkHeading)}
                    disabled={!linkUrl.trim() || !linkHeading.trim()}
                    className="mt-6 px-4 py-2 w-full bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:bg-neutral-600 disabled:text-neutral-400 transition"
                >
                    Insert Link
                </button>
            </div >
        </div >
      )}

      <DocumentationModal 
          isVisible={showDocumentationModal} 
          onClose={() => setShowDocumentationModal(false)} 
      />
    </div >
  );
}
