// frontend/src/components/DocumentationModal.jsx

import React from 'react';
// Import Braces, Eraser, adjust existing imports
import { XCircle, ChevronRight, Ban, Palette, Link, PlusCircle, Download, Tag, Settings, Edit, Trash2, Eraser, Braces } from "./Icons";
// Note: Removed 'Code' import, added 'Braces'

// Updated and comprehensive instructions based on the latest FlashcardEditor features.
const DOCUMENTATION_TEXT = `
ANKI DECK BUILDER - FULL GUIDE

1. Core Workflow
    - Deck Name: Set the name of your Anki deck.
    - Card Type: Switch between "Basic" (Q/A) and "Cloze" (Fill-in-the-blank).
    - Add/Update: Click "Add Card" (Ctrl+S) to save the current card. If you click a card on the right, the button changes to "Update Card".
    - Export: Click "Export Deck" (Ctrl+E) to download the finished .apkg file for Anki.
    - Start New Deck: The red Trash icon clears all unsaved cards and local storage state.

2. Formatting Toolbar (Front & Back/Extra Fields)
    - Colors:
        - Preset Swatches: Left-click a color swatch to apply it to selected text or set the typing color.
        - Manage Colors: Right-click a color swatch to open the color picker and set a custom Hex code or change the preset slot.
        - ${Eraser.name} (Clear Color): Acts as a color swatch to set the typing color back to the default/transparent.
        - ${Ban.name} (Clear All): Clears all formatting (color, bold, italic) from the selected text.
    - Text Style: ${ChevronRight.name} B, I, U buttons apply Bold, Italic, and Underline.
    - Lists: ${ChevronRight.name} ☰ inserts an Unordered List.
    - Images: You can directly **Copy and Paste images** into both the Front and Back/Extra fields.

3. Cloze Cards (Type: Cloze)
    - Cloze Deletion:
        - Shortcut: Select the text you want to hide, then hold **CTRL** (or **CMD** on Mac). The text will be wrapped in a cloze deletion (e.g., {{c1::text}}).
        - Manual: Click the { } button. If no text is selected, it inserts "{{c#::text}}" and selects the placeholder 'text' for easy replacement.
    - ${Palette.name} (Cloze Color): Click this icon to change the default color used for all cloze deletions (visible in the editor).

4. Hyperlinks (Back/Extra Field Only)
    - ${Link.name} (Insert Hyperlink): Click this button in the Back/Extra field toolbar to open a small modal.
    - Format: Insert a URL and a 'Link Name'. The link appears on the card as a clickable, contrast-safe blue link in the format **(Link Name)**.

5. Tagging (${Tag.name} Tags)
    - Add Tags: Type a tag (e.g., 'Medicine') and press **ENTER** or **comma**.
    - Tag Hierarchy: Use '::' to create a hierarchy (e.g., 'Biology::Cells'). You-can also use the **TAB** key as a shortcut for '::'.

6. Tag Management (${Settings.name} Browse & Select)
    - Current Card Tags: Tags currently applied to the card are displayed at the top for quick removal.
    - Global Management: For any tag in the hierarchy view (leaf nodes):
        - ${Edit.name}: Rename the tag globally (updates on all cards).
        - ${Trash2.name}: Delete the tag globally (removes it from all cards and the list).
`;

const InstructionItem = ({ title, content, icon }) => (
    <div className="mb-4 p-3 bg-neutral-700/50 rounded-lg">
        <h4 className="flex items-center gap-2 text-lg font-semibold text-sky-300 mb-1">
            {icon} {title}
        </h4>
        <div className="text-neutral-200 whitespace-pre-wrap pl-1 leading-relaxed">
            {content}
        </div>
    </div>
);

export default function DocumentationModal({ isVisible, onClose }) {
    if (!isVisible) return null;

    // Split the documentation text into sections for structured rendering
    const sections = DOCUMENTATION_TEXT.split('\n\n').filter(s => s.trim());
    const [core, formatting, cloze, hyperlink, tagging, tagManagement] = sections;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4">
            <div className="bg-neutral-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-neutral-700">
                <div className="p-6 border-b border-neutral-700 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white">ANKI DECK BUILDER - HELP & GUIDE</h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-neutral-400 hover:text-white transition"
                    >
                        <XCircle size={28} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <InstructionItem
                        title="Core Workflow"
                        content={core.replace('1. Core Workflow\n', '').trim()}
                        icon={<PlusCircle size={20} />}
                    />
                    <InstructionItem
                        title="Formatting Toolbar"
                        content={formatting.replace('2. Formatting Toolbar (Front & Back/Extra Fields)\n', '').trim()}
                        icon={<Palette size={20} />}
                    />
                    {/* FINAL ICON UPDATE: Braces for Cloze Section */}
                    <InstructionItem
                        title="Cloze Cards"
                        content={cloze.replace('3. Cloze Cards (Type: Cloze)\n', '').trim()}
                        icon={<Braces size={20} />} 
                    />
                    <InstructionItem
                        title="Hyperlinks"
                        content={hyperlink.replace('4. Hyperlinks (Back/Extra Field Only)\n', '').trim()}
                        icon={<Link size={20} />}
                    />
                    <InstructionItem
                        title="Tagging"
                        content={tagging.replace('5. Tagging (Tags)\n', '').trim()}
                        icon={<Tag size={20} />}
                    />
                    <InstructionItem
                        title="Tag Management"
                        content={tagManagement.replace('6. Tag Management (Browse & Select)\n', '').trim()}
                        icon={<Settings size={20} />}
                    />
                </div>

                <div className="p-4 border-t border-neutral-700">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition font-semibold"
                    >
                        Close Guide
                    </button>
                </div>
            </div>
        </div>
    );
}
