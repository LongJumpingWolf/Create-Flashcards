// Anki card templates for the one-by-one note types (AnKing-style sequential cloze and
// sequential / random image occlusion). backend/sequential_templates.py is generated from
// this file by 'node frontend/scripts/gen-python-templates.mjs' - keep both in sync.
// The look of the AnKing note types (values read from the real AnKingOverhaul CSS):
// Arial, centred text, light grey card / near-black night card, bold blue clozes,
// italic navy (night: magenta) Extra, left-aligned lists, "mnemonics" blocks, no inline colours in fields.
const ANKING_CARD_CSS = `
/* ~~~ size: change this one number to scale every card (AnKing default 28px) ~~~ */
html { font-size: 28px; }
.mobile { font-size: 28px; }
.card { font-family: "Arial Greek", Arial, sans-serif; font-size: 1rem; text-align: center; margin: 15px 15px 0; padding-bottom: 1em; }
/* day mode */
.card { color: black; background-color: #D1CFCE; }
.cloze { font-weight: bold; color: blue; }
#extra { font-style: italic; font-size: 1rem; color: navy; margin-top: 1rem; }
/* night mode */
.nightMode.card, .night_mode .card { color: #FFFAFA !important; background-color: #272828 !important; }
.nightMode .cloze, .night_mode .cloze { color: #4297F9 !important; }
.nightMode #extra, .night_mode #extra { color: magenta; }
/* bold / underline / italic keep the text colour (they carry meaning, not colour) */
b, u, i { color: inherit; }
hr { opacity: .7; }
img { max-width: 85%; max-height: 100%; }
#extra img { max-width: 85%; min-width: 30%; }
ul, ol { display: inline-block; max-width: 50%; padding-left: 40px; margin: auto; text-align: left; }
.mobile ul, .mobile ol, .mobile img { max-width: 100%; }
/* left-aligned block for mnemonic / list lines inside a centred card */
.mnemonics { display: inline-block; text-align: left; }
.centerbox { text-align: center; }
a:not([href]), a[href^="javascript:"] { text-decoration: none; color: inherit; }
table { border-collapse: collapse; margin: 8px auto; }
td, th { border: 1px solid #888; padding: 4px 9px; text-align: left; vertical-align: top; }
th { font-weight: bold; background: rgba(128, 128, 128, .18); }
blockquote { margin: 6px auto; padding: 2px 12px; border-left: 3px solid #888; text-align: left; display: inline-block; }
code { font-family: monospace; background: rgba(128, 128, 128, .2); padding: 0 4px; border-radius: 3px; }
`;

const BASIC_QFMT = `<div id="text">{{Question}}</div>`;
const BASIC_AFMT = `<div id="text">{{Question}}</div>
<hr id="answer">
<div id="answer-text">{{Answer}}</div>`;
const CLOZE_QFMT = `<div id="text">{{cloze:Text}}</div>`;
const CLOZE_AFMT = `<div id="text">{{cloze:Text}}</div>
{{#Extra}}<hr id="answer"><div id="extra">{{Extra}}</div>{{/Extra}}`;

const SEQ_CLOZE_CSS_EXTRA = `
.sc { font-weight: bold; color: blue; }
.sc-hidden { cursor: pointer; }
.sc-active { text-decoration: underline; outline: 2px solid #f39c12; outline-offset: 2px; border-radius: 4px; }
.sc-shown { color: blue; }
.nightMode .sc, .night_mode .sc, .nightMode .sc-shown, .night_mode .sc-shown { color: #4297F9 !important; }
#sc-help { margin-top: 14px; font-size: .45rem; opacity: .6; }
`;

const KEY_CLEANUP = `<script>if (window.__sqKey) { document.removeEventListener('keydown', window.__sqKey); window.__sqKey = null; }</script>`;

const SEQ_CLOZE_QFMT = `<div id="sc-text">{{Text}}</div>
<div id="sc-help">Click the highlighted cloze or press N to reveal the next one &middot; , reveals all</div>
<script>
(function () {
  var autoFlip = true; // flip to the back after the last cloze (desktop and AnkiDroid; ignored on AnkiMobile)
  var root = document.getElementById('sc-text');
  if (!root) return;
  var spans = Array.prototype.slice.call(root.querySelectorAll('.sc'));
  if (!spans.length) return;
  var order = [];
  spans.forEach(function (span) {
    var n = Number(span.getAttribute('data-n')) || 1;
    if (order.indexOf(n) < 0) order.push(n);
  });
  order.sort(function (a, b) { return a - b; });
  spans.forEach(function (span) {
    var hint = span.getAttribute('data-hint');
    span.sqAnswer = span.innerHTML;
    span.textContent = hint ? '[' + hint + ']' : '[...]';
    span.className = 'sc sc-hidden';
  });
  function groupOf(span) { return Number(span.getAttribute('data-n')) || 1; }
  function isHidden(span) { return span.className.indexOf('sc-hidden') >= 0; }
  function hiddenIn(n) { return spans.filter(function (span) { return isHidden(span) && groupOf(span) === n; }); }
  function nextGroup() {
    for (var i = 0; i < order.length; i++) { if (hiddenIn(order[i]).length) return order[i]; }
    return null;
  }
  function mark() {
    var next = nextGroup();
    spans.forEach(function (span) {
      var hidden = isHidden(span);
      span.className = 'sc ' + (hidden ? 'sc-hidden' : 'sc-shown') + (hidden && groupOf(span) === next ? ' sc-active' : '');
    });
  }
  function show(n) { hiddenIn(n).forEach(function (span) { span.innerHTML = span.sqAnswer; span.className = 'sc sc-shown'; }); }
  function done() { if (autoFlip && typeof pycmd === 'function') setTimeout(function () { pycmd('ans'); }, 350); }
  function revealNext() {
    var n = nextGroup();
    if (n === null) { done(); return; }
    show(n); mark();
    if (nextGroup() === null) done();
  }
  function revealAll() {
    var n;
    while ((n = nextGroup()) !== null) show(n);
    mark(); done();
  }
  root.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== root && !(target.className && /(^| )sc( |$)/.test(target.className))) target = target.parentNode;
    if (target && target !== root && isHidden(target)) {
      show(groupOf(target)); mark();
      if (nextGroup() === null) done();
    } else {
      revealNext();
    }
  });
  if (window.__sqKey) document.removeEventListener('keydown', window.__sqKey);
  window.__sqKey = function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'n' || event.key === 'N') revealNext();
    else if (event.key === ',') revealAll();
  };
  document.addEventListener('keydown', window.__sqKey);
  mark();
})();
</script>`;

const SEQ_CLOZE_AFMT = `<div id="sc-text">{{Text}}</div>
${KEY_CLEANUP}
{{#Extra}}<hr id="answer"><div id="extra">{{Extra}}</div>{{/Extra}}`;

const SEQ_IO_CSS = ANKING_CARD_CSS + `
#io-header { margin: .5em auto; max-width: 90%; }
#sq-wrap { position: relative; display: inline-block; max-width: 100%; margin: 0 auto; line-height: 0; }
#sq-image img { display: block; max-width: 100%; height: auto; }
#sq-masks { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
#sq-masks svg { display: block; width: 100%; height: 100%; }
.sq-m { cursor: pointer; }
.sq-m rect, .sq-m ellipse, .sq-m polygon { fill: moccasin; stroke: olive; stroke-width: 2; }
.sq-m[data-active] rect, .sq-m[data-active] ellipse, .sq-m[data-active] polygon { fill: salmon; stroke: yellow; }
.sq-m[data-gone] { display: none; }
#sq-help { margin: 10px auto 0; max-width: 90%; font-size: .45rem; line-height: 1.4; opacity: .6; }
#sq-extra { width: min(80%, 42rem); margin: .8em auto; text-align: left; line-height: 1.5; font-style: italic; color: navy; }
.nightMode #sq-extra, .night_mode #sq-extra { color: magenta; }
`;

const SEQ_IO_QFMT = `{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="sq-wrap" data-mode="{{Mode}}"><div id="sq-image">{{Image}}</div><div id="sq-masks">{{Masks}}</div></div>
<div id="sq-help"></div>
<script>
(function () {
  var autoFlip = true; // flip to the back after the last region (desktop and AnkiDroid; ignored on AnkiMobile)
  var wrap = document.getElementById('sq-wrap');
  if (!wrap) return;
  var random = wrap.getAttribute('data-mode') === 'random';
  var masks = Array.prototype.slice.call(wrap.querySelectorAll('.sq-m'));
  var help = document.getElementById('sq-help');
  if (help) help.textContent = random
    ? 'Click a region, or click anywhere / press N to reveal a random one \\u00b7 , reveals all'
    : 'Click the image or press N to reveal the highlighted region \\u00b7 , reveals all';
  if (!masks.length) return;
  function remaining() { return masks.filter(function (mask) { return !mask.hasAttribute('data-gone'); }); }
  function highlight() {
    masks.forEach(function (mask) { mask.removeAttribute('data-active'); });
    if (!random) { var left = remaining(); if (left.length) left[0].setAttribute('data-active', '1'); }
  }
  function done() { if (autoFlip && typeof pycmd === 'function') setTimeout(function () { pycmd('ans'); }, 350); }
  function reveal(mask) {
    mask.setAttribute('data-gone', '1');
    highlight();
    if (!remaining().length) done();
  }
  function revealNext() {
    var left = remaining();
    if (!left.length) { done(); return; }
    reveal(random ? left[Math.floor(Math.random() * left.length)] : left[0]);
  }
  function revealAll() {
    remaining().forEach(function (mask) { mask.setAttribute('data-gone', '1'); });
    highlight(); done();
  }
  wrap.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== wrap && !(target.getAttribute && target.getAttribute('data-i') !== null)) target = target.parentNode;
    if (target && target !== wrap && !target.hasAttribute('data-gone')) reveal(target);
    else revealNext();
  });
  if (window.__sqKey) document.removeEventListener('keydown', window.__sqKey);
  window.__sqKey = function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'n' || event.key === 'N') revealNext();
    else if (event.key === ',') revealAll();
  };
  document.addEventListener('keydown', window.__sqKey);
  highlight();
})();
</script>
{{/Image}}`;

const SEQ_IO_AFMT = `{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="sq-wrap"><div id="sq-image">{{Image}}</div></div>
${KEY_CLEANUP}
{{#Extra}}<div id="sq-extra">{{Extra}}</div>{{/Extra}}
{{/Image}}`;

export { ANKING_CARD_CSS, BASIC_QFMT, BASIC_AFMT, CLOZE_QFMT, CLOZE_AFMT, SEQ_CLOZE_CSS_EXTRA, SEQ_CLOZE_QFMT, SEQ_CLOZE_AFMT, SEQ_IO_CSS, SEQ_IO_QFMT, SEQ_IO_AFMT };
