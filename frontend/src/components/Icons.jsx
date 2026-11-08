const iconPaths = {
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 14h10l1-14", "M9 7V4h6v3"],
  file: ["M7 3.5h7l4 4V21H7z", "M14 3.5V8h4", "M10 12h5", "M10 16h5"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 19v2h16v-2"],
  plus: ["M12 5v14", "M5 12h14"],
  tag: ["M20.5 13 13 20.5a2 2 0 0 1-2.8 0L3.5 13.8V3.5h10.3l6.7 6.7a2 2 0 0 1 0 2.8Z"],
  settings: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.9.2l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1.1 1.7 1.7 0 0 0-1.1.4l-.2.1-2.9-1.7.1-.2a1.7 1.7 0 0 0-.2-1.9l-.1-.1v-3.4l.2-.1a1.7 1.7 0 0 0 1.1-1.6 1.7 1.7 0 0 0-.4-1.1l-.1-.2 1.7-2.9.2.1a1.7 1.7 0 0 0 1.9-.2l.1-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1.1 1.7 1.7 0 0 0 1.1-.4l.2-.1 2.9 1.7-.1.2a1.7 1.7 0 0 0 .2 1.9l.1.1v3.4Z"],
  close: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m9 9 6 6", "m15 9-6 6"],
  palette: ["M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H18a3 3 0 0 0 3-3c0-5.1-4-9.2-9-9.2Z"],
  ban: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m5.6 5.6 12.8 12.8"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1.2 1.1-1.8 1.4-1.8 3"],
  edit: ["m14 5 5 5", "M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z"],
  right: ["m9 18 6-6-6-6"],
  left: ["m15 18-6-6 6-6"],
  down: ["m6 9 6 6 6-6"],
  link: ["M10 13.5 14 9.5", "M8.5 15H7a4 4 0 0 1 0-8h4", "M15.5 9H17a4 4 0 0 1 0 8h-4"],
  braces: ["m8 6-5 6 5 6", "m16 6 5 6-5 6", "m14 4-4 16"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M4 16v4h16v-4"],
  up: ["m6 15 6-6 6 6"],
  arrowUp: ["M12 19V5", "m5 12 7-7 7 7"],
  arrowDown: ["M12 5v14", "m19 12-7 7-7-7"],
  align: ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"],
  layers: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
  search: ["M20 20l-4.3-4.3", "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"],
  check: ["m5 12 4 4L19 6"],
  loader: ["M20 12a8 8 0 1 1-5.7-7.7"],
  eye: ["M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  book: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z", "M4 17.5A2.5 2.5 0 0 1 6.5 15H20", "M8 7h8", "M8 10h6"],
  sparkles: ["m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z", "m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z", "m5 14 .7 1.3L7 16l-1.3.7L5 18l-.7-1.3L3 16l1.3-.7L5 14Z"],
  eraser: ["m3 15 8-10a2 2 0 0 1 2.9-.2l7 6a2 2 0 0 1 .2 2.9L14 21H8l-5-4a1.5 1.5 0 0 1 0-2Z", "m8 10 8 7"],
  crop: ["M7 3v14a2 2 0 0 0 2 2h12", "M3 7h14a2 2 0 0 1 2 2v12"],
  pen: ["m12 19 7-7 3 3-7 7-4 1 1-4Z", "m18 13-3-3", "M5 5h6", "M5 9h4"],
  minus: ["M5 12h14"],
  undo: ["M9 14 4 9l5-5", "M4 9h9a7 7 0 0 1 0 14h-2"],
  redo: ["m15 14 5-5-5-5", "M20 9h-9a7 7 0 0 0 0 14h2"],
  rotate: ["M20 7v5h-5", "M20 12a8 8 0 1 1-2.3-5.7L20 9"],
  select: ["M5 3v17l5-5 3 6 3-1.5-3-6.2h7L5 3Z"],
  marker: ["m4 16 9-9 5 5-9 9H4z", "m11 9 5 5", "M4 21h16"],
  line: ["M5 19 19 5"],
  arrow: ["M5 19 19 5", "M10 5h9v9"],
  rect: ["M4 5h16v14H4z"],
  ellipse: ["M12 4c5.1 0 9 3.4 9 8s-3.9 8-9 8-9-3.4-9-8 3.9-8 9-8Z"],
  text: ["M4 6h16", "M12 6v14", "M8 20h8"],
  maskRect: ["M4 5h16v14H4z", "M8 9h8v6H8z"],
  maskEllipse: ["M12 4c5.1 0 9 3.4 9 8s-3.9 8-9 8-9-3.4-9-8 3.9-8 9-8Z", "M9 9h6v6H9z"],
  polygon: ["m12 3 8 6-3 11H7L4 9z"],
  group: ["M4 4h10v10H4z", "M10 10h10v10H10z"],
  code: ["m8 7-5 5 5 5", "m16 7 5 5-5 5", "m14 4-4 16"],
  pin: ["M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z", "M12 14v7"],
  eyeOff: ["M2.5 12s3.4-6 9.5-6c1.5 0 2.8.4 4 .9", "M21.5 12s-3.4 6-9.5 6c-1.5 0-2.8-.4-4-.9", "M9.9 9.9a3 3 0 0 0 4.2 4.2", "m3 3 18 18"],
  mic: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z", "M5 11a7 7 0 0 0 14 0", "M12 18v3"],
  stop: ["M7 7h10v10H7z"],
  paperclip: ["m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"],
  superscript: ["m4 18 8-9", "m12 18-8-9", "M16 7c0-1 .8-1.8 1.9-1.8s1.9.7 1.9 1.6c0 1.6-3.8 2.6-3.8 4.2h3.9"],
  subscript: ["m4 6 8 9", "m12 6-8 9", "M16 17c0-1 .8-1.8 1.9-1.8s1.9.7 1.9 1.6c0 1.6-3.8 2.6-3.8 4.2h3.9"],
  listOrdered: ["M10 6h11", "M10 12h11", "M10 18h11", "M4 5.5 5.5 5v4", "M4 14h2.5l-2.5 3h2.5"],
  listBullets: ["M10 6h11", "M10 12h11", "M10 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  alignLeft: ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"],
  alignRight: ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"],
  alignJustify: ["M4 6h16", "M4 10h16", "M4 14h16", "M4 18h16"],
  indent: ["M4 6h16", "M11 10h9", "M11 14h9", "M4 18h16", "m4 9 3 3-3 3"],
  outdent: ["M4 6h16", "M11 10h9", "M11 14h9", "M4 18h16", "m7 9-3 3 3 3"],
  sigma: ["M18 6H6l6 6-6 6h12"],
  strike: ["M5 12h14", "M16 6.5c-.6-1.4-2.2-2.5-4.1-2.5-2.4 0-4 1.3-4 3.2 0 1.2.6 2.1 1.7 2.8", "M8 17.5c.7 1.5 2.3 2.5 4.3 2.5 2.5 0 4.2-1.4 4.2-3.3 0-.8-.3-1.5-.8-2"],
  highlight: ["m4 20 4-1 10-10-3-3L5 16l-1 4Z", "m14 5 5 5", "M13 21h8"],
  copy: ["M9 9h11v11H9z", "M5 15V4h11"],
  ungroup: ["M4 4h10v10H4z", "m14 14 6 6", "m20 14-6 6"],
};

function Glyph({ name, size = 16, className = '', strokeWidth = 1.65, ...props }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      {iconPaths[name]?.map((path, index) => <path key={index} d={path} />)}
      {name === 'tag' && <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />}
      {name === 'palette' && [['7.5', '12'], ['9.5', '7.5'], ['14.5', '7.5'], ['17', '11']].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" stroke="none" />)}
      {name === 'help' && <circle cx="12" cy="17.5" r=".7" fill="currentColor" stroke="none" />}
    </svg>
  );
}

const icon = (name) => function AppGlyph(props) { return <Glyph name={name} {...props} />; };
export const Trash2 = icon('trash');
export const FileText = icon('file');
export const Download = icon('download');
export const PlusCircle = icon('plus');
export const Tag = icon('tag');
export const Settings = icon('settings');
export const XCircle = icon('close');
export const Palette = icon('palette');
export const Ban = icon('ban');
export const HelpCircle = icon('help');
export const Edit = icon('edit');
export const ChevronRight = icon('right');
export const ChevronLeft = icon('left');
export const ChevronDown = icon('down');
export const Link = icon('link');
export const Braces = icon('braces');
export const Upload = icon('upload');
export const ArrowUp = icon('arrowUp');
export const ArrowDown = icon('arrowDown');
export const AlignCenter = icon('align');
export const Layers3 = icon('layers');
export const Search = icon('search');
export const Check = icon('check');
export const LoaderCircle = icon('loader');
export const Eye = icon('eye');
export const BookOpen = icon('book');
export const Sparkles = icon('sparkles');
export const Eraser = icon('eraser');
export const Crop = icon('crop');
export const Pen = icon('pen');
export const Minus = icon('minus');
export const Undo = icon('undo');
export const Redo = icon('redo');
export const Rotate = icon('rotate');
export const Select = icon('select');
export const Highlighter = icon('marker');
export const Line = icon('line');
export const Arrow = icon('arrow');
export const Rectangle = icon('rect');
export const Ellipse = icon('ellipse');
export const Text = icon('text');
export const MaskRectangle = icon('maskRect');
export const MaskEllipse = icon('maskEllipse');
export const Polygon = icon('polygon');
export const Group = icon('group');
export const Ungroup = icon('ungroup');
export const Code = icon('code');
export const Pin = icon('pin');
export const EyeOff = icon('eyeOff');
export const Mic = icon('mic');
export const StopSquare = icon('stop');
export const Paperclip = icon('paperclip');
export const Superscript = icon('superscript');
export const Subscript = icon('subscript');
export const ListOrdered = icon('listOrdered');
export const ListBullets = icon('listBullets');
export const AlignLeft = icon('alignLeft');
export const AlignRight = icon('alignRight');
export const AlignJustify = icon('alignJustify');
export const Indent = icon('indent');
export const Outdent = icon('outdent');
export const Sigma = icon('sigma');
export const Strikethrough = icon('strike');
export const Highlight = icon('highlight');
export const Copy = icon('copy');
