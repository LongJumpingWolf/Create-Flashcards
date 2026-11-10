import React, { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from 'react-dom';
// NEW: Import the modal component
import DocumentationModal from './DocumentationModal';
import ImportCardsModal from './ImportCardsModal';
import PillFields, { PreviewPills } from './PillFields';
import CardBrowser from './CardBrowser';
import { logAdded } from '../activity';
import { readFolders, writeFolders, readSnapshot, writeSnapshot, removeSnapshot, newFolderId } from '../folders';
import { installImageDrop, readDroppedImages } from '../dropImages';
import CardPreviewFrame, { DEVICES as PREVIEW_DEVICES } from './CardPreviewFrame';
import { buildThemePayload, loadSettings, normalizePills } from '../beerus';
import { repairOldChatGptPaste } from '../chatgptFormat';

// Pills of saved cards: content pasted from ChatGPT by an older version is rebuilt in the ChatGPT look (pills set to Plain are left alone).
// Empty pill list (one slot per pill); pinned pills keep their content after a card is added.
const blankPills = (pinned = {}, keep = []) => Array.from({ length: Math.max(4, loadSettings().pills.length) }, (_, i) => (pinned[`pill${i + 1}`] ? (keep[i] ?? '') : ''));
const FORMAT_LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strikeThrough: 'Strikethrough', superscript: 'Superscript', subscript: 'Subscript', foreColor: 'Text colour', hiliteColor: 'Highlight', removeFormat: 'Clear formatting', insertUnorderedList: 'Bulleted list', insertOrderedList: 'Numbered list', indent: 'Indent', outdent: 'Outdent', justifyLeft: 'Align left', justifyCenter: 'Center', justifyRight: 'Align right', justifyFull: 'Justify' };
// A highlight must stay readable: give highlighted text a dark or light colour that contrasts with the highlight
// (unless you picked a text colour yourself); taking the highlight off takes that colour off again.
const fixHighlightContrast = (root) => {
  root.querySelectorAll('[style*="background"], [data-hc]').forEach(node => {
    const bg = node.style.backgroundColor;
    const clear = !bg || bg === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(bg);
    if (clear) {
      if (node.dataset.hc) { node.style.removeProperty('color'); delete node.dataset.hc; if (!node.getAttribute('style')) node.removeAttribute('style'); }
      return;
    }
    if (node.style.color && !node.dataset.hc) return;
    const probe = document.createElement('span'); probe.style.color = bg; document.body.appendChild(probe);
    const [r, g, b] = (getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) || [255, 255, 0]).map(Number); probe.remove();
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    node.style.color = luminance > 0.55 ? '#1B1B1B' : '#FFFFFF';
    node.dataset.hc = '1';
  });
};
const repairPills = (pills) => {
  const formats = loadSettings().pills.map(pill => pill.format);
  return normalizePills(pills).map((html, index) => (formats[index] === 'plain' ? html : repairOldChatGptPaste(html)));
};
import { hasSavedPdf } from '../pdfResumeStorage';
import { getSelectedCells, installTableSelection } from '../tableSelect';
import { installFieldHistory, setActionLabel } from '../fieldHistory';
import { ToolbarMenu, MenuItem, HighlightSwatches, FieldHeader, HtmlView, TableGridPicker, WordColorTool } from './editorTools';
import { smartTyping, smartEnter, listTab, markdownToHtml, looksLikeMarkdown, isPlainHtml, tidyHtml, SMART_DEFAULTS } from './smartTyping';
import { MATH_WRAPPERS, wrapSelection, audioHtml, fileToDataUrl, useAudioRecorder, MAX_AUDIO_BYTES, sanitizePastedHtml, plainTextToHtml, duplicateKey, buildTableHtml, findCell, tableAction, tableTab, placeCaretInCell, clozeNumbers } from './editorHelpers';

let pdfStudyPanelPromise;
const preloadPdfStudyPanel = () => {
  pdfStudyPanelPromise ||= import('./PdfStudyPanel').catch(error => {
    pdfStudyPanelPromise = null;
    throw error;
  });
  return pdfStudyPanelPromise;
};
const PdfStudyPanel = lazy(preloadPdfStudyPanel);

class PdfPanelErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('PDF workspace failed to initialize:', error); }
  render() {
    if (this.state.error) return <section className="pdf-study-panel pdf-load-error"><h2>PDF tools couldn’t start</h2><p>{this.state.error.message || 'A browser PDF component failed to load.'}</p><button onClick={() => this.props.onClose?.()}>Close PDF tools</button><button onClick={() => window.location.reload()}>Reload workspace</button></section>;
    return this.props.children;
  }
}
import { Trash2, FileText, Download, PlusCircle, Tag, Settings, XCircle, Palette, Ban, HelpCircle, Edit, ChevronRight, ChevronDown, Link, Upload, ArrowUp, ArrowDown, AlignCenter, Layers3, Search, Check, LoaderCircle, Eye, BookOpen, Sparkles, Crop, Code, Pin, EyeOff, Mic, StopSquare, Paperclip, Superscript, Subscript, ListOrdered, ListBullets, AlignLeft, AlignRight, AlignJustify, Indent, Outdent, Sigma, Strikethrough, Highlight, Eraser, Table } from './Icons';

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

const makeId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// contentEditable leaves things like "<br>" behind when emptied; treat those as blank.
const isBlankHtml = (html) => !html || (!/<(img|audio|table)\b/i.test(html) && html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/gi, '').length === 0);
const normalizeHtml = (html) => (isBlankHtml(html) ? '' : tidyHtml(html.trim()));
const escapeHtmlAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function OcclusionPreview({ image, masks, imageWidth = 720, mode = 'hide-all', cardIndex = 0, answerSide = false }) {
  const [dimensions, setDimensions] = useState(null);
  const [gone, setGone] = useState([]);
  const oneByOne = mode === 'sequential' || mode === 'random';
  const keyOf = (mask, index) => String(mask.group || mask.id || `mask-${index + 1}`);
  const groups = [...new Set(masks.map((mask, index) => keyOf(mask, index)))];
  // Same behaviour as the exported card: a click reveals a region (the next one in order, or a random one).
  useEffect(() => { setGone([]); }, [mode, masks.length, answerSide, image]);
  const remainingGroups = groups.filter(group => !gone.includes(group));
  const activeGroup = oneByOne ? (mode === 'sequential' ? remainingGroups[0] : null) : (groups[cardIndex] || groups[0]);
  const revealGroup = (group) => setGone(previous => (previous.includes(group) ? previous : [...previous, group]));
  const revealNext = () => {
    if (!remainingGroups.length) return;
    revealGroup(mode === 'random' ? remainingGroups[Math.floor(Math.random() * remainingGroups.length)] : remainingGroups[0]);
  };
  const shownMasks = masks.filter((mask, index) => {
    if (oneByOne) return !answerSide && !gone.includes(keyOf(mask, index));
    const isActive = keyOf(mask, index) === activeGroup;
    return mode === 'hide-one' ? (!answerSide && isActive) : (!answerSide || !isActive);
  });
  return (
    <div className="preview-occlusion-image" onClick={oneByOne && !answerSide ? revealNext : undefined} style={oneByOne && !answerSide ? { cursor: 'pointer' } : undefined} title={oneByOne && !answerSide ? 'Click to reveal' : undefined}>
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
          aria-label={oneByOne ? 'One-by-one image occlusion card' : `${groups.length} image occlusion cards`}
          style={oneByOne ? { pointerEvents: 'none' } : undefined}
        >
          {shownMasks.map((mask, index) => {
            const maskGroup = keyOf(mask, index);
            const isQuestionMask = maskGroup === activeGroup;
            const x = mask.x * dimensions.width;
            const y = mask.y * dimensions.height;
            const width = mask.width * dimensions.width;
            const height = mask.height * dimensions.height;
            const { key: maskKey, ...common } = {
              key: mask.id || index,
              fill: isQuestionMask ? '#ff8e8e' : '#ffeba2',
              stroke: isQuestionMask ? '#b94d4d' : '#b89a3a',
              strokeWidth: 1.25,
              style: { fill: isQuestionMask ? '#ff8e8e' : '#ffeba2', stroke: isQuestionMask ? '#b94d4d' : '#b89a3a' },
              vectorEffect: 'non-scaling-stroke',
              ...(oneByOne ? { onClick: (event) => { event.stopPropagation(); revealGroup(maskGroup); }, style: { fill: isQuestionMask ? '#ff8e8e' : '#ffeba2', stroke: isQuestionMask ? '#b94d4d' : '#b89a3a', cursor: 'pointer', pointerEvents: 'auto' } } : {}),
            };
            if (mask.shape === 'polygon' && mask.points?.length >= 3) {
              return <polygon key={maskKey} {...common} points={mask.points.map(point => `${point.x * dimensions.width},${point.y * dimensions.height}`).join(' ')} />;
            }
            if (mask.shape === 'ellipse') {
              return <ellipse key={maskKey} {...common} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
            }
            return <rect key={maskKey} {...common} x={x} y={y} width={width} height={height} />;
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

const cardPillLabel = (card) => {
  if (card.type === 'Cloze' && card.sequential) return 'Cloze · one by one';
  if (card.type === 'Image Occlusion' && card.occlusionMode === 'sequential') return 'Occlusion · in order';
  if (card.type === 'Image Occlusion' && card.occlusionMode === 'random') return 'Occlusion · random';
  return card.type || 'Basic';
};

const getCardPreview = (content) => {
    if (!content) return '';
    content = cleanColorSpans(content);
    if (/<img[^>]*>/i.test(content)) {
        return "[IMAGE] " + content.replace(/<img[^>]*>/gi, '').substring(0, 50).trim() + '...';
    }
    const cleanText = content.replace(/<audio\b[^>]*>(<\/audio>)?/gi, '[audio] ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
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


export default function FlashcardEditor({ onOpenSettings, onOpenFolders }) {
  const [deckName, setDeckName] = useState(initialDecks[0]);
  const [cardType, setCardType] = useState("Basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [pillsCollapseKey, setPillsCollapseKey] = useState(0); // bumped when a card is added: the Pills section folds back to its round buttons
  const [pills, setPills] = useState(["", "", "", ""]);
  const [pillsResetKey, setPillsResetKey] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [currentTags, setCurrentTags] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewNight, setPreviewNight] = useState(true);
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [previewAnswerSide, setPreviewAnswerSide] = useState(false);
  const [previewOcclusionIndex, setPreviewOcclusionIndex] = useState(0);
  const [cards, setCards] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [contentInitialized, setContentInitialized] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback || (callback => window.setTimeout(callback, 900));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    const idleId = scheduleIdle(() => { preloadPdfStudyPanel().catch(() => {}); }, { timeout: 1800 });
    return () => cancelIdle(idleId);
  }, []);
  const [exportMessage, setExportMessage] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [mobileView, setMobileView] = useState('editor');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [incomingPdf, setIncomingPdf] = useState(null);
  const [pdfDragging, setPdfDragging] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [occlusionImage, setOcclusionImage] = useState(null);
  const [occlusionImageWidth, setOcclusionImageWidth] = useState(720);
  const [occlusionEditorOpen, setOcclusionEditorOpen] = useState(false);
  const [occlusionMasks, setOcclusionMasks] = useState([]);
  const [occlusionMode, setOcclusionMode] = useState('hide-all');
  // AnKing-style "One by One": every cloze on a single card, revealed in number order.
  const [clozeSequential, setClozeSequential] = useState(() => { try { return localStorage.getItem('ankiClozeSequential') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('ankiClozeSequential', clozeSequential ? '1' : '0'); } catch { /* storage unavailable */ } }, [clozeSequential]);
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

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkHeading, setLinkHeading] = useState('');
  const [linkTargetRef, setLinkTargetRef] = useState(null);

  const [showDocumentationModal, setShowDocumentationModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const [activeEditor, setActiveEditor] = useState('front');
  const [selectionContext, setSelectionContext] = useState(null);
  // Anki-style field controls: collapse, pin (sticky) and raw HTML view.
  const [fieldPrefs, setFieldPrefs] = useState(() => {
    const fresh = { collapsed: { front: false, back: false }, pinned: { front: false, back: false } };
    try { const saved = JSON.parse(localStorage.getItem('ankiEditorFieldPrefs') || '{}'); return { collapsed: { ...fresh.collapsed, ...saved.collapsed }, pinned: { ...fresh.pinned, ...saved.pinned } }; } catch { return fresh; }
  });
  const [htmlOpen, setHtmlOpen] = useState({ front: false, back: false });
  const [htmlDraft, setHtmlDraft] = useState({ front: '', back: '' });
  const audioInputRef = useRef(null);
  const [inTable, setInTable] = useState(false);
  const pasteModeRef = useRef('rich');
  const toolsRef = useRef({});
  const chordRef = useRef({ key: null, at: 0 });
  useEffect(() => { try { localStorage.setItem('ankiEditorFieldPrefs', JSON.stringify(fieldPrefs)); } catch { /* storage unavailable */ } }, [fieldPrefs]);
  // Smart typing: markdown shortcuts, symbol replacement and markdown paste (each can be switched off).
  const [smartPrefs, setSmartPrefs] = useState(() => { try { return { ...SMART_DEFAULTS, ...JSON.parse(localStorage.getItem('ankiSmartTyping') || '{}') }; } catch { return SMART_DEFAULTS; } });
  const lastSmartRef = useRef(null);
  const smartBusyRef = useRef(false);
  useEffect(() => { try { localStorage.setItem('ankiSmartTyping', JSON.stringify(smartPrefs)); } catch { /* storage unavailable */ } }, [smartPrefs]);
  const audioRecorder = useAudioRecorder(
    (dataUrl) => toolsRef.current.insertAudio?.(dataUrl, toolsRef.current.recordTarget),
    (message) => setFormMessage(message),
  );
  const savedRangeRef = useRef(null);
  const pillBoxRef = useRef(null); // the pill box that has (or last had) the cursor: the toolbar works on it like on Front/Back
  const pillSyncRef = useRef(null);

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

  const pendingSavesRef = useRef({});
  const isLoadedRef = useRef(false);
  const saveLocal = useCallback((key, value) => {
    window.clearTimeout(storageTimersRef.current[key]);
    setSaveStatus('Saving');
    pendingSavesRef.current[key] = value;
    storageTimersRef.current[key] = window.setTimeout(() => {
      delete pendingSavesRef.current[key];
      try {
        localStorage.setItem(key, typeof value === 'function' ? value() : value);
        setSaveStatus('Saved');
      } catch (error) {
        console.error('Could not save local deck data', error);
        setSaveStatus('Storage full');
      }
    }, 260);
  }, []);

  // Flush debounced saves when the page is hidden/closed so a quick refresh does not lose work.
  useEffect(() => {
    const flush = () => {
      if (!isLoadedRef.current) return;
      const pending = { ...pendingSavesRef.current };
      if (frontRef.current) pending[FRONT_LS_KEY] = cleanColorSpans(frontRef.current.innerHTML);
      if (backRef.current) pending[FRONT_LS_KEY + '_back'] = backRef.current.innerHTML;
      Object.entries(pending).forEach(([key, value]) => {
        try { localStorage.setItem(key, typeof value === 'function' ? value() : value); } catch { /* storage unavailable */ }
      });
      pendingSavesRef.current = {};
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
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
            // Never rewrite the DOM while the user is typing: it would reset the caret.
            if (cardType === 'Cloze' && document.activeElement !== frontRef.current) frontRef.current.innerHTML = colorClozeContent(content, clozeColor);
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
      const finalFront = normalizeHtml(frontRef.current ? frontRef.current.innerHTML : front);
      const finalBack = normalizeHtml(backRef.current ? backRef.current.innerHTML : back);
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
          pills,
          ...(cardType === 'Cloze' ? { sequential: clozeSequential } : {}),
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
      setPills(blankPills()); setPillsResetKey(key => key + 1);
      setCurrentTags([]);
      if (frontRef.current) frontRef.current.innerHTML = '';
      if (backRef.current) backRef.current.innerHTML = '';
  }, [pills, front, back, occlusionImage, occlusionImageWidth, occlusionMasks, occlusionMode, cardType, currentTags, editingIndex, clozeSequential]);

  const deleteCard = (indexToDelete) => {
      if (window.confirm(`Are you sure you want to delete Card #${cards.length - indexToDelete}?`)) {
          setCards(prevCards => prevCards.filter((_, i) => i !== indexToDelete));
          // Keep the card being edited in sync with the shifted list.
          if (editingIndex !== null) {
              if (editingIndex === indexToDelete) {
                  setEditingIndex(null);
                  setFront(""); setBack(""); setCurrentTags([]);
                  if (frontRef.current) frontRef.current.innerHTML = '';
                  if (backRef.current) backRef.current.innerHTML = '';
              } else if (editingIndex > indexToDelete) {
                  setEditingIndex(editingIndex - 1);
              }
          }
      }
  };


  const addCard = useCallback(() => {
    const finalFront = normalizeHtml(frontRef.current ? frontRef.current.innerHTML : front);
    const finalBack = normalizeHtml(backRef.current ? backRef.current.innerHTML : back);

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
      const ioCard = { type: cardType, question: '', answer: finalBack, tags: currentTags, pills, created: new Date().toLocaleTimeString(), imageData: finalOcclusionImage, imageWidth: occlusionImageWidth, masks: occlusionMasks, occlusionMode, restoreType: previousCardTypeRef.current };
      if (editingIndex !== null) return updateCard();
      setCards(prev => [ioCard, ...prev]);
      logAdded(1);
      window.clearTimeout(frontSaveTimerRef.current); window.clearTimeout(backSaveTimerRef.current);
      setFormMessage('');
      if (!fieldPrefs.pinned.back) { setBack(''); if (backRef.current) backRef.current.innerHTML = ''; }
      setFront(''); setCurrentTags([]);
      setPills(blankPills(fieldPrefs.pinned, pills)); setPillsResetKey(key => key + 1); setPillsCollapseKey(key => key + 1);
      setCardType(previousCardTypeRef.current);
      setOcclusionImage(null); setOcclusionMasks([]);
      if (frontRef.current) frontRef.current.innerHTML = '';
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
        pills,
        ...(cardType === 'Cloze' ? { sequential: clozeSequential } : {}),
        created: new Date().toLocaleTimeString(), createdAt: Date.now()
    };

    setCards(prev => [newCard, ...prev]);
    logAdded(1);

    window.clearTimeout(frontSaveTimerRef.current); window.clearTimeout(backSaveTimerRef.current);
    // Pinned fields keep their content (Anki's "sticky" fields), e.g. a shared source or hint.
    if (!fieldPrefs.pinned.front) { setFront(""); if (frontRef.current) frontRef.current.innerHTML = ''; }
    if (!fieldPrefs.pinned.back) { setBack(""); if (backRef.current) backRef.current.innerHTML = ''; }
    setCurrentTags([]);
    setPills(blankPills(fieldPrefs.pinned, pills)); setPillsResetKey(key => key + 1); setPillsCollapseKey(key => key + 1);
    setClozeNumber(1);
    setActiveClozeId(null);

  }, [pills, cardType, front, back, currentTags, editingIndex, updateCard, occlusionImage, occlusionImageWidth, occlusionMasks, occlusionMode, fieldPrefs.pinned, clozeSequential]);


  const exportDeck = useCallback(async () => {
    if (cards.length === 0) {
        setExportMessage("Add at least one card before exporting.");
        return;
    }
    setIsExporting(true);
    setExportMessage('');

    const settings = loadSettings();
    const payload = {
      deck_name: deckName,
      settings,
      cards: cards.map(c => ({
        type: c.type,
        question: c.question,
        answer: c.answer,
        tags: c.tags,
        pills: repairPills(c.pills),
        ...(c.type === 'Cloze' ? { sequential: Boolean(c.sequential) } : {}),
        ...(c.type === 'Image Occlusion' ? { image_data: c.imageData, image_width: c.imageWidth, masks: c.masks, occlusion_mode: c.occlusionMode, header: c.header || '' } : {}),
      }))
    };

    // Preferred path: build the .apkg on this device. No upload, so there is no
    // size limit, it works offline, and large images are shrunk automatically.
    try {
      const { exportDeckLocally, CardError } = await import('../browserExport');
      try {
        const result = await exportDeckLocally(payload, {
          onProgress: (stage, done, total) => setExportMessage(stage === 'prepare'
            ? `Preparing cards… ${done}/${total}`
            : total > 1 ? `Building package ${done}/${total}…` : 'Building package…'),
        });
        setExportMessage(result.parts > 1
          ? `Deck exported as ${result.parts} files because it is large. Import all of them into Anki; they merge into one deck.`
          : 'Deck exported successfully. Open the downloaded .apkg file in Anki.');
        setIsExporting(false);
        return;
      } catch (localError) {
        if (localError instanceof CardError) {
          setExportMessage(`Export failed: ${localError.message}`);
          setIsExporting(false);
          return;
        }
        console.warn('Local export failed, trying the export service.', localError);
      }
    } catch (loadError) {
      console.warn('Local exporter could not be loaded, trying the export service.', loadError);
    }

    // Fallback: the hosted export service (only possible while the payload fits
    // within the host's ~4.5 MB request limit).
    const body = JSON.stringify({ ...payload, settings: undefined, theme: buildThemePayload(settings) });
    if (body.length > 4_000_000) {
      setExportMessage('Export failed on this device (low memory?). Try again, or remove a few large images and export in two parts.');
      setIsExporting(false);
      return;
    }

    try {
      setExportMessage('Building on the export service…');
      const res = await fetch(`${BACKEND_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });

      if (!res.ok) {
        const errorText = await res.text();
        let detail = errorText;
        try { const parsed = JSON.parse(errorText); detail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail); } catch { /* plain text */ }
        setExportMessage(`Export failed (${res.status}): ${detail.substring(0, 180)}`);
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
      setExportMessage(`Could not build the deck on this device or reach the export service. Please try again.`);
    } finally {
      setIsExporting(false);
    }
  }, [cards, deckName]);

  // ---- Folders: separate decks you can switch between ----
  const [folders, setFolders] = useState(readFolders);
  useEffect(() => {
    setFolders(prev => {
      if (!prev.list.some(f => f.id === prev.active && f.name !== deckName)) return prev;
      const next = { ...prev, list: prev.list.map(f => (f.id === prev.active ? { ...f, name: deckName } : f)) };
      writeFolders(next);
      return next;
    });
  }, [deckName]);

  const clearWorkingState = () => {
    setCardType('Basic'); previousCardTypeRef.current = 'Basic';
    setOcclusionImage(null); setOcclusionMasks([]);
    setFront(''); setBack(''); setCurrentTags([]); setClozeNumber(1); setActiveClozeId(null); setEditingIndex(null);
    setPills(blankPills()); setPillsResetKey(key => key + 1);
    if (frontRef.current) frontRef.current.innerHTML = '';
    if (backRef.current) backRef.current.innerHTML = '';
    try { localStorage.removeItem(FRONT_LS_KEY); localStorage.removeItem(FRONT_LS_KEY + '_back'); } catch { /* storage unavailable */ }
  };

  // Keep the open folder's cards safe, then open another folder (its cards replace the editor's cards).
  const activateFolder = (id, nextFolders, keepCurrent = true) => {
    if (keepCurrent) writeSnapshot(folders.active, { deck: deckName, cards });
    const snapshot = readSnapshot(id) || { deck: nextFolders.list.find(f => f.id === id)?.name || 'Default Deck', cards: [] };
    setCards(snapshot.cards || []);
    setDeckName(snapshot.deck || 'Default Deck');
    clearWorkingState();
    const next = { ...nextFolders, active: id };
    setFolders(next);
    writeFolders(next);
  };
  const switchFolder = (id) => { if (id !== folders.active) activateFolder(id, folders); };
  const createFolder = (name) => {
    const id = newFolderId();
    writeSnapshot(id, { deck: name, cards: [] });
    activateFolder(id, { ...folders, list: [...folders.list, { id, name }] });
  };
  const deleteFolder = (id) => {
    const target = folders.list.find(f => f.id === id);
    if (!target || folders.list.length < 2) return;
    const count = id === folders.active ? cards.length : (readSnapshot(id)?.cards?.length || 0);
    if (!window.confirm(`Delete the folder "${target.name}" and its ${count} card${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const rest = { ...folders, list: folders.list.filter(f => f.id !== id) };
    removeSnapshot(id);
    if (id === folders.active) activateFolder(rest.list[0].id, rest, false);
    else { setFolders(rest); writeFolders(rest); }
  };
  const renameMany = (renames) => {
    const byId = new Map(renames.map(r => [r.id, r.name]));
    const next = { ...folders, list: folders.list.map(f => (byId.has(f.id) ? { ...f, name: byId.get(f.id) } : f)) };
    setFolders(next); writeFolders(next);
    renames.forEach(({ id, name }) => {
      if (id === folders.active) setDeckName(name);
      else { const snap = readSnapshot(id); if (snap) writeSnapshot(id, { ...snap, deck: name }); }
    });
  };
  const renameFolder = (id, name) => {
    const next = { ...folders, list: folders.list.map(f => (f.id === id ? { ...f, name } : f)) };
    setFolders(next); writeFolders(next);
    if (id === folders.active) setDeckName(name);
    else { const snap = readSnapshot(id); if (snap) writeSnapshot(id, { ...snap, deck: name }); }
  };
  // The Folders screen asks for changes through an event; the editor owns the cards, so it carries them out.
  const folderActionRef = useRef(null);
  folderActionRef.current = (detail) => {
    if (detail.type === 'switch') switchFolder(detail.id);
    else if (detail.type === 'create') createFolder(detail.name);
    else if (detail.type === 'delete') deleteFolder(detail.id);
    else if (detail.type === 'rename') renameFolder(detail.id, detail.name);
    else if (detail.type === 'rename-many') renameMany(detail.renames || []);
    else if (detail.type === 'browse') setShowCardBrowser(true);
    else if (detail.type === 'import') setShowImportModal(true);
    window.setTimeout(() => window.dispatchEvent(new Event('beerus-folders-changed')), 60);
  };
  useEffect(() => {
    const handler = (event) => folderActionRef.current?.(event.detail || {});
    window.addEventListener('beerus-folder-action', handler);
    return () => window.removeEventListener('beerus-folder-action', handler);
  }, []);

  const moveCards = (indexes, toId) => {
    const target = readSnapshot(toId) || { deck: folders.list.find(f => f.id === toId)?.name || 'Default Deck', cards: [] };
    const chosen = new Set(indexes);
    const moved = cards.filter((_, i) => chosen.has(i));
    if (!moved.length || !writeSnapshot(toId, { ...target, cards: [...moved, ...(target.cards || [])] })) return 0;
    setCards(prev => prev.filter((_, i) => !chosen.has(i)));
    return moved.length;
  };

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
      if (card.type === 'Cloze') setClozeSequential(Boolean(card.sequential));
    }

    const question = card.question || '';
    const answer = card.answer || '';
    const displayFront = card.type === 'Cloze' ? colorClozeContent(question, clozeColor) : question;
    setFront(question);
    setBack(answer);
    setPills(repairPills(card.pills)); setPillsResetKey(key => key + 1);
    setCurrentTags(card.tags || []);

    if (frontRef.current) frontRef.current.innerHTML = displayFront;
    if (backRef.current) backRef.current.innerHTML = answer;
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
        tags: (card.tags || []).filter(t => t !== tagToDelete)
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
        tags: (card.tags || []).map(t => t === oldTag ? trimmedNewTag : t)
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

  // The front editor is unmounted while in Image Occlusion mode; refill it when it comes back
  // (e.g. editing a Basic/Cloze card while the form was in Image Occlusion mode).
  useEffect(() => {
    if (cardType === 'Image Occlusion' || !contentInitialized) return;
    const editor = frontRef.current;
    if (editor && isBlankHtml(editor.innerHTML) && front) {
      editor.innerHTML = cardType === 'Cloze' ? colorClozeContent(front, clozeColor) : front;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardType, contentInitialized, editingIndex]);

  useEffect(() => {
    if (!occlusionEditorOpen && !showPreview && !showLinkModal && !showColorPicker) return undefined;
    const onEscape = (e) => {
      if (e.key !== 'Escape') return;
      if (showLinkModal) setShowLinkModal(false);
      else if (showColorPicker) { setShowColorPicker(false); setColorPickerTarget(null); }
      else if (showPreview) setShowPreview(false);
      else if (occlusionEditorOpen) setOcclusionEditorOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [occlusionEditorOpen, showPreview, showLinkModal, showColorPicker]);

  useEffect(() => installFieldHistory(), []); // Ctrl+Z / Ctrl+Y that follow your actions, with a toast naming what was undone
  useEffect(() => installTableSelection(), []); // Word-style selection of a block of table cells
  useEffect(() => installImageDrop(), []); // pictures dropped into any other field (pills, extra...) without the links that come with them

  useEffect(() => { setHtmlOpen({ front: false, back: false }); }, [editingIndex, cardType]);
  useEffect(() => {
    // Clearing a field (after Add) must also clear an open HTML view.
    setHtmlDraft(draft => ({ front: !front && htmlOpen.front ? '' : draft.front, back: !back && htmlOpen.back ? '' : draft.back }));
  }, [front, back, htmlOpen.front, htmlOpen.back]);

  // Anki editor shortcuts, active only while a card field has focus.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.key) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const active = document.activeElement;
      const api = toolsRef.current.api;
      if (!api) return;
      if (mod && event.shiftKey && key === 'v') {
        pasteModeRef.current = 'plain';
        window.setTimeout(() => { pasteModeRef.current = 'rich'; }, 800);
        return;
      }
      const htmlField = active?.dataset?.htmlField;
      const inPill = !htmlField && Boolean(active?.classList?.contains('pill-field-box'));
      const field = htmlField || (active === frontRef.current ? 'front' : active === backRef.current ? 'back' : inPill ? 'pill' : null);
      if (!field) return;
      if (inPill) pillBoxRef.current = active;
      const ref = field === 'front' ? frontRef : field === 'pill' ? pillBoxRef : backRef;
      if (mod && event.shiftKey && key === 'x') { if (field !== 'pill') { event.preventDefault(); api.toggleHtmlView(field); } return; }
      if (htmlField) return;
      if (event.key === 'Tab' && !mod && !event.altKey && toolsRef.current.table.findCell(ref.current)) {
        event.preventDefault();
        toolsRef.current.table.tableTab(ref.current, event.shiftKey);
        api.syncAfterEdit(ref);
        return;
      }
      const smart = field === 'pill' ? null : toolsRef.current.smart;
      if (smart && !mod) {
        const editor = ref.current;
        const last = smart.lastSmartRef.current;
        if (event.key === 'Backspace' && last && last.editor === editor && last.html === editor.innerHTML) {
          // Backspace right after an automatic conversion puts back what you typed.
          event.preventDefault();
          smart.lastSmartRef.current = null;
          if (last.revert) last.revert(); else document.execCommand('undo');
          api.syncAfterEdit(ref);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && smart.prefs.markdown && smart.smartEnter(editor)) { event.preventDefault(); api.syncAfterEdit(ref); return; }
        if (event.key === 'Tab' && !event.altKey && smart.prefs.markdown && smart.listTab(editor, event.shiftKey)) { event.preventDefault(); api.syncAfterEdit(ref); return; }
      }
      const exec = (command) => { event.preventDefault(); document.execCommand(command, false, null); api.syncAfterEdit(ref); };
      // Ctrl+B / I / U are taken by some browsers (Brave opens Leo / the sidebar on Ctrl+B), so handle them here and stop the browser.
      if (mod && !event.altKey && !event.shiftKey && ['b', 'i', 'u'].includes(key) && field !== 'html') { event.preventDefault(); event.stopPropagation(); api.applyFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline', ref); return; }
      const chord = chordRef.current;
      if (chord.key === 'm' && Date.now() - chord.at < 1500) {
        chordRef.current = { key: null, at: 0 };
        if (key === 'm' || key === 'e') { event.preventDefault(); api.insertMath(key === 'm' ? 'mathjax-inline' : 'mathjax-block', ref, true); return; }
      }
      if (mod && !event.shiftKey && !event.altKey && key === 'm') { event.preventDefault(); chordRef.current = { key: 'm', at: Date.now() }; return; }
      if (mod && !event.altKey && key === 'r' && !event.shiftKey) { exec('removeFormat'); return; }
      if (mod && !event.altKey && event.key === '=') { exec('subscript'); return; }
      if (mod && !event.altKey && event.key === '+') { exec('superscript'); return; }
      if (mod && event.shiftKey && key === 'c' && api.cardType === 'Cloze' && field === 'front') { event.preventDefault(); api.insertCloze(ref, event.altKey); return; }
      if (event.key === 'F3') { event.preventDefault(); api.openAudioPicker(ref); return; }
      if (event.key === 'F5') { event.preventDefault(); api.toggleRecording(ref); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.key) return;
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

    // keyup is never delivered if the window loses focus while Ctrl/Cmd is held (alt-tab).
    const handleBlur = () => { setIsCtrlPressed(false); setActiveClozeId(null); };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
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
      // Occlusion image/masks are not persisted, so an empty Image Occlusion form would be a dead end.
      const initialCardType = state.cardType && state.cardType !== 'Image Occlusion' ? state.cardType : "Basic";
      setCardType(initialCardType);
      setCards((state.cards || []).map(saved => (saved.pills ? { ...saved, pills: repairPills(saved.pills) } : saved)));
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

      isLoadedRef.current = true;
      setIsLoaded(true);
      setContentInitialized(true);

      document.title = "Anki Deck Builder";

    } catch (e) {
      console.error("Could not load state from localStorage", e);
      isLoadedRef.current = true;
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
    try { localStorage.setItem(CLOZE_COLOR_LS_KEY, clozeColor); } catch { /* storage unavailable */ }
  }, [isLoaded, clozeColor]);

  useEffect(() => {
    if (!isLoaded) return;
    try { localStorage.setItem(BASIC_COLORS_LS_KEY, JSON.stringify(basicColorPresets)); } catch { /* storage unavailable */ }
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

    if (e.key === 'Tab' && !e.shiftKey) {
      const trimmedInput = tagInput.trim();
      if (trimmedInput.length > 0 && !trimmedInput.endsWith('::')) {
        e.preventDefault();
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
      const pastedHtml = clipboardData?.getData('text/html') || '';
      const pastedText = clipboardData?.getData('text/plain') || '';
      const plainRequested = pasteModeRef.current === 'plain';
      pasteModeRef.current = 'rich';
      // Plain text that is really markdown (notes from ChatGPT, Notion, GitHub...) becomes real formatting.
      const smartMarkdown = smartPrefs.paste && !plainRequested && isPlainHtml(pastedHtml) && looksLikeMarkdown(pastedText);
      if (plainRequested || pastedHtml || smartMarkdown) {
        // Strip page chrome (classes, fonts, scripts) but keep real formatting; Ctrl+Shift+V pastes plain text.
        e.preventDefault();
        const cleaned = plainRequested ? '' : smartMarkdown ? markdownToHtml(pastedText) : sanitizePastedHtml(pastedHtml);
        document.execCommand('insertHTML', false, cleaned || plainTextToHtml(pastedText));
      }
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
      const tempImgId = `pasted-img-${makeId()}`;
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
          setActionLabel('Image');
          const imgHtml = `<img src="${base64Image}" alt="uploaded-image" style="display: inline-block; max-width:${BASE_IMAGE_WIDTH}px; height:auto; vertical-align: middle;">`;
          const finalHtml = imgHtml + '&nbsp;';

          document.execCommand('insertHTML', false, finalHtml);

          if (targetRef === frontRef) {
            syncFrontContent(targetRef.current.innerHTML);
          } else if (targetRef === pillBoxRef) {
            pillSyncRef.current?.();
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
  
    setActionLabel('Cloze');
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
    // The toolbar never takes focus, so when the field still has it the live selection is the truth: a selection made
    // with the mouse is not in savedRangeRef yet, and restoring the older saved caret would drop it (that is what
    // made the colour / format buttons need a second click).
    const live = window.getSelection();
    if (document.activeElement === targetRef.current && live.rangeCount && targetRef.current.contains(live.anchorNode)) return true;
    targetRef.current.focus();
    const range = savedRangeRef.current;
    if (!range || !targetRef.current.contains(range.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  // Word's "Automatic": takes the colour off the selection again (not the other formatting).
  const clearTextColor = (targetRef) => {
    applyFormat('foreColor', targetRef, '#010203');
    window.setTimeout(() => {
      const root = targetRef.current;
      if (!root) return;
      setActionLabel('Text colour');
      root.querySelectorAll('font[color="#010203"]').forEach(node => { node.replaceWith(...node.childNodes); });
      root.querySelectorAll('[style*="rgb(1, 2, 3)"]').forEach(node => { node.style.removeProperty('color'); if (!node.getAttribute('style')) node.removeAttribute('style'); });
      if (targetRef === pillBoxRef) pillSyncRef.current?.();
      else if (targetRef === frontRef) syncFrontContent(root.innerHTML);
      else syncBackContent(root.innerHTML);
    }, 30);
  };

  const applyFormat = (type, targetRef, value = null) => {
    if (targetRef.current) {
        setActionLabel(FORMAT_LABELS[type] || 'Formatting');
        const selectedCells = getSelectedCells(targetRef.current);
        if (selectedCells.length) { // a block of table cells is selected: format every cell, like Word
          targetRef.current.focus();
          const selection = window.getSelection();
          selectedCells.forEach(cell => { const range = document.createRange(); range.selectNodeContents(cell); selection.removeAllRanges(); selection.addRange(range); document.execCommand(type, false, value); });
          if (type === 'hiliteColor') fixHighlightContrast(targetRef.current);
        } else {
          restoreSavedSelection(targetRef);
          document.execCommand(type, false, value);
          if (type === 'hiliteColor') fixHighlightContrast(targetRef.current);
        }

        setTimeout(() => {
            if (targetRef === frontRef) {
                syncFrontContent(targetRef.current.innerHTML);
            } else if (targetRef === pillBoxRef) {
                pillSyncRef.current?.();
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

  // Touch devices (iPad/iPhone) move selection handles without firing mouseup/keyup, so
  // track selection changes directly to keep the toolbar's saved range and size controls current.
  const selectionHandlerRef = useRef(null);
  selectionHandlerRef.current = handleSelectionChange;
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const editor = [frontRef.current, backRef.current].find(node => node && node.contains(range.commonAncestorContainer));
      if (!editor) return;
      // Leave image selections to the click handler (it owns the image resize context).
      const startNode = range.startContainer;
      if (startNode === range.endContainer && range.endOffset - range.startOffset === 1 && startNode.childNodes?.[range.startOffset]?.nodeName === 'IMG') return;
      if (selection.isCollapsed) { savedRangeRef.current = range.cloneRange(); return; }
      selectionHandlerRef.current?.({ currentTarget: editor, target: editor });
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

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
          
          // commonAncestorContainer may be a text node (no querySelectorAll); search the editor instead.
          const newSpan = Array.from(targetRef.current.querySelectorAll(`span[style*="font-size: ${newPxSize}px"]`)).pop();
          
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


  const insertCloze = (targetRef, sameNumber = false) => {
    if (cardType !== "Cloze" || targetRef !== frontRef || !targetRef.current) return;

    restoreSavedSelection(targetRef);
    const selection = window.getSelection();
    let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : document.createRange();
    if (!targetRef.current.contains(range.commonAncestorContainer)) {
      // Selection is outside the editor (or missing): insert at the end of the editor instead.
      range = document.createRange();
      range.selectNodeContents(targetRef.current);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  
    setActionLabel('Cloze');
    const selectedText = selection.toString().trim();
    const placeholderText = selectedText || 'text';
    const isPlaceholder = !selectedText;
  
    if (selectedText) {
      range.deleteContents();
    }
  
    const highestCloze = getHighestClozeNumber(frontRef.current.innerHTML);
    // Anki: Ctrl+Shift+C starts a new number, Ctrl+Alt+Shift+C reuses the current one.
    const currentClozeNum = Math.max(1, highestCloze + (sameNumber ? 0 : 1));
  
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
    const linkHtml = `<a href="https://${escapeHtmlAttr(cleanUrl)}" style="color: ${ANKI_LINK_COLOR};">(${escapeHtmlAttr(heading.trim())})</a>`;

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
    const pillMatch = /^pill([1-8])$/.exec(target);
    if (pillMatch) { // a PDF capture sent to a pill
      const n = Number(pillMatch[1]) - 1;
      const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const picture = snippet.text ? `<p>${escapeText(snippet.text)}</p>` : `<img src="${snippet.image}" alt="PDF capture" style="max-width:100%;height:auto;">`;
      setPills(prev => prev.map((html, i) => (i === n ? `${html || ''}${picture}` : html)));
      setPillsResetKey(key => key + 1);
      setFormMessage(`${snippet.text ? 'Text' : 'Capture'} added to the “${loadSettings().pills[n]?.label || `Pill ${n + 1}`}” pill.`);
      window.setTimeout(() => setFormMessage(''), 2500);
      return;
    }
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
    const html = snippet.text ? `${snippet.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}&nbsp;` : `<img src="${snippet.image}" alt="PDF capture" style="max-width: min(100%, 480px); height:auto; border-radius:6px;">&nbsp;`;
    setActionLabel(snippet.text ? 'PDF text' : 'PDF capture');
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
    const dropped = readDroppedImages(event.dataTransfer); // pictures only: the links that travel with a dropped picture are discarded
    const imageUrl = dropped.sources[0];
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
    } else dropped.sources.forEach(source => { if (/^data:image\//i.test(source) || /^https?:\/\//i.test(source)) placeImage(source); });
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

  // Drop a PDF anywhere on the page to open it in the study panel.
  const pdfOpenRef = useRef(false);
  pdfOpenRef.current = pdfOpen;
  useEffect(() => {
    const hasPdf = (dt) => {
      if (!dt || ![...(dt.types || [])].includes('Files')) return false;
      const items = [...(dt.items || [])].filter(item => item.kind === 'file');
      return items.length > 0 && items.some(item => item.type === 'application/pdf' || item.type === '');
    };
    let depth = 0;
    const onEnter = (event) => { if (hasPdf(event.dataTransfer)) { depth += 1; setPdfDragging(true); } };
    const onOver = (event) => { if (hasPdf(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
    const onLeave = (event) => { if (hasPdf(event.dataTransfer)) { depth = Math.max(0, depth - 1); if (!depth) setPdfDragging(false); } };
    const onDrop = (event) => {
      depth = 0; setPdfDragging(false);
      const file = [...(event.dataTransfer?.files || [])].find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      if (!file) return;
      event.preventDefault(); event.stopPropagation();
      if (pdfOpenRef.current && !window.confirm(`Open “${file.name}” in the PDF panel? It replaces the PDF that is open now.`)) return;
      setIncomingPdf({ file, key: Date.now() });
      preloadPdfStudyPanel().catch(() => {});
      setPdfOpen(true); setShowLibrary(false); setMobileView('pdf');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop, true); // before the image-drop handlers
    window.addEventListener('dragend', () => { depth = 0; setPdfDragging(false); });
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragover', onOver); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop, true); };
  }, []);

  const openPdfWorkspace = () => {
    preloadPdfStudyPanel().catch(() => {});
    setPdfOpen(true); setShowLibrary(false); setMobileView('pdf');
  };

  const manualMaskPoint = (event) => {
    const rect = (event.currentTarget.querySelector('img') || event.currentTarget).getBoundingClientRect();
    const w = rect.width || 1, h = rect.height || 1;
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / w)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / h)) };
  };
  // A cancelled pointer (e.g. the browser took over for scrolling) must not create a mask.
  const cancelManualMask = () => { manualMaskStartRef.current = null; setManualMaskPreview(null); };
  const finishManualMask = (event) => {
    const start = manualMaskStartRef.current;
    if (!start) return;
    const end = manualMaskPoint(event); manualMaskStartRef.current = null; setManualMaskPreview(null);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
    if (width < .01 || height < .01) return;
    setOcclusionMasks(prev => [...prev, { id: makeId(), shape: 'rect', x, y, width, height, points: [], label: '', group: null }]);
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
  // The saved-card list is only redrawn when the cards change, not on every keystroke in the editor.
  const editRef = useRef(null); const deleteRef = useRef(null);
  editRef.current = loadCardForEdit; deleteRef.current = deleteCard;
  const cardListItems = useMemo(() => (
    <>
      {visibleCards.map(({ card, index }) => (
              <article key={`${card.created}-${index}`} className="card-item">
                <div className="card-item-top">
                  <span className="card-index">{String(cards.length - index).padStart(2, '0')}</span>
                  <span className="card-type-pill">{cardPillLabel(card)}</span>
                  <span className="card-created">{card.created}</span>
                </div>
                <button className="card-content-button" onClick={() => editRef.current(index)} aria-label={`Edit card ${cards.length - index}`}>
                  {card.type === 'Image Occlusion' ? <div className="io-library-preview"><img src={card.imageData} alt=""/><span>{(card.masks || []).length} occlusion region{(card.masks || []).length === 1 ? '' : 's'}</span></div> : <div className="card-preview-line"><strong>{card.type === "Cloze" ? "Text" : "Front"}</strong><span>{getCardPreview(card.question) || 'Empty card content'}</span></div>}
                  {card.type !== "Cloze" && card.type !== 'Image Occlusion' && <div className="card-preview-line answer-line"><strong>Back</strong><span>{getCardPreview(card.answer) || 'No answer added'}</span></div>}
                  {card.type === "Cloze" && card.answer && <div className="card-preview-line answer-line"><strong>Extra</strong><span>{getCardPreview(card.answer)}</span></div>}
                  {card.type === 'Image Occlusion' && card.answer && <div className="card-preview-line answer-line"><strong>Extra</strong><span>{getCardPreview(card.answer)}</span></div>}
                </button>
                <div className="card-item-bottom">
                  <div className="card-tags">{(card.tags || []).map((tag, tagIndex) => <span key={tagIndex}>{formatTagForDisplay(tag)}</span>)}</div>
                  <div className="card-tools">
                    <button onClick={() => editRef.current(index)} aria-label="Edit card" title="Edit card"><Edit size={15} /></button>
                    <button onClick={() => deleteRef.current(index)} aria-label="Delete card" title="Delete card"><Trash2 size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
    </>
  ), [visibleCards, cards.length]);


  const toolbarTargetRef = activeEditor === 'pill' ? pillBoxRef : activeEditor === 'back' ? backRef : frontRef;

  const oneByOneOcclusion = occlusionMode === 'sequential' || occlusionMode === 'random';
  const occlusionCardCount = oneByOneOcclusion ? 1 : new Set(occlusionMasks.map((mask, index) => mask.group || mask.id || `mask-${index + 1}`)).size;

  const handleSmartInput = (event, targetRef) => {
    if (smartBusyRef.current || (!smartPrefs.markdown && !smartPrefs.typography) || !targetRef.current) return;
    smartBusyRef.current = true;
    try {
      const applied = smartTyping(event.nativeEvent, targetRef.current, smartPrefs);
      lastSmartRef.current = applied ? { editor: targetRef.current, html: targetRef.current.innerHTML, revert: applied.revert } : null;
    } finally {
      smartBusyRef.current = false;
    }
  };

  const syncAfterEdit = (targetRef) => setTimeout(() => {
    if (!targetRef.current) return;
    if (targetRef === frontRef) syncFrontContent(targetRef.current.innerHTML);
    else if (targetRef === pillBoxRef) pillSyncRef.current?.();
    else syncBackContent(targetRef.current.innerHTML);
  }, 10);

  // Wraps the selection in MathJax / LaTeX delimiters (Anki's fx menu).
  const insertMath = (kind, targetRef = toolbarTargetRef, live = false) => {
    setActionLabel('Math');
    const [before, after] = MATH_WRAPPERS[kind];
    if (!live) restoreSavedSelection(targetRef);
    targetRef.current?.focus();
    wrapSelection(targetRef.current, before, after);
    syncAfterEdit(targetRef);
  };

  const insertAudio = (dataUrl, targetRef = toolbarTargetRef) => {
    if (!targetRef?.current) return;
    restoreSavedSelection(targetRef);
    document.execCommand('insertHTML', false, audioHtml(dataUrl));
    syncAfterEdit(targetRef);
  };

  const handleAudioFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setFormMessage('Choose an audio file (MP3, M4A, WAV, OGG…).'); return; }
    if (file.size > MAX_AUDIO_BYTES) { setFormMessage('That audio file is over 6 MB. Trim it first so your deck stays fast and saves in this browser.'); return; }
    try { insertAudio(await fileToDataUrl(file), toolsRef.current.audioTarget || toolbarTargetRef); } catch { setFormMessage('Could not read that audio file.'); }
  };

  const openAudioPicker = (targetRef = toolbarTargetRef) => { toolsRef.current.audioTarget = targetRef; audioInputRef.current?.click(); };

  const toggleRecording = (targetRef = toolbarTargetRef) => {
    if (audioRecorder.recording) { audioRecorder.stop(); return; }
    toolsRef.current.recordTarget = targetRef;
    audioRecorder.start();
  };

  const toggleHtmlView = (field) => {
    const ref = field === 'front' ? frontRef : backRef;
    if (!htmlOpen[field]) setHtmlDraft(draft => ({ ...draft, [field]: ref.current?.innerHTML || '' }));
    setHtmlOpen(open => ({ ...open, [field]: !open[field] }));
  };

  const changeHtmlView = (field, value) => {
    const ref = field === 'front' ? frontRef : backRef;
    setHtmlDraft(draft => ({ ...draft, [field]: value }));
    if (ref.current) ref.current.innerHTML = value;
    scheduleEditorSave(field);
  };

  const insertTable = (rows, cols, targetRef = toolbarTargetRef) => {
    setActionLabel('Table');
    const editor = targetRef.current;
    if (!editor) return;
    restoreSavedSelection(targetRef);
    document.execCommand('insertHTML', false, buildTableHtml(rows, cols, true) + '<br>');
    const created = editor.querySelector('table[data-new-table]');
    if (created) { created.removeAttribute('data-new-table'); placeCaretInCell(created.querySelector('th, td')); }
    syncAfterEdit(targetRef);
  };

  const runTableAction = (action, targetRef = toolbarTargetRef) => {
    setActionLabel('Table');
    restoreSavedSelection(targetRef);
    if (tableAction(targetRef.current, action)) syncAfterEdit(targetRef);
  };

  // Cards produced by the AnKing card-generator skill (validated by cardImport.js).
  const importCards = (imported, importedDeckName) => {
    if (!imported.length) return;
    const stamp = new Date().toLocaleTimeString();
    setCards(prev => [...imported.map(card => ({ ...card, created: stamp })), ...prev]);
    logAdded(imported.length);
    if (importedDeckName && (!deckName.trim() || initialDecks.includes(deckName))) setDeckName(importedDeckName);
    setExportMessage(`Imported ${imported.length} card${imported.length === 1 ? '' : 's'}. Review them in the card library, then export.`);
  };

  const toggleFieldPref = (kind, field) => setFieldPrefs(prefs => ({ ...prefs, [kind]: { ...prefs[kind], [field]: !prefs[kind][field] } }));

  const cardKeys = useMemo(() => cards.map(card => (card.type === 'Image Occlusion' ? null : duplicateKey(card.question))), [cards]);
  const duplicateMatches = useMemo(() => {
    if (cardType === 'Image Occlusion') return [];
    const key = duplicateKey(front);
    if (key.length < 2 || key === '[img]') return [];
    const matches = [];
    cardKeys.forEach((cardKey, index) => { if (cardKey === key && index !== editingIndex) matches.push(index); });
    return matches;
  }, [front, cardKeys, cardType, editingIndex]);

  // Latest tool handlers for the keyboard-shortcut effect (declared earlier in the component).
  toolsRef.current.insertAudio = insertAudio;
  toolsRef.current.api = { applyFormat, insertMath, insertCloze, toggleHtmlView, openAudioPicker, toggleRecording, syncAfterEdit, cardType };
  toolsRef.current.table = { tableTab, findCell };
  toolsRef.current.smart = { prefs: smartPrefs, lastSmartRef, smartEnter, listTab };

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

      {pdfDragging && <div className="pdf-drop-overlay" role="presentation"><div><strong>Drop the PDF to open it</strong><span>It opens in the study panel next to your card editor</span></div></div>}

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Layers3 size={21} strokeWidth={2.2} /></div>
          <div><p className="brand-kicker">STUDY WORKSPACE</p><h1>Anki Studio</h1></div>
        </div>
        <div className="header-status"><span className={`save-dot ${saveStatus === 'Storage full' ? 'save-error' : ''}`} /><span>{saveStatus === 'Saved' ? 'All changes saved' : saveStatus}</span><span className="status-divider" /><span>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span></div>
        <div className="header-actions">
          <button onClick={() => onOpenFolders?.()} title="Folders: separate decks, today's new cards and your activity calendar" className="icon-button fm-btn hb hb-deck"><Layers3 size={18} /><span>{folders.list.find(f => f.id === folders.active)?.name || 'Folders'}</span></button>
          <button onClick={() => setShowCardBrowser(true)} title="Browse all cards (full screen)" className="icon-button hb hb-browse"><BookOpen size={18} /><span>Browse</span></button>
          <button onClick={() => setShowImportModal(true)} title="Import cards from JSON (AI-generated)" className="icon-button hb hb-import"><Upload size={18} /><span>Import</span></button>
          <span className="hb-sep" aria-hidden="true" /><button onClick={() => onOpenSettings?.()} title="Card types, pills, watermark and look" className="icon-button hb hb-settings"><Settings size={18} /><span>Settings</span></button>
          <button onClick={() => setShowDocumentationModal(true)} title="Help and keyboard shortcuts" className="icon-button hb hb-help"><HelpCircle size={18} /><span>Help</span></button>
          <span className="hb-sep" aria-hidden="true" />{pdfOpen && <button onClick={() => { const opening = !(showLibrary && mobileView === 'cards'); setShowLibrary(opening); setMobileView(opening ? 'cards' : 'pdf'); }} aria-pressed={showLibrary && mobileView === 'cards'} title={showLibrary && mobileView === 'cards' ? 'Return to PDF' : 'Open card library'} className={`icon-button hb hb-cards library-toggle ${showLibrary && mobileView === 'cards' ? 'active' : ''}`}><BookOpen size={17} /><span>Cards {cards.length}</span></button>}
          <button onPointerEnter={() => { if (!pdfOpen) preloadPdfStudyPanel().catch(() => {}); }} onFocus={() => { if (!pdfOpen) preloadPdfStudyPanel().catch(() => {}); }} onTouchStart={() => { if (!pdfOpen) preloadPdfStudyPanel().catch(() => {}); }} onClick={() => pdfOpen ? closePdfWorkspace() : openPdfWorkspace()} className="quiet-button hb hb-pdf"><FileText size={16} /><span>{pdfOpen ? 'Close PDF' : 'Open PDF'}</span></button>
          <button onClick={startNewDeck} className="quiet-button hb hb-new"><PlusCircle size={16} /><span>New deck</span></button>
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

            {cardType === 'Cloze' && <label className="seq-toggle"><input type="checkbox" checked={clozeSequential} onChange={event => setClozeSequential(event.target.checked)} /><span><strong>Reveal one by one</strong><small>Puts every cloze on a single card and reveals them in number order: click a cloze or press N, and comma reveals all. Clozes sharing a number appear together.</small></span></label>}

            {cardType !== 'Image Occlusion' && <div className="editor-toolbar" role="toolbar" aria-label="Card formatting" onPointerDown={(e) => e.preventDefault()}>
              <div className="flex w-max min-w-full flex-nowrap items-center gap-1">
              <WordColorTool kind="text" onApply={(color) => applyFormat('foreColor', toolbarTargetRef, color)} onClear={() => clearTextColor(toolbarTargetRef)} />
              {cardType === 'Cloze' && <button onClick={() => { setColorPickerTarget('cloze'); setShowColorPicker(true); }} title="Cloze color (the colour of the hidden answer)" aria-label="Cloze color" className="mx-1 h-5 w-5 flex-none rounded-full border border-neutral-500" style={{ backgroundColor: clozeColor }} />}
              <button onClick={() => applyFormat('removeFormat', toolbarTargetRef)} title="Clear formatting (Ctrl+R)" className="toolbar-button"><Eraser size={16} /></button>
              <span aria-hidden="true" className="mx-1 h-5 border-l border-neutral-700" />
              <button onClick={() => applyFormat('bold', toolbarTargetRef)} title="Bold (Ctrl+B)" className="toolbar-button font-bold">B</button>
              <button onClick={() => applyFormat('italic', toolbarTargetRef)} title="Italic (Ctrl+I)" className="toolbar-button italic">I</button>
              <button onClick={() => applyFormat('underline', toolbarTargetRef)} title="Underline (Ctrl+U)" className="toolbar-button underline">U</button>
              <button onClick={() => applyFormat('strikeThrough', toolbarTargetRef)} title="Strikethrough" className="toolbar-button"><Strikethrough size={16} /></button>
              <button onClick={() => applyFormat('superscript', toolbarTargetRef)} title="Superscript (Ctrl+Shift+=)" className="toolbar-button"><Superscript size={16} /></button>
              <button onClick={() => applyFormat('subscript', toolbarTargetRef)} title="Subscript (Ctrl+=)" className="toolbar-button"><Subscript size={16} /></button>
              <WordColorTool kind="highlight" icon={<Highlight size={16} />} onApply={(color) => applyFormat('hiliteColor', toolbarTargetRef, color)} onClear={() => applyFormat('hiliteColor', toolbarTargetRef, 'transparent')} />
              <span aria-hidden="true" className="mx-1 h-5 border-l border-neutral-700" />
              <ToolbarMenu title="Lists and indent" icon={<ListBullets size={16} />}>
                <MenuItem icon={<ListBullets size={15} />} onClick={() => applyFormat('insertUnorderedList', toolbarTargetRef)}>Bulleted list</MenuItem>
                <MenuItem icon={<ListOrdered size={15} />} onClick={() => applyFormat('insertOrderedList', toolbarTargetRef)}>Numbered list</MenuItem>
                <MenuItem icon={<Indent size={15} />} onClick={() => applyFormat('indent', toolbarTargetRef)}>Increase indent</MenuItem>
                <MenuItem icon={<Outdent size={15} />} onClick={() => applyFormat('outdent', toolbarTargetRef)}>Decrease indent</MenuItem>
              </ToolbarMenu>
              <ToolbarMenu title="Text alignment" icon={<AlignCenter size={16} />}>
                <MenuItem icon={<AlignLeft size={15} />} onClick={() => applyFormat('justifyLeft', toolbarTargetRef)}>Align left</MenuItem>
                <MenuItem icon={<AlignCenter size={15} />} onClick={() => applyFormat('justifyCenter', toolbarTargetRef)}>Center</MenuItem>
                <MenuItem icon={<AlignRight size={15} />} onClick={() => applyFormat('justifyRight', toolbarTargetRef)}>Align right</MenuItem>
                <MenuItem icon={<AlignJustify size={15} />} onClick={() => applyFormat('justifyFull', toolbarTargetRef)}>Justify</MenuItem>
              </ToolbarMenu>
              <button onClick={() => resizeContent(-1)} title="Decrease selected text or image size" disabled={!selectionContext || selectionContext.editorRef !== toolbarTargetRef} className="toolbar-button"><ArrowDown size={16} /></button>
              <span className="w-10 text-center font-mono text-[11px] text-neutral-400" aria-live="polite">{selectionContext?.editorRef === toolbarTargetRef ? (selectionContext.type === 'image' ? `${selectionContext.size}%` : `${selectionContext.size}px`) : '--'}</span>
              <button onClick={() => resizeContent(1)} title="Increase selected text or image size" disabled={!selectionContext || selectionContext.editorRef !== toolbarTargetRef} className="toolbar-button"><ArrowUp size={16} /></button>
              <button onClick={() => openImagePicker()} title="Insert image" className="toolbar-button"><Upload size={16} /></button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, uploadTargetRef.current || toolbarTargetRef)} />
              {activeEditor === 'back' && <button onClick={() => insertHyperlink(toolbarTargetRef)} title="Insert hyperlink" className="toolbar-button"><Link size={16} /></button>}
              {cardType === 'Cloze' && activeEditor === 'front' && <button onClick={() => insertCloze(toolbarTargetRef)} title={`Insert cloze c${clozeNumber}`} className="toolbar-button font-mono text-xs">{'{ }'}</button>}
              {cardType === 'Cloze' && activeEditor === 'front' && <button onClick={() => insertCloze(toolbarTargetRef, true)} title="Cloze, same number (Ctrl+Alt+Shift+C)" className="toolbar-button font-mono text-xs">{'{=}'}</button>}
              <span aria-hidden="true" className="mx-1 h-5 border-l border-neutral-700" />
              <ToolbarMenu title="Math and LaTeX" icon={<Sigma size={16} />}>
                <MenuItem icon={'\\( \\)'} hint="Ctrl+M, M" onClick={() => insertMath('mathjax-inline')}>Inline MathJax</MenuItem>
                <MenuItem icon={'\\[ \\]'} hint="Ctrl+M, E" onClick={() => insertMath('mathjax-block')}>Display MathJax</MenuItem>
                <MenuItem icon="[ƒ]" onClick={() => insertMath('latex')}>LaTeX</MenuItem>
                <MenuItem icon="[$]" onClick={() => insertMath('latex-math')}>LaTeX math</MenuItem>
                <MenuItem icon="[$$]" onClick={() => insertMath('latex-equation')}>LaTeX equation</MenuItem>
              </ToolbarMenu>
              <ToolbarMenu title="Table" icon={<Table size={16} />} onOpen={() => setInTable(Boolean(findCell(toolbarTargetRef.current)))}>
                <TableGridPicker onPick={(rows, cols) => insertTable(rows, cols)} />
                <div className="toolbar-menu-divider" role="separator" />
                <div className="toolbar-menu-grid">
                  <MenuItem disabled={!inTable} onClick={() => runTableAction('row-above')}>Row above</MenuItem>
                  <MenuItem disabled={!inTable} onClick={() => runTableAction('row-below')} hint="Tab">Row below</MenuItem>
                  <MenuItem disabled={!inTable} onClick={() => runTableAction('col-left')}>Column left</MenuItem>
                  <MenuItem disabled={!inTable} onClick={() => runTableAction('col-right')}>Column right</MenuItem>
                  <MenuItem disabled={!inTable} onClick={() => runTableAction('toggle-header')}>Header row</MenuItem>
                  <MenuItem disabled={!inTable} danger onClick={() => runTableAction('del-table')}>Delete table</MenuItem>
                  <MenuItem disabled={!inTable} danger onClick={() => runTableAction('del-row')}>Delete row</MenuItem>
                  <MenuItem disabled={!inTable} danger onClick={() => runTableAction('del-col')}>Delete column</MenuItem>
                </div>
              </ToolbarMenu>
              <button onClick={() => openAudioPicker()} title="Attach audio (F3)" className="toolbar-button"><Paperclip size={16} /></button>
              <button onClick={() => toggleRecording()} title={audioRecorder.recording ? 'Stop recording (F5)' : 'Record audio (F5)'} aria-pressed={audioRecorder.recording} className={`toolbar-button ${audioRecorder.recording ? 'is-recording' : ''}`}>{audioRecorder.recording ? <><StopSquare size={14} /><span className="font-mono text-[11px]">{Math.floor(audioRecorder.seconds / 60)}:{String(audioRecorder.seconds % 60).padStart(2, '0')}</span></> : <Mic size={16} />}</button>
              <input type="file" ref={audioInputRef} className="hidden" accept="audio/*" onChange={handleAudioFile} />
              <ToolbarMenu title="Smart typing" icon={<Sparkles size={16} />}>
                <MenuItem icon={smartPrefs.markdown ? '✓' : ''} onClick={() => setSmartPrefs(prefs => ({ ...prefs, markdown: !prefs.markdown }))}>Markdown shortcuts<small className="menu-sub">- or 1. then Space, **bold**, ==mark==, ---</small></MenuItem>
                <MenuItem icon={smartPrefs.typography ? '✓' : ''} onClick={() => setSmartPrefs(prefs => ({ ...prefs, typography: !prefs.typography }))}>Symbols<small className="menu-sub">-&gt; =&gt; != &gt;= &lt;= +- ...</small></MenuItem>
                <MenuItem icon={smartPrefs.paste ? '✓' : ''} onClick={() => setSmartPrefs(prefs => ({ ...prefs, paste: !prefs.paste }))}>Convert pasted markdown<small className="menu-sub">lists, tables, headings, bold</small></MenuItem>
              </ToolbarMenu>
              </div>
            </div>}

            {cardType === 'Image Occlusion' && <section className="io-source-card" data-editor-drop-target="front" tabIndex={0} aria-label="Image occlusion source image. Focus here and paste an image, or choose one." onPaste={pasteImageIntoOcclusion} onDragOver={e => e.preventDefault()} onDrop={e => handleSnippetDrop(e, 'front')}>
              <div className="io-source-heading"><div><span className="section-eyebrow">IMAGE OCCLUSION</span><h3>Choose an image, then add masks</h3></div><div className="io-source-actions">{occlusionImage && <><div className="io-region-count"><strong>{occlusionMasks.length}</strong><span>regions</span></div><button className="quiet-button" type="button" onClick={() => setOcclusionEditorOpen(true)}>Open editor</button></>}<button className="quiet-button" type="button" onClick={() => openImagePicker(frontRef)}><Upload size={16} /> Choose image</button></div></div>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, frontRef)} />
              {!occlusionImage ? <div className="io-image-empty"><Crop size={22}/><span>Paste an image here, drop an occluded capture, or choose a file</span></div> : <div className="io-image-preview"><div className="io-mask-draw-area" onPointerDown={e => { if (e.target.closest('.manual-mask-remove')) return; e.currentTarget.setPointerCapture(e.pointerId); manualMaskStartRef.current = manualMaskPoint(e); setManualMaskPreview({ x: manualMaskStartRef.current.x, y: manualMaskStartRef.current.y, width: 0, height: 0 }); }} onPointerMove={e => { if (!manualMaskStartRef.current) return; const p = manualMaskPoint(e), s = manualMaskStartRef.current; setManualMaskPreview({ x: Math.min(s.x,p.x), y: Math.min(s.y,p.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }); }} onPointerUp={finishManualMask} onPointerCancel={cancelManualMask}><img src={occlusionImage} alt="Image occlusion source" draggable="false"/>{occlusionMasks.map((mask,index) => <button type="button" className="manual-mask-remove" key={mask.id} title={`Remove region ${index+1}`} onPointerDown={e => e.stopPropagation()} onClick={() => setOcclusionMasks(prev => prev.filter(m => m.id !== mask.id))} style={{left:`${mask.x*100}%`,top:`${mask.y*100}%`,width:`${mask.width*100}%`,height:`${mask.height*100}%`,borderRadius:mask.shape === 'ellipse' ? '50%' : 0,clipPath:mask.shape === 'polygon' && mask.points?.length >= 3 ? `polygon(${mask.points.map(point => `${((point.x-mask.x)/Math.max(mask.width,.0001))*100}% ${((point.y-mask.y)/Math.max(mask.height,.0001))*100}%`).join(',')})` : undefined}}>{index+1} ×</button>)}{manualMaskPreview && <span className="manual-mask-draft" style={{left:`${manualMaskPreview.x*100}%`,top:`${manualMaskPreview.y*100}%`,width:`${manualMaskPreview.width*100}%`,height:`${manualMaskPreview.height*100}%`}}/>}</div><div><strong>{occlusionMasks.length} hidden region{occlusionMasks.length === 1 ? '' : 's'}</strong><span>Drag over image to add a mask; tap a mask to remove it.</span></div></div>}
              <p className="io-helper">Draw masks on a PDF capture, then drag it here. The source image and mask geometry stay attached to this card.</p>
              <label className="io-mode-select">Review mode <select value={occlusionMode} onChange={e => setOcclusionMode(e.target.value)}><option value="hide-all">Hide All, Guess One</option><option value="hide-one">Hide One, Guess One</option><option value="sequential">Reveal one by one (in order)</option><option value="random">Reveal one by one (random order)</option></select></label>
            </section>}

            {cardType === 'Image Occlusion' && occlusionImage && occlusionEditorOpen && createPortal(<div className="io-editor-backdrop" role="dialog" aria-modal="true" aria-label="Image occlusion editor" onPointerDown={e => { if (e.target === e.currentTarget) setOcclusionEditorOpen(false); }}><section className="io-editor-dialog"><header className="io-editor-header"><div><span className="section-eyebrow">IMAGE OCCLUSION</span><h2>Arrange masks</h2></div><div className="io-editor-actions"><label>Image size <input aria-label="Image width" type="range" min="180" max="1800" step="10" value={occlusionImageWidth} onChange={e => setOcclusionImageWidth(Number(e.target.value))}/><span>{occlusionImageWidth}px</span></label><button type="button" className="quiet-button" onClick={() => setOcclusionEditorOpen(false)}>Done</button></div></header><div className="io-editor-stage"><div className="io-editor-resize-frame" style={{width:`min(${occlusionImageWidth}px, calc(100vw - 64px))`}}><div className="io-mask-draw-area io-editor-mask-area" onPointerDown={e => { if (e.target.closest('.manual-mask-remove,.io-resize-handle')) return; e.currentTarget.setPointerCapture(e.pointerId); manualMaskStartRef.current = manualMaskPoint(e); setManualMaskPreview({ x: manualMaskStartRef.current.x, y: manualMaskStartRef.current.y, width: 0, height: 0 }); }} onPointerMove={e => { if (!manualMaskStartRef.current) return; const p = manualMaskPoint(e), s = manualMaskStartRef.current; setManualMaskPreview({ x: Math.min(s.x,p.x), y: Math.min(s.y,p.y), width: Math.abs(p.x-s.x), height: Math.abs(p.y-s.y) }); }} onPointerUp={finishManualMask} onPointerCancel={cancelManualMask}><img src={occlusionImage} alt="Image occlusion source" draggable="false"/>{occlusionMasks.map((mask,index) => <button type="button" className="manual-mask-remove" key={mask.id} title={`Remove region ${index+1}`} onPointerDown={e => e.stopPropagation()} onClick={() => setOcclusionMasks(prev => prev.filter(m => m.id !== mask.id))} style={{left:`${mask.x*100}%`,top:`${mask.y*100}%`,width:`${mask.width*100}%`,height:`${mask.height*100}%`,borderRadius:mask.shape === 'ellipse' ? '50%' : 0}}>{index+1} ×</button>)}{manualMaskPreview && <span className="manual-mask-draft" style={{left:`${manualMaskPreview.x*100}%`,top:`${manualMaskPreview.y*100}%`,width:`${manualMaskPreview.width*100}%`,height:`${manualMaskPreview.height*100}%`}}/>}</div>{['n','ne','e','se','s','sw','w','nw'].map(direction => <button type="button" key={direction} aria-label={`Resize image ${direction}`} className={`io-resize-handle ${direction}`} onPointerDown={e => beginImageResize(e,direction)} onPointerMove={moveImageResize} onPointerUp={endImageResize} onPointerCancel={endImageResize}/>)}</div></div><footer className="io-editor-footer"><span>{occlusionMasks.length} hidden region{occlusionMasks.length === 1 ? '' : 's'} · Drag to add a mask, select a mask to remove it. Resize handles keep the image proportions.</span><button type="button" className="primary-button" onClick={() => setOcclusionEditorOpen(false)}>Done</button></footer></section></div>, document.body)}

            {cardType !== 'Image Occlusion' && <section className="space-y-2 mb-4">
              <FieldHeader title={cardType === "Cloze" ? "Text (Ctrl+select for cloze)" : "Front"} collapsed={fieldPrefs.collapsed.front} onCollapse={() => toggleFieldPref('collapsed', 'front')} htmlOpen={htmlOpen.front} onHtml={() => toggleHtmlView('front')} pinned={fieldPrefs.pinned.front} onPin={() => toggleFieldPref('pinned', 'front')} />
              {fieldPrefs.collapsed.front && <button type="button" className="field-collapsed-preview" onClick={() => toggleFieldPref('collapsed', 'front')}>{duplicateKey(front).slice(0, 90) || 'Empty field: click to expand'}</button>}
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
                onInput={(event) => { handleSmartInput(event, frontRef); scheduleEditorSave('front'); }}
                onBlur={(e) => commitEditorSave('front', e.target.innerHTML)}
                onPaste={(e) => handleContentPaste(e, frontRef)}
                onClick={handleSelectionChange}
                onMouseUp={(e) => { handleMouseUpForCloze(e, frontRef); handleSelectionChange(e); }}
                onKeyUp={handleSelectionChange}
                className={`${baseInputStyle} min-h-[110px] p-3 editable-content inline-block min-w-full align-top focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20`}
                style={{whiteSpace: 'pre-wrap', ...((fieldPrefs.collapsed.front || htmlOpen.front) && { display: 'none' })}}
                {...(!contentInitialized && { dangerouslySetInnerHTML: { __html: front } })}
              />
              {htmlOpen.front && !fieldPrefs.collapsed.front && <HtmlView field="front" label="Front HTML" value={htmlDraft.front} onChange={(value) => changeHtmlView('front', value)} />}
              {duplicateMatches.length > 0 && <div className="field-warning" role="status"><span>This front already exists in your deck ({duplicateMatches.length} card{duplicateMatches.length > 1 ? 's' : ''}).</span><button type="button" onClick={() => { setShowCardBrowser(true); }}>Show</button></div>}
            </section>}

            <section className="space-y-2 mb-4">
              <FieldHeader title={cardType === "Cloze" || cardType === 'Image Occlusion' ? "Extra (Optional)" : "Back"} collapsed={fieldPrefs.collapsed.back} onCollapse={() => toggleFieldPref('collapsed', 'back')} htmlOpen={htmlOpen.back} onHtml={() => toggleHtmlView('back')} pinned={fieldPrefs.pinned.back} onPin={() => toggleFieldPref('pinned', 'back')} />
              {fieldPrefs.collapsed.back && <button type="button" className="field-collapsed-preview" onClick={() => toggleFieldPref('collapsed', 'back')}>{duplicateKey(back).slice(0, 90) || 'Empty field: click to expand'}</button>}
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
                onInput={(event) => { handleSmartInput(event, backRef); scheduleEditorSave('back'); }}
                onBlur={(e) => commitEditorSave('back', e.target.innerHTML)}
                onPaste={(e) => handleContentPaste(e, backRef)}
                onClick={handleSelectionChange}
                onMouseUp={handleSelectionChange}
                onKeyUp={handleSelectionChange}
                className={`${baseInputStyle} min-h-[110px] p-3 editable-content inline-block min-w-full align-top focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20`}
                style={{whiteSpace: 'pre-wrap', ...((fieldPrefs.collapsed.back || htmlOpen.back) && { display: 'none' })}}
                {...(!contentInitialized && { dangerouslySetInnerHTML: { __html: back } })}
              />
              {htmlOpen.back && !fieldPrefs.collapsed.back && <HtmlView field="back" label="Back HTML" value={htmlDraft.back} onChange={(value) => changeHtmlView('back', value)} />}
            </section>

            <PillFields values={pills} onChange={setPills} resetKey={pillsResetKey} collapseKey={pillsCollapseKey} pinned={fieldPrefs.pinned} onTogglePin={(i) => toggleFieldPref('pinned', `pill${i + 1}`)} onFocusBox={(node, sync) => { pillBoxRef.current = node; pillSyncRef.current = sync; setActiveEditor('pill'); }} onSaveRange={(range) => { savedRangeRef.current = range; }} />

            <section className="space-y-2 mb-6 relative">
                <label className="text-sm font-medium flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Tag size={16} />Tags
                  </span>
                  <button
                    onClick={() => { setShowCardBrowser(true); }}
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
                            onClick={() => { setEditingIndex(null); setFormMessage(''); setFront(""); setBack(""); setCurrentTags([]); if (cardType === 'Image Occlusion') { setCardType(previousCardTypeRef.current); setOcclusionImage(null); setOcclusionMasks([]); } if(frontRef.current) frontRef.current.innerHTML = ""; if(backRef.current) backRef.current.innerHTML = ""; }}
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

        {pdfOpen && <div className={mobileView === 'pdf' ? '' : 'pdf-panel-mobile-hidden'}><PdfPanelErrorBoundary onClose={closePdfWorkspace}><Suspense fallback={<section className="pdf-study-panel pdf-loading-state">Loading PDF tools…</section>}><PdfStudyPanel fieldOptions={cardType === 'Basic' ? [{ target: 'front', label: 'Front' }, { target: 'back', label: 'Back' }] : cardType === 'Cloze' ? [{ target: 'front', label: 'Text' }, { target: 'back', label: 'Extra' }] : [{ target: 'front', label: 'Image' }, { target: 'back', label: 'Extra' }]} onInsertSnippet={insertStudySnippet} isSmallScreen={false} onMobileView={setMobileView} incomingFile={incomingPdf} pillOptions={loadSettings().pills.map((pill, i) => ({ target: `pill${i + 1}`, label: pill.label, color: pill.color }))} /></Suspense></PdfPanelErrorBoundary></div>}
        <div className={`cards-panel ${mobileView !== 'cards' ? 'mobile-hidden' : ''} ${pdfOpen ? `library-drawer ${showLibrary ? 'library-open' : ''}` : ''}`}>
          <div className="library-heading">
            <div><p className="section-eyebrow">YOUR DECK</p><h2><BookOpen size={19} /> Card library <span className="library-count">{cards.length}</span></h2></div>
            {cards.length > 0 && <button type="button" className="tag-browse-button text-xs flex items-center gap-1" onClick={() => setShowCardBrowser(true)} title="Open the full-screen card browser"><BookOpen size={14} /> Browse all</button>}
          </div>
          <label className="card-search-wrap"><Search size={16} /><input ref={cardSearchRef} value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} placeholder="Find a card or tag..." aria-label="Search cards and tags" /><kbd>/</kbd></label>
          <div className="card-list">
            {cardListItems}
            {cards.length === 0 && <div className="empty-library"><div className="empty-icon"><Sparkles size={19} /></div><h3>Your deck starts here</h3><p>Add your first card and it will appear here.</p><button onClick={() => setMobileView('editor')}>Create a card <ChevronRight size={15} /></button></div>}
            {cards.length > 0 && visibleCards.length === 0 && <div className="empty-library"><Search size={18} /><p>No cards match "{cardSearch}".</p></div>}
          </div>
        </div>

      </main >

      {showPreview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900" role="dialog" aria-modal="true" aria-label="Current card preview">
          <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-800">
            <header className="flex items-center justify-between border-b border-neutral-700 bg-neutral-900 px-5 py-3">
              <h2 className="text-lg font-semibold text-neutral-100">Current Card Preview</h2>
              <button type="button" onClick={() => setShowPreview(false)} className="card-browser-close" aria-label="Close preview" title="Close preview"><XCircle size={22} /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 text-center">
              <div className="preview-content mx-auto w-full max-w-5xl space-y-6">
                {cardType === 'Image Occlusion' ? <>
                  <div className="io-reviewer-controls">
                    <button type="button" aria-label="Previous occlusion card" disabled={previewOcclusionIndex <= 0} onClick={() => { setPreviewOcclusionIndex(index => Math.max(0, index - 1)); setPreviewAnswerSide(false); }}>‹</button>
                    <span>Card <strong>{Math.min(previewOcclusionIndex + 1, Math.max(1, occlusionCardCount))}</strong> of {occlusionCardCount}</span>
                    <button type="button" aria-label="Next occlusion card" disabled={previewOcclusionIndex >= occlusionCardCount - 1} onClick={() => { setPreviewOcclusionIndex(index => Math.min(Math.max(0, occlusionCardCount - 1), index + 1)); setPreviewAnswerSide(false); }}>›</button>
                    <div className="io-reviewer-flip"><button type="button" aria-pressed={!previewAnswerSide} onClick={() => setPreviewAnswerSide(false)}>Question</button><button type="button" aria-pressed={previewAnswerSide} onClick={() => setPreviewAnswerSide(true)}>Show answer</button></div>
                  </div>
                  <div className="io-reviewer-image">
                    {occlusionImage ? <OcclusionPreview image={occlusionImage} imageWidth={occlusionImageWidth} masks={occlusionMasks} mode={occlusionMode} cardIndex={previewOcclusionIndex} answerSide={previewAnswerSide} /> : <span>Add an image to preview this card.</span>}
                  </div>
                  {previewAnswerSide && back && <div className="io-reviewer-extra"><span>Back extra</span><div dangerouslySetInnerHTML={{ __html: back }} /></div>}
                  {previewAnswerSide && <PreviewPills pills={pills} night={previewNight} />}
                </> : <>
                  {(() => {
                    const numbers = cardType === 'Cloze' ? clozeNumbers(cleanColorSpans(front)) : [];
                    const activeNumber = numbers[Math.min(previewOcclusionIndex, Math.max(0, numbers.length - 1))] || 1;
                    const sequentialPreview = cardType === 'Cloze' && clozeSequential;
                    const cardCount = sequentialPreview ? 1 : Math.max(1, numbers.length);
                    return <>
                      <div className="io-reviewer-controls">
                        {cardType === 'Cloze' && <><button type="button" aria-label="Previous cloze card" disabled={previewOcclusionIndex <= 0 || sequentialPreview} onClick={() => setPreviewOcclusionIndex(index => Math.max(0, index - 1))}>‹</button>
                        <span>Card <strong>{Math.min(previewOcclusionIndex + 1, cardCount)}</strong> of {cardCount}{sequentialPreview ? ' · one by one' : ''}</span>
                        <button type="button" aria-label="Next cloze card" disabled={previewOcclusionIndex >= cardCount - 1 || sequentialPreview} onClick={() => setPreviewOcclusionIndex(index => Math.min(cardCount - 1, index + 1))}>›</button></>}
                        <div className="io-reviewer-flip"><button type="button" aria-pressed={!previewAnswerSide} onClick={() => setPreviewAnswerSide(false)}>Question</button><button type="button" aria-pressed={previewAnswerSide} onClick={() => setPreviewAnswerSide(true)}>Show answer</button></div>
                        <div className="io-reviewer-flip"><button type="button" aria-pressed={previewNight} onClick={() => setPreviewNight(true)}>Night</button><button type="button" aria-pressed={!previewNight} onClick={() => setPreviewNight(false)}>Day</button></div>
                      </div>
                      <div className="io-reviewer-controls">
                        <div className="io-reviewer-flip">{Object.entries(PREVIEW_DEVICES).map(([key, item]) => <button type="button" key={key} aria-pressed={previewDevice === key} onClick={() => setPreviewDevice(key)}>{item.label}</button>)}</div>
                      </div>
                      <CardPreviewFrame type={cardType} front={cleanColorSpans(front)} back={back} pills={pills} sequential={sequentialPreview} side={previewAnswerSide ? 'answer' : 'question'} night={previewNight} clozeOrd={activeNumber} device={previewDevice} />
                      <p className="text-xs text-neutral-400">Exactly as the exported card renders, using your Settings (text size, pill size, colours, fonts).</p>
                    </>;
                  })()}
                </>}
                <div className="text-xs text-neutral-400 pt-4">Tags: {currentTags.map(formatTagForDisplay).join(", ") || "None"}</div>
              </div>
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
                                className={`px-3 py-1 text-sm rounded-lg border-2 transition ${colorPickerTarget === `basic-${index}` ? 'border-sky-500 bg-sky-700 text-white' : 'border-neutral-600 hover:bg-neutral-700'}`}
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
        <CardBrowser cards={cards} setCards={setCards} deckName={deckName} folders={folders} onMove={moveCards} onClose={() => setShowCardBrowser(false)}
          onEdit={(index) => { loadCardForEdit(index); setShowCardBrowser(false); }}
          helpers={{ getCardPreview, formatTag: formatTagForDisplay, pillLabel: (i) => loadSettings().pills[i]?.label || `Pill ${i + 1}` }} />
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

      <ImportCardsModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} existingCards={cards} onImport={importCards} />
      <DocumentationModal 
          isVisible={showDocumentationModal} 
          onClose={() => setShowDocumentationModal(false)} 
      />
    </div >
  );
}
