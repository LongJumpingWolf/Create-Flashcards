import { useEffect } from 'react';
import { Braces, Crop, Download, FileText, Pen, Tag, XCircle } from './Icons';

const GuideSection = ({ number, title, description, icon, children }) => {
  return (
    <section className="guide-section">
      <div className="guide-section-mark">{icon}</div>
      <div className="guide-section-copy">
        <div className="guide-section-heading"><span>{number}</span><h3>{title}</h3></div>
        <p>{description}</p>
        {children && <div className="guide-section-detail">{children}</div>}
      </div>
    </section>
  );
};

const Shortcut = ({ keys, children }) => (
  <div className="guide-shortcut"><span>{children}</span><span className="guide-key-group">{keys.map((key, index) => <kbd key={`${key}-${index}`}>{key}</kbd>)}</span></div>
);

export default function DocumentationModal({ isVisible, onClose }) {
  useEffect(() => {
    if (!isVisible) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.ctrlKey || event.metaKey || event.key === '/') { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="guide-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="guide-header">
          <div>
            <p className="section-eyebrow">ANKI STUDIO · QUICK REFERENCE</p>
            <h2 id="guide-title">Make a card. Keep your place.</h2>
            <p className="guide-intro">Write, capture from a source, and export your deck without leaving the workspace.</p>
          </div>
          <button className="guide-close" onClick={onClose} aria-label="Close guide"><XCircle size={20} /></button>
        </header>

        <div className="guide-body">
          <div className="guide-steps">
            <GuideSection number="01" title="Build a card" description="Choose a card type, write the prompt and answer, then add it to your deck." icon={<FileText size={17} />}>
              <div><strong>Basic</strong><span>Question on the front, answer on the back.</span></div>
              <div><strong>Cloze</strong><span>Select key text while holding Ctrl or ⌘ to hide it.</span></div>
              <div><strong>Image Occlusion</strong><span>Cover parts of an image to test visual recall.</span></div>
            </GuideSection>

            <GuideSection number="02" title="Format in place" description="Click where you want to type. Select text to style it with the single formatting bar." icon={<Pen size={17} />}>
              <p>Paste images directly into a card. Use the Extra field for a hint, explanation, or source. Pin a field (pin icon) to keep it after adding, collapse it (eye icon), or edit its raw HTML (&lt;/&gt;). Add tables, MathJax, audio, highlights, sub/superscript and lists from the toolbar.</p>
            </GuideSection>

            <GuideSection number="03" title="Study from a PDF" description="Open a PDF beside the editor and capture a region at any zoom level." icon={<Crop size={17} />}>
              <p>Choose <strong>Snip region</strong>, drag over the page, annotate if needed, then save. Drag the capture onto a card field; captures with hide regions switch the draft to Image Occlusion.</p>
            </GuideSection>

            <GuideSection number="04" title="Occlude and review" description="Hide one or more regions, label them if useful, and choose how Anki reveals them." icon={<Braces size={17} />}>
              <p><strong>Hide All, Guess One</strong> creates a review card for each region with the others hidden. <strong>Hide One, Guess One</strong> tests one region at a time. Exports use Anki’s native Image Occlusion note type and cloze-based regions. <strong>One by one, in order</strong> and <strong>random</strong> keep every region on a single card that you reveal by clicking (or N; comma reveals all). For cloze cards, turn on <strong>Reveal one by one</strong> to get the same behavior for text.</p>
            </GuideSection>
          </div>

          <aside className="guide-aside">
            <div className="guide-shortcuts">
              <p className="section-eyebrow">KEYBOARD</p>
              <Shortcut keys={['Ctrl', 'Enter']}>Add card</Shortcut>
              <Shortcut keys={['Ctrl', 'S']}>Add card</Shortcut>
              <Shortcut keys={['Ctrl', 'E']}>Export deck</Shortcut>
              <Shortcut keys={['/']}>Search cards</Shortcut>
            </div>
            <div className="guide-shortcuts">
              <p className="section-eyebrow">WHILE EDITING A FIELD</p>
              <Shortcut keys={['Ctrl', 'Shift', 'X']}>Edit field HTML</Shortcut>
              <Shortcut keys={['Ctrl', 'R']}>Clear formatting</Shortcut>
              <Shortcut keys={['Ctrl', '=']}>Subscript</Shortcut>
              <Shortcut keys={['Ctrl', 'Shift', '=']}>Superscript</Shortcut>
              <Shortcut keys={['Ctrl', 'Shift', 'C']}>New cloze</Shortcut>
              <Shortcut keys={['Ctrl', 'Alt', 'Shift', 'C']}>Same-number cloze</Shortcut>
              <Shortcut keys={['Ctrl', 'M', 'M']}>Inline MathJax</Shortcut>
              <Shortcut keys={['Ctrl', 'M', 'E']}>Display MathJax</Shortcut>
              <Shortcut keys={['Ctrl', 'Shift', 'V']}>Paste as plain text</Shortcut>
              <Shortcut keys={['Tab']}>Next table cell (adds a row at the end)</Shortcut>
              <Shortcut keys={['Shift', 'Tab']}>Previous table cell</Shortcut>
              <Shortcut keys={['F3']}>Attach audio</Shortcut>
              <Shortcut keys={['F5']}>Record audio</Shortcut>
            </div>
            <div className="guide-shortcuts guide-snip-shortcuts">
              <p className="section-eyebrow">WHILE ANNOTATING</p>
              <Shortcut keys={['1–9']}>Switch tools from Select</Shortcut>
              <Shortcut keys={['Ctrl', 'Z']}>Undo</Shortcut>
              <Shortcut keys={['Ctrl', 'Y']}>Redo</Shortcut>
              <Shortcut keys={['Enter']}>Save capture</Shortcut>
              <Shortcut keys={['Esc']}>Return to Select</Shortcut>
            </div>
            <div className="guide-note"><Tag size={15} /><p>Your cards and drafts are saved in this browser. Export an <code>.apkg</code> file to study them in Anki.</p></div>
            <div className="guide-export"><Download size={16} /><span>Ready to study</span><p>Use <strong>Export .apkg</strong>, then open the downloaded file in Anki.</p></div>
          </aside>
        </div>

        <footer className="guide-footer"><span>Tip: the PDF stays beside your card while you write.</span><button onClick={onClose}>Back to cards <span aria-hidden="true">↗</span></button></footer>
      </section>
    </div>
  );
}
