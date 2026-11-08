---
name: anking-card-generator
description: Turn medical study material (PDF text, slide decks, scanned/handwritten pages, photos, tables, flowcharts, typed notes) into AnKing-quality Anki flashcards for MBBS / NEET-PG / INICET / USMLE study. Covers Anatomy, Physiology, Biochemistry, Pathology, Pharmacology, Microbiology, ENT, Ophthalmology, PSM (Community Medicine) and Forensic Medicine & Toxicology. Produces atomic cloze cards, question-style cloze, mnemonics, "one by one" list cards, tables, and image-occlusion plans, with tags, as importable JSON for the "Anki Studio" app (or TSV for Anki). Use whenever the user shares notes/pages/images and asks for flashcards, cards, a deck, cloze, or image occlusion. Grounded strictly in the supplied source; never invents facts.
---

# AnKing-Level Card Generator (portable skill)

> Works in Claude Code (drop this folder in `~/.claude/skills/`) or any other AI (paste/upload this file at the start of the chat and say: "Follow this skill exactly. Here is my source material.").

---

## 0. The contract (read first, never break)

You are writing flashcards a medical student will memorise and be examined on. A wrong card is worse than no card. Therefore:

1. **Source-grounded only.** Every fact on every card must be present in the material the user supplied in this conversation (text, OCR of the image, or the PDF). If you know the fact is true but it is not in the source, do **not** put it on the card body. You may add it to `answer` (Extra) prefixed with `[Not in source] ` **only** if you are certain, and set the tag `!Verify`. When in doubt, leave it out.
2. **No invented numbers.** Doses, normal ranges, percentages, page numbers, years, section numbers, classification stages: copy exactly as written in the source. If two sources disagree, create no card for the disputed number; list it under "Conflicts" in your report.
3. **Unreadable ≠ guess.** If a word/number in an image or scan is blurry, partially visible, or ambiguous, do not guess. Write the card with `[?]` at that spot, tag `!Verify`, and list it in "Needs your eyes".
4. **No medical advice.** You make study cards, not clinical recommendations. Keep the source's wording about treatments; do not "improve" them.
5. **Ask once, then proceed.** If the target (exam, subject, source book) is unknown, ask a single compact question; if the user says "just do it", assume MBBS university + NEET-PG/INICET level and note the assumption.
6. **Report honestly.** End every job with the counts, the flagged items and what you skipped (see §14). Never claim you checked something you did not check.
7. **Copyright.** Summarise and restructure the user's own material; do not reproduce long verbatim passages of a textbook. Cards are short by design.

If any rule conflicts with being "helpful", the contract wins.

---

## 1. What "AnKing-level" means (measured, not guessed)

These numbers were measured on the real AnKing Step 1/2 v12 deck (28,522 notes, AnKingOverhaul note type):

| Property | Measured value | What to do |
|---|---|---|
| Plain-text length of the `Text` field | median **107 chars**, mean 114, p90 166 | Keep the card body ~60–170 chars. Longer only for list/mnemonic cards. |
| Clozes per note | median **1**, mean 1.4, p90 2, max 15 | Default to ONE cloze. Two for two independent facts in one sentence. |
| Distinct cloze numbers (c1,c2,…) per note | 82% use only c1; 15% two numbers; 3% three; <1% more | Use c1 almost always. c2/c3 only for independent facts. Never exceed c4 except in a list. |
| Cloze answer length | median **1 word**, 90% ≤ 3 words, mean 1.9 | Hide the *smallest discriminating unit*, not the whole phrase. |
| Cloze hints (`::hint`) | ~15% of cloze deletions carry a hint (5,966 of ≈39,400) | Use a hint whenever the blank could be answered with several categories, or to state the count/direction/format. |
| Question-style notes ("What…/Which…" then answer) | **36%** (What 56%, Which 21%, In 8%, How 4%) | Use for single-recall facts: names, causes, drugs of choice, tests, numbers. |
| Statement-style notes | 64% | Use for mechanisms, relationships, "X causes Y because…". |
| Bold used | in **91%** of notes (≈90% of bold is on *context* words OUTSIDE the cloze) | Bold the key subject term(s) so the question is unambiguous. Do not bold the answer by default. |
| Underline used | in 66% of notes | Underline the *category/type* word asked about ("Which <u>nerve</u>…", "<u>mechanism</u>", "<u>stage</u>"). |
| Italic used | in 30% of notes | Italic for qualifiers ("most common", "rare") and for Extra commentary. |
| `Extra` field filled | **67%** of notes | Most cards have an Extra: the *why*, the mnemonic expansion, "e.g." examples, exceptions, an image. |
| Extra length | median 60 chars, mean 101 | Short. One to three lines. |
| Images | ~2% in Text, ~14% in Extra | Pictures live in Extra (answer side); Text stays text. |
| One-by-one (list reveal) | 1.4% of notes (401) | Lists / mnemonics / "causes of X" with ≥3 parallel items. |
| Tag hierarchy | deep: `Deck::Resource::Chapter::Topic`, plus flags | Tag deeply and consistently (see §9). |

**Look:** see §3.8 — colour/size live in the note type; the fields only carry `<b> <u> <i>` and cloze blanks.

**The AnKing "feel":** each card is one retrievable fact; the stem gives *just enough* context to be unambiguous; the answer is a short term; the Extra gives the reasoning or memory hook; tags carry the organisation (decks are shallow, tags are deep).

Observed real examples (style reference, paraphrased from the deck):
- Q-style: `Which <u>lymph node cluster</u> drains the <b>dorsolateral foot</b>?<br>{{c1::Popliteal}}`
- Statement: `<b>Collagenase</b> requires {{c1::zinc}} as a cofactor` — Extra: `<i>thus zinc deficiency results in inability to replace type III collagen with type I collagen</i>`
- Hinted: `{{c1::<b>Carbapenems</b>::Monobactams or Carbapenems}} are used to treat <u>anaerobic</u> infections`
- Count hint: `What <u>pathologies</u> may be associated with <b>pseudogout</b>?<br>{{c1::Hemochromatosis and hyperparathyroidism::2}}`
- Direction hint: `{{c1::↓::↑/↓}} platelet count in <b>DIC</b>` (all parallel lines with the same `↑/↓` hint, one-by-one)
- Mnemonic list: `The <b>pathway of sperm</b> can be remembered by "<b>SEVEN UP</b>": {{c1::<u><b>S</b></u>eminiferous tubules::S}} …` (hint = the mnemonic letter; **One by one** on).

---

## 2. Note types you can emit (and when)

You target the user's app "Anki Studio" (and, via TSV, real Anki). Types:

| Type (`type` value) | Use for | JSON flags |
|---|---|---|
| **Cloze** (standard) | ~85% of all cards. One fact per cloze number. Gives Anki's normal behaviour: each `cN` = its own card. | `"type":"Cloze"` |
| **Cloze, reveal one by one** | Ordered/parallel lists, mnemonics, stepwise management, "causes of…" (≥3 items). One card; clozes appear one at a time (click / N; `,` reveals all). | `"type":"Cloze","sequential":true` |
| **Basic** | Rarely: when the answer is a long structured block that cannot be a cloze (e.g., "Draw/Describe the…", mini tables) or a true two-way association table where cloze is awkward. | `"type":"Basic"` |
| **Image Occlusion — hide all, guess one** (`hide-all`) | Labelled diagrams: every label hidden, one tested per card (Anki IO classic). Many structures; each is its own card. | `"occlusion_mode":"hide-all"` |
| **Image Occlusion — hide one, guess one** (`hide-one`) | Only the tested label is hidden; others remain visible as context. Best for anatomy where neighbours help. | `"occlusion_mode":"hide-one"` |
| **Image Occlusion — one by one, in order** (`sequential`) | Flow-charts, pathways, ordered sequences (e.g., steps of a cycle). ONE card; masks revealed in draw order. | `"occlusion_mode":"sequential"` |
| **Image Occlusion — one by one, random** (`random`) | Unordered sets on one picture (e.g., all parts of a structure) for random-order recall. ONE card. | `"occlusion_mode":"random"` |

### Decision tree (apply per fact)
1. Is the source a **picture with labels** and the labels are the learning target? → **Image Occlusion** (§7).
2. Is it a **list of ≥3 parallel items that must be recalled as a set** (causes, features, steps, mnemonic letters)? → **Cloze reveal-one-by-one**. (If order matters, number them c1…cn in reading order.)
3. Is it a **single retrievable fact** (name, number, test, drug, cause, side-effect)? → **Cloze** (question-style if it asks "what/which", statement-style if it expresses a relationship).
4. Is it a **table of N rows × M columns**? → split into row-cards (one cloze per row/attribute), never one giant cloze. (§5.8)
5. Does it need a **diagram/histology/X-ray the student must interpret**? → picture in `answer` (Extra) and a cloze on the finding; or IO if labels matter.
6. Everything else long/descriptive → **break into facts first** (never write a paragraph card). Use Basic only if truly irreducible.

### Mapping to real AnKing note types (for TSV export)
- Cloze → `AnKingOverhaul (AnKing / AnKingMed)` fields: `Text`, `Extra`, … , `One by one`, `ankihub_id`.
- Reveal-one-by-one → same note type, put any text (e.g., `y`) in the **`One by one`** field **and use `{{c1::…}}` for ALL items** (AnKing reveals them in text order).
  - **In Anki Studio** the toggle (`"sequential":true`) reveals in **cloze-number order**, so there number list items c1, c2, c3… in reading order (items sharing a number appear together).
- IO sequential/random → AnKing's `IO-one by one` / Anki Studio's one-by-one occlusion.

---

## 3. Card-writing grammar (exact)

### 3.1 Field model
- `question` = AnKing **Text**: the cloze sentence / question, HTML allowed.
- `answer`  = AnKing **Extra**: explanation, why, mnemonic expansion, e.g., exceptions, source ref, picture. May be empty (but ~2/3 of cards should have one).
- `tags` = array of strings, no spaces (use `_`), `::` = hierarchy.
- Never put the answer anywhere outside a `{{cN::…}}` in `question` (Basic: answer goes in `answer`).

### 3.2 Cloze syntax
`{{c1::answer}}`  `{{c1::answer::hint}}`  — numbers start at 1, increase by 1, no gaps (c1,c2,c3). The same number on several clozes = hidden/revealed together.
- Never nest clozes. Never put a cloze across a `<br>` boundary unless it is a deliberate list item.
- Do not put `}}` inside an answer. If the answer contains `}}` insert a space `} }`.
- Hint text: short (≤ 3 words), no HTML, no `{{ }}`.

### 3.3 Formatting vocabulary (use exactly these tags only)
| Purpose | HTML | Example |
|---|---|---|
| Key subject term(s) of the stem | `<b>…</b>` | `<b>Hydralazine</b>` |
| The **category being asked** | `<u>…</u>` | `Which <u>cranial nerve</u>` |
| Qualifier / emphasis / Extra voice | `<i>…</i>` | `<i>most common</i>` |
| Subscript / superscript | `<sub>`, `<sup>` | `O<sub>2</sub>`, `10<sup>9</sup>/L`, `Ca<sup>2+</sup>` |
| Line break | `<br>` (blank line = `<br><br>`) | question, blank line, answer |
| List lines inside Extra | lines separated by `<br>` starting with `- ` | |
| Table (only in Extra, small) | `<table><tr><th>…</th></tr><tr><td>…</td></tr></table>` | |
| Arrows/symbols (plain Unicode) | `↑ ↓ → ← ↔ ≥ ≤ ≠ ± °` | `↑ PT` |

Allowed layout wrapper (nothing else): `<div class="mnemonics">…</div>` around acronym / aligned list lines (left-aligns them inside the centred card, exactly like AnKing). No other tags. No inline CSS, no colours, no `<font>`, no emoji, no Markdown in the JSON (use the HTML above).
Escape `<` and `>` that are *text* as `&lt;` `&gt;` (e.g., `&lt;0.5 mg/dL`).

### 3.4 Stem rules
- The stem must contain enough context that **only one** answer is defensible. Add the organism/drug/condition name in bold; add the type in underline.
- Prefer the *positive, specific* form: "What is the drug of choice for…" not "Which of the following…".
- No "all of the above", no yes/no (use a hint like `::T/F` only for a genuine true/false discrimination), no negatives ("which is NOT…").
- Do not leak the answer: no answer word, stem word or abbreviation in the stem.
- Expand abbreviations on first use if the source did, e.g., `ARDS`, but do not invent expansions.
- Use the **source's** terminology (INN vs USAN: paracetamol/acetaminophen; adrenaline/epinephrine; frusemide/furosemide; salbutamol/albuterol; lignocaine/lidocaine; noradrenaline/norepinephrine; pethidine/meperidine). Put the other name in Extra: `<i>US name: acetaminophen</i>`.

### 3.5 Answer rules
- Answer = the **smallest discriminating phrase** (1–3 words; ≤ 8 only for a necessary phrase).
- Keep units/symbols in the cloze if they are the fact (`{{c1::8–12 mEq/L}}`), outside if the number is what is tested (`{{c1::125}} mL/min`). Be consistent per card.
- Synonyms: put one in the cloze, others in Extra. Do not put "A / B" in the cloze unless both are required.
- Lists of required items in one blank: use the count hint (`::2`, `::3`) and reveal-one-by-one, or split into separate clozes.

### 3.6 Hints (`::hint`) — when and what
Use a hint when the blank could be answered from several domains, or the **format** matters.
| Situation | Hint | Example |
|---|---|---|
| Number of items expected | `2`, `3`, `4` | `{{c1::Hemochromatosis and hyperparathyroidism::2}}` |
| Direction | `↑/↓` | `{{c1::↓::↑/↓}} PTH` |
| Category of answer | `diagnosis`, `drug`, `treatment`, `next step`, `investigation`, `organism`, `location`, `age group`, `inheritance`, `enzyme`, `nerve`, `artery`, `gene` | `{{c1::Rifampicin::drug}}` |
| Binary choice | `proximal or distal`, `T/F`, `enveloped?` | |
| Mnemonic letter | the plain letter (hints never contain HTML) | `{{c1::Pulmonary stenosis::P}}` |
| Specificity | `specific`, `most common`, `1st line` | |
Never write a hint that contains the answer. Never use the same hint word as the stem noun.

### 3.7 Numbering strategy
- Single fact → c1.
- Two independent facts in one sentence → c1 and c2 (each becomes its own card; each stays unambiguous when the other is revealed).
- Two blanks that must be recalled **together** (a pair/trio) → same number.
- A list for one-by-one → c1…cn in reading order (Anki Studio) or all c1 + `One by one` (AnKing note type).
- If revealing c2's answer would hand away c1 (they imply each other), merge or rewrite.

### 3.8 Appearance — how AnKing cards look, and how to stay faithful (measured from the real note type CSS)

**Principle: colour and size come from the note type, never from the field.** In the real deck only ~2% of notes carry any inline colour, and almost all of those are paste junk (`color:#000000`, `rgb(255,255,255)`). Meaning is carried by `<b>`, `<u>`, `<i>` and cloze blanks; the note-type CSS paints them. Never write `style=`, `<font>`, `color`, `font-size`, or `background` into a field.

What the cards look like (the Anki Studio exporter ships this exact look, so JSON from this skill renders correctly):

| Element | Day mode | Night mode (default for most users) |
|---|---|---|
| Font / size | Arial (Arial Greek), base 28 px (one `html{font-size}` number scales everything) | same |
| Card text | black on light grey `#D1CFCE`, centred | `#FFFAFA` on `#272828`, centred |
| Cloze (hidden `[...]` and revealed answer) | **bold blue** | bold `#4297F9` |
| Extra field (`answer`) | *italic navy*, separated by a horizontal rule, 1 rem above | *italic magenta* |
| `<b>` `<u>` `<i>` | same colour as the text (colour is inherited, they only add weight / underline / slant) | same |
| Lists | left-aligned block inside the centred card, max ~50 % width | same |
| `<div class="mnemonics">` | left-aligned block for acronym / aligned lines | same |
| Images | max 85 % width, in Extra only | same |
| Tables | centred, thin grey borders, shaded bold header row | same |
| Revealed hint (`::hint` shown as `[hint]`) | bold blue like the cloze | same |

Consequences for how you write:
1. **Emphasis hierarchy** — bold = the subject term you must recognise; underline = the category word being asked; italic = qualifier. Colour is never an emphasis tool.
2. **Question first, blank on its own line:** Q-style cards put a blank line between the question and the cloze (`…?<br><br>{{c1::answer}}`) — in the real deck, where the cloze directly follows the question, the blank line is used 224 times vs 41 without it.
3. **Mnemonic / aligned lines:** wrap them in `<div class="mnemonics">`, one item per line separated by `<br>`; each line `{{cN::<u><b>X</b></u>rest of word::X}}` — the first letter bold+underlined *inside* the cloze, the hint is that plain letter.
4. **Extra voice:** write Extra as plain short sentences; the CSS makes it italic and coloured. Do not wrap it in `<i>` yourself except for a short inline phrase that must contrast (e.g., a Latin name). Do not start lines with "Extra:".
5. **Photo credits** (when the user supplied an image that has one): `<span style="…">` is not allowed, so write `Photo credit: <author>, <licence>, via Wikimedia Commons` as a plain last line of the Extra, after the image.
6. **Tables** go in Extra only, small (≤ 5 × 5), header row = `<th>`; never a table in the Text field.
7. **No decorative symbols.** Arrows/≥/≠/° are fine; emoji, checkmarks, bullets drawn with symbols are not (use a real `<ul>`/`<ol>` only inside Extra, or the `mnemonics` block in Text).
8. **Do not centre/align with spaces or `&nbsp;`.** Spacing comes from `<br>` and the CSS.
9. **Dark-mode safe:** because nothing in the field has a colour, the same card is readable in day and night mode. If a field ever contains an inline colour, strip it.

If the user pastes cards into a real **AnKing note type**, the same markup renders with *their* CSS (same look); if they use Anki Studio's exporter the look above is built in. Either way the field HTML stays identical.

---

## 4. Atomicity and coverage rules

1. **One card = one retrievable fact.** If the Extra contains another testable fact, make another card.
2. **Minimum-information principle:** never test two things with one blank.
3. **Context duplication is fine; fact duplication is not.** The same bold subject can appear on many cards; do not make two cards that test the same fact (check before output).
4. **High-yield first.** Prioritise: definitions the exam asks, "most common", "drug of choice", "investigation of choice", pathognomonic findings, classic associations, formulas, named signs, numbers that are tested, treatments, complications, mechanisms, contraindications, antidotes.
5. **Skip:** history trivia, author names, anecdotes, decorative text, repeated headings, anything the source marks as "for reading".
6. **Respect emphasis in the source.** Bold/boxed/underlined/starred items are flagged high-yield → add tag `~HY`; do not make cards for faint/optional text unless the user asks for "complete coverage".
7. **Density guide:** dense page ≈ 8–15 cards; sparse page ≈ 2–6; a one-line fact ≈ 1 card. Do not pad to hit numbers.
8. **Self-contained:** a card must make sense with no neighbouring cards, no picture except if the image is in Extra, no "as above".
9. **Siblings:** when a topic has parallel sub-items (types of X), make a *separate* card per item **and** (optionally) one overview list card (reveal-one-by-one) — never only the overview.

---

### 4a. Calibration lessons (from the first real batch: Pathoma CNS chapter → 362 cards)
1. **Interlocked blanks are the commonest mistake.** `X is damage to the {{c1::A}} due to {{c2::B}}` makes two cards that give each other away. Hide ONE thing per card; show the other as bold context. If both facts matter, make two separate cards (one blank each) — do not use c1+c2 on a sentence whose parts imply each other.
2. **Pairs that must be recalled together share one number** (`{{c1::A}} … {{c1::B}}`), they do not get c1/c2.
3. **Do not add "category" hints that repeat the stem** (`Which organism…{{c1::X::organism}}`, `<u>Treatment</u>…{{c1::Y::treatment}}`). A hint must add information the stem lacks: a count, a direction (`↑/↓`), a binary choice (`upper/lower`, `pale/hemorrhagic`, `sporadic/familial`), a mnemonic letter, or a format.
4. **A hint never contains the answer's own word** (`{{c1::middle cerebral artery::artery}}` is wrong).
5. **Density:** dense Pathoma-style pages legitimately give ~20–30 cards/page (AnKing's Pathoma tag averages ≈ 24 notes/page). Declarative textbooks give fewer Extras and fewer hints than AnKing: say so in the report instead of padding.
6. **Figures in the source:** a pure photo (gross specimen/H&E) with only a caption → reference the figure in `answer` (`<i>Fig. 17.4</i>`); do not invent a description of what the picture shows.
7. **Validate before you hand over:** every cloze balanced, numbers 1…n without gaps, no duplicate questions, no `}}` inside answers. (A 20-line script or the app's Import preview does this.)

---

## 5. Pattern library (reusable templates)

Use `[ ]` for what you replace. All examples are valid for the app JSON (shown condensed: `Q` = question, `E` = answer/Extra).

### 5.1 Definition
`Q:` `<b>[Term]</b> is defined as {{c1::[core defining phrase]}}`  `E:` `<i>[Source clarifier]</i>`

### 5.2 Q-style single recall (the workhorse)
`Q:` `What <u>[category]</u> is [qualifier] in <b>[context]</b>?<br><br>{{c1::[answer]}}`

### 5.3 Statement relationship
`Q:` `<b>[A]</b> causes {{c1::[B]}} via <u>[mechanism-word]</u>` `E:` `<i>[why]</i>`

### 5.4 Cause / association
`Q:` `The most common <u>cause</u> of <b>[condition]</b> is {{c1::[cause]}}`

### 5.5 Drug of choice / first-line
`Q:` `<u>Drug of choice</u> for <b>[condition]</b>: {{c1::[drug]::drug}}` `E:` `<i>[alternative / why]</i>`

### 5.6 Numeric fact
`Q:` `<b>[Parameter]</b> normally is {{c1::[value + unit]}}` `E:` `<i>[meaning / when abnormal]</i>`

### 5.7 Mnemonic (acronym)
`Q:` `[Topic] can be remembered by the mnemonic "<b>[ACRONYM]</b>":<br>{{c1::<u><b>X</b></u>xxxx::X}}<br>…` with **reveal-one-by-one**; hint = the letter. `E:` the plain expansion.

### 5.8 Table → cards
For a table (rows = items, cols = attributes):
- **Row-card** (preferred): `<b>[Row item]</b> — <u>[Attribute]</u>: {{c1::[value]}}` — one card per important cell.
- **Contrast card:** `[Row A] has {{c1::X}} whereas [Row B] has {{c2::Y}}` (c1/c2).
- Optional **overview list** (reveal-one-by-one) of the rows only.
Never paste a table into the stem.

### 5.9 Classification / staging
Per stage: `<b>[Classification]</b> <u>stage</u> [N]: {{c1::[criterion]}}`; plus an ordered overview (one-by-one).

### 5.10 Pathway / cycle / steps
Prefer an **IO sequential** if there is a diagram; else one-by-one cloze list: `Steps of [process] in order: {{c1::step1}} → {{c2::step2}} → …`.

### 5.11 Compare/contrast (two entities)
`Both [A] and [B] cause [X], but only {{c1::[A]}} causes [Y]` (c1) + separate `[Y] is caused by {{c1::A}}`.

### 5.12 Clinical vignette-lite (for NEET-PG/INICET/Step)
`Q:` `<b>[Age/sex]</b> with <u>[key finding]</u> and <b>[second finding]</b>: most likely <u>diagnosis</u>?<br><br>{{c1::[dx]}}` — use only if the source gives the association; keep to 2–3 clues.

### 5.13 Formula
`Q:` `<b>[Quantity]</b> = {{c1::[formula]}}` `E:` `<i>variables, units</i>` (write formulas in plain text/Unicode, `×`, `÷`, `<sup>`).

### 5.14 Contraindication / adverse effect
`Q:` `<b>[Drug]</b> is contraindicated in {{c1::[condition]}}` / `<u>Adverse effect</u> of <b>[drug]</b> specific to [class/organ]: {{c1::[ADR]}}`

### 5.15 Investigation of choice
`Q:` `<u>Investigation of choice</u> for <b>[condition]</b>: {{c1::[test]}}` `E:` `<i>why / gold standard vs screening</i>`

### 5.16 Eponym / sign
`Q:` `<b>[Eponym]</b> sign is seen in {{c1::[condition]}}` and reverse `<u>Sign</u> of <b>[condition]</b>: {{c1::[eponym]}}` (two cards only when both directions are examined).

---

## 6. Subject playbooks

For each subject: **extract**, **card shapes**, **gotchas**, **examples** (valid facts; copy the style, not the content, unless the user's source says the same).

Common JSON wrapper for examples:
`{"type":"Cloze","question":"…","answer":"…","tags":["…"]}`

### 6.1 Anatomy
**Extract:** origin/insertion, nerve supply, blood supply, action, relations, borders, contents, surface markings, development/embryology, applied/clinical, variations, histology if given, dermatomes/myotomes, foramina contents, nerve injuries.
**Shapes:** nerve-injury → deficit; muscle → nerve; structure → artery; foramen → contents (one-by-one); relations (anterior/posterior…) as hinted pairs; applied anatomy with the sign.
**Gotchas:** left/right, proximal/distal, superior/inferior always in the cloze hint; "supplied by" ≠ "drained by"; keep spinal levels exact; clinical eponyms.
**Examples**
```json
{"type":"Cloze","question":"The <b>axillary nerve</b> winds around the {{c1::surgical neck}} of the <u>humerus</u>","answer":"<i>fracture of the surgical neck endangers the axillary nerve and posterior circumflex humeral artery</i>","tags":["MBBS::Anatomy::Upper_Limb::Brachial_Plexus"]}
{"type":"Cloze","question":"<b>Erb palsy</b> involves roots {{c1::C5–C6}} and gives the {{c2::waiter's tip}} posture","answer":"","tags":["MBBS::Anatomy::Upper_Limb::Brachial_Plexus"]}
{"type":"Cloze","question":"Which <u>muscle</u> of the larynx is <i>not</i> supplied by the recurrent laryngeal nerve?<br><br>{{c1::Cricothyroid}}","answer":"<i>supplied by the external laryngeal nerve (branch of superior laryngeal nerve)</i>","tags":["MBBS::Anatomy::Head_Neck::Larynx"]}
{"type":"Cloze","question":"<b>Radial nerve</b> injury in the <u>spiral groove</u> causes {{c1::wrist drop}} with {{c2::triceps spared}}","answer":"<i>triceps branches arise proximal to the spiral groove</i>","tags":["MBBS::Anatomy::Upper_Limb::Nerve_Injuries"]}
```
List card (one-by-one): `Structures passing through the <b>foramen magnum</b>: {{c1::medulla/spinal cord junction}}, {{c2::vertebral arteries}}, {{c3::spinal accessory roots}}` with `"sequential":true` **only if** the source lists exactly these.

### 6.2 Physiology
**Extract:** normal values, definitions, mechanisms (↑/↓ chains), laws/equations, graphs (what each axis/phase means), reflexes, receptors, hormones' sources/actions/regulation, ECG/PV loop phases, acid–base rules, renal handling.
**Shapes:** value cards; "effect of X on Y" with `↑/↓` hint; cause–effect chains split into separate arrows (one cloze per arrow); equation cards; graph-interpretation cards (what shifts the curve).
**Gotchas:** always give the direction hint; do not mix up cause and effect; keep units.
**Examples**
```json
{"type":"Cloze","question":"<b>Mean arterial pressure</b> = diastolic pressure + {{c1::1/3}} of the <u>pulse pressure</u>","answer":"","tags":["MBBS::Physiology::Cardiovascular::Haemodynamics"]}
{"type":"Cloze","question":"<b>Normal GFR</b> is about {{c1::125}} mL/min","answer":"","tags":["MBBS::Physiology::Renal::GFR"]}
{"type":"Cloze","question":"<b>Increased venous return</b> {{c1::↑::↑/↓}} stroke volume via the <u>Frank–Starling mechanism</u>","answer":"<i>greater end-diastolic fibre length → greater force of contraction</i>","tags":["MBBS::Physiology::Cardiovascular::Cardiac_Output"]}
{"type":"Cloze","question":"<b>Rightward shift</b> of the O<sub>2</sub>–Hb dissociation curve is caused by {{c1::↑::↑/↓}} CO<sub>2</sub>, {{c2::↑::↑/↓}} H<sup>+</sup>, {{c3::↑::↑/↓}} temperature and {{c4::↑::↑/↓}} 2,3-BPG","answer":"<i>↓ affinity → more O<sub>2</sub> release to tissues</i>","tags":["MBBS::Physiology::Respiratory::O2_Dissociation_Curve"],"sequential":true}
```

### 6.3 Biochemistry
**Extract:** pathway steps, rate-limiting/regulated enzymes, cofactors/vitamins, inheritance, deficiency → disease → accumulated substrate/clinical, inborn errors, lab tests, molecular biology (DNA/RNA/protein), genetics, nutrition (RDA, deficiency signs), acid–base, hormones/second messengers.
**Shapes:** enzyme → pathway; deficiency → disease → inheritance (3 cards); vitamin → coenzyme form → reaction; metabolite → organ; "net yield" numbers.
**Gotchas:** write enzyme names exactly; differentiate substrate vs product; include inheritance as hint (`AR`, `AD`, `XR`).
**Examples**
```json
{"type":"Cloze","question":"The <u>rate-limiting enzyme</u> of <b>glycolysis</b> is {{c1::phosphofructokinase-1 (PFK-1)}}","answer":"<i>activated by fructose-2,6-bisphosphate and AMP; inhibited by ATP and citrate</i>","tags":["MBBS::Biochemistry::Carbohydrate_Metabolism::Glycolysis"]}
{"type":"Cloze","question":"<b>Von Gierke disease</b> (GSD type I) is due to deficiency of {{c1::glucose-6-phosphatase}}","answer":"<i>fasting hypoglycaemia, hepatomegaly, lactic acidosis, hyperuricaemia, hyperlipidaemia</i>","tags":["MBBS::Biochemistry::Carbohydrate_Metabolism::Glycogen_Storage_Diseases"]}
{"type":"Cloze","question":"<b>Lesch–Nyhan syndrome</b> is caused by deficiency of {{c1::HGPRT}} and is inherited as {{c2::X-linked recessive::inheritance}}","answer":"<i>purine salvage pathway defect → hyperuricaemia, self-mutilation, intellectual disability</i>","tags":["MBBS::Biochemistry::Nucleotide_Metabolism::Purines"]}
{"type":"Cloze","question":"Which <u>vitamin B<sub>12</sub> deficiency</u> marker is raised but not in folate deficiency?<br><br>{{c1::Methylmalonic acid}}","answer":"<i>both raise homocysteine</i>","tags":["MBBS::Biochemistry::Vitamins::Vitamin_B12"]}
```

### 6.4 Pathology
**Extract:** definitions, etiology, pathogenesis (step chain), gross/morphology, microscopy, special stains, immunohistochemistry markers, genetics/translocations, clinical features, lab findings, complications, prognosis/grading/staging, named cells/bodies.
**Shapes:** disease → hallmark finding; finding → disease; marker → tumour; translocation → disease; stain → organism/substance; morphology cards use an image in Extra if provided.
**Gotchas:** don't mix gross and microscopic; keep grading/staging exact; "most common" is its own fact.
**Examples**
```json
{"type":"Cloze","question":"<b>Reed–Sternberg cells</b> are positive for {{c1::CD15}} and {{c1::CD30}}","answer":"<i>binucleate 'owl-eye' cells in Hodgkin lymphoma</i>","tags":["MBBS::Pathology::Haematology::Lymphomas"]}
{"type":"Cloze","question":"The <u>translocation</u> in <b>chronic myeloid leukaemia</b> is {{c1::t(9;22)}} producing the {{c2::BCR-ABL}} fusion gene","answer":"<i>Philadelphia chromosome</i>","tags":["MBBS::Pathology::Haematology::Leukaemias"]}
{"type":"Cloze","question":"<b>Psammoma bodies</b> are seen in {{c1::papillary carcinoma of thyroid}}, {{c1::meningioma}}, {{c1::serous cystadenocarcinoma of ovary}} and {{c1::mesothelioma}}","answer":"<i>concentric calcified spherules</i>","tags":["MBBS::Pathology::General_Pathology::Calcification"],"sequential":true}
{"type":"Cloze","question":"<b>Virchow's triad</b> of thrombosis: {{c1::stasis}}, {{c2::endothelial injury}}, {{c3::hypercoagulability}}","answer":"","tags":["MBBS::Pathology::General_Pathology::Thrombosis"],"sequential":true}
```

### 6.5 Pharmacology
**Extract per drug/class:** class, mechanism, uses, adverse effects (class vs unique), contraindications, interactions, pharmacokinetic quirks (half-life, metabolism, enzyme inducers/inhibitors), monitoring, antidotes, dose only if given.
**Shapes:** (a) MOA card; (b) drug-of-choice card; (c) unique ADR card; (d) contraindication card; (e) antidote card; (f) a one-by-one class list; (g) suffix/prefix naming card.
**Gotchas:** keep drug names exact; *unique* ADRs are the testable ones; INN/USAN aliases in Extra; no doses unless in source.
**Examples**
```json
{"type":"Cloze","question":"<b>Warfarin</b> inhibits {{c1::vitamin K epoxide reductase (VKORC1)}}, decreasing factors {{c2::II, VII, IX and X}}","answer":"<i>also ↓ protein C and S; monitored by INR</i>","tags":["MBBS::Pharmacology::Blood::Anticoagulants"]}
{"type":"Cloze","question":"<u>Antidote</u> for <b>heparin</b> overdose: {{c1::protamine sulphate}}","answer":"<i>warfarin → vitamin K (± fresh frozen plasma)</i>","tags":["MBBS::Pharmacology::Blood::Anticoagulants"]}
{"type":"Cloze","question":"<b>ACE inhibitors</b> cause <u>dry cough</u> due to accumulation of {{c1::bradykinin}}","answer":"<i>switch to an ARB; ACEi also cause angioedema and hyperkalaemia</i>","tags":["MBBS::Pharmacology::Cardiovascular::Antihypertensives"]}
{"type":"Cloze","question":"<b>Isoniazid</b> neuropathy is prevented by {{c1::pyridoxine (vitamin B<sub>6</sub>)}}","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs"]}
{"type":"Cloze","question":"<b>Ethambutol</b> toxicity: {{c1::optic neuritis}} (red–green colour blindness)","answer":"<i>do a baseline visual acuity / colour vision test</i>","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs"]}
{"type":"Cloze","question":"<b>Organophosphate poisoning</b> is treated with {{c1::atropine}} and {{c2::pralidoxime}}","answer":"<i>atropine blocks muscarinic effects; pralidoxime reactivates cholinesterase (before 'ageing')</i>","tags":["MBBS::Pharmacology::ANS::Anticholinesterases"]}
```
**Drug-monograph (Katzung-style) one-card variant** — only when the user's source is a per-drug monograph: one note per drug with labelled sections (`<u>MOA</u>`, `<u>Clinical use</u>`, `<u>PK</u>`, `<u>Toxicity</u>`), a different cloze number per section line. Use sparingly; prefer atomic cards.

### 6.6 Microbiology
**Extract:** morphology/Gram/shape/arrangement, culture media, special stains/tests, virulence factors/toxins, pathogenesis, disease, laboratory diagnosis, treatment, prevention/vaccine, epidemiology (vector/reservoir), classification.
**Shapes:** organism → disease; test/medium → organism; toxin → mechanism; vector → disease; "lab diagnosis of X" one-by-one; Gram stain & shape as hinted cards.
**Gotchas:** italicise genus/species (`<i>Vibrio cholerae</i>`); keep media names exact; do not conflate serotypes.
**Examples**
```json
{"type":"Cloze","question":"<u>Selective medium</u> for <b><i>Vibrio cholerae</i></b>: {{c1::TCBS agar}}","answer":"<i>thiosulphate–citrate–bile salts–sucrose; yellow colonies</i>","tags":["MBBS::Microbiology::Bacteriology::Vibrio"]}
{"type":"Cloze","question":"<b><i>Corynebacterium diphtheriae</i></b> toxigenicity is tested by {{c1::Elek's gel precipitation test}}","answer":"<i>Albert stain shows metachromatic granules</i>","tags":["MBBS::Microbiology::Bacteriology::Corynebacterium"]}
{"type":"Cloze","question":"<b><i>Cryptococcus neoformans</i></b> capsule is demonstrated by {{c1::India ink}} preparation","answer":"<i>mucicarmine stains the capsule red</i>","tags":["MBBS::Microbiology::Mycology::Cryptococcus"]}
{"type":"Cloze","question":"<u>Test</u> used to diagnose <b>enteric fever</b> by antibody detection: {{c1::Widal test}}","answer":"<i>blood culture is the gold standard in the first week</i>","tags":["MBBS::Microbiology::Bacteriology::Salmonella"]}
```

### 6.7 ENT
**Extract:** anatomy-applied, tests (Rinne, Weber, ABC, tympanometry types), definitions, causes, clinical signs, investigations, surgeries & their indications, complications, emergency management, named signs, grading.
**Gotchas:** keep ear vs nose vs throat separate in tags; laterality statements exact (Weber lateralises to…).
**Examples**
```json
{"type":"Cloze","question":"<b>Rinne test negative</b> (BC > AC) indicates {{c1::conductive}} hearing loss","answer":"<i>Weber lateralises to the worse ear in conductive loss, to the better ear in sensorineural loss</i>","tags":["MBBS::ENT::Ear::Tuning_Fork_Tests"]}
{"type":"Cloze","question":"The commonest site of <b>epistaxis</b> is {{c1::Little's area}} on the <u>anterior nasal septum</u>","answer":"<i>Kiesselbach's plexus</i>","tags":["MBBS::ENT::Nose::Epistaxis"]}
{"type":"Cloze","question":"<b>Quinsy</b> is a {{c1::peritonsillar abscess}}","answer":"","tags":["MBBS::ENT::Throat::Tonsil_Diseases"]}
{"type":"Cloze","question":"<b>Meniere's disease</b> triad: {{c1::episodic vertigo}}, {{c2::tinnitus}}, {{c3::sensorineural hearing loss}} (plus aural fullness)","answer":"<i>endolymphatic hydrops</i>","tags":["MBBS::ENT::Ear::Meniere_Disease"],"sequential":true}
```

### 6.8 Ophthalmology
**Extract:** anatomy-applied, refraction, glaucoma (IOP/angle/disc), cataract types & surgery, retina (vascular/diabetic), cornea, uvea, conjunctiva (trachoma grading), neuro-ophthalmology (pupils, fields), squint, lids/lacrimal, ocular injuries, drugs/eye drops (+MOA), community eye health.
**Gotchas:** keep eponymous classifications as written (MacCallan, WHO grading); quote IOP/size/ratios exactly.
**Examples**
```json
{"type":"Cloze","question":"<b>Argyll Robertson pupil</b> <i>accommodates but does not react</i> to {{c1::light}}","answer":"<i>classically neurosyphilis; 'prostitute's pupil'</i>","tags":["MBBS::Ophthalmology::Neuro-ophthalmology::Pupil"]}
{"type":"Cloze","question":"<b>Cherry-red spot</b> at the macula with a pale retina is seen in {{c1::central retinal artery occlusion::diagnosis}}","answer":"<i>also in Tay–Sachs and Niemann–Pick</i>","tags":["MBBS::Ophthalmology::Retina::Vascular_Occlusions"]}
{"type":"Cloze","question":"<b>Hypopyon</b> is {{c1::pus in the anterior chamber}}","answer":"","tags":["MBBS::Ophthalmology::Cornea::Corneal_Ulcer"]}
{"type":"Cloze","question":"<b>Retinoblastoma</b> gene {{c1::RB1}} is on chromosome {{c2::13q14}}; commonest presenting sign is {{c3::leukocoria}}","answer":"","tags":["MBBS::Ophthalmology::Ocular_Tumours::Retinoblastoma"]}
```

### 6.9 PSM / Community Medicine
**Extract:** definitions (health, epidemiology measures), formulas, vital statistics, screening/diagnostic test maths, study designs, vaccines (schedule, storage, route, dose — exact), national health programmes (year, aim, targets), nutrition (RDA, indices), environmental health (water chlorination), occupational diseases, biomedical waste (colour codes), demography, health planning, communicable disease epidemiology (incubation, source, mode, control), disaster, ethics.
**Gotchas:** numbers and years must match the source/edition (state edition in tag); programme details change — tag the edition.
**Examples**
```json
{"type":"Cloze","question":"<b>Sensitivity</b> = {{c1::TP / (TP + FN)}}","answer":"<i>ability to detect true positives; ↑ sensitivity → fewer false negatives</i>","tags":["MBBS::PSM::Epidemiology::Screening"]}
{"type":"Cloze","question":"<b>Infant mortality rate</b> = infant deaths per {{c1::1000 live births}}","answer":"","tags":["MBBS::PSM::Demography::Vital_Statistics"]}
{"type":"Cloze","question":"<b>Prevalence</b> = {{c1::incidence}} × {{c2::mean duration}}","answer":"<i>valid when disease is stable</i>","tags":["MBBS::PSM::Epidemiology::Measures"]}
{"type":"Cloze","question":"<u>Storage temperature</u> of most vaccines in the cold chain: {{c1::+2 °C to +8 °C}}","answer":"<i>OPV can be kept frozen; check source for exceptions (e.g., freeze-sensitive vaccines)</i>","tags":["MBBS::PSM::Preventive_Medicine::Immunisation"]}
```
> For anything numerical in PSM (schedules, targets, years) **copy exactly**; if the source is older than the current NIS/NHM, tag `!Verify_Edition`.

### 6.10 Forensic Medicine & Toxicology (FMT)
**Extract:** definitions (death, injuries), post-mortem changes with timelines, identification, asphyxial deaths, wounds (types/features), firearms, sexual offences, legal procedure (inquest, evidence, dying declaration), medical ethics/negligence, toxicology (poison → source → mechanism → features → antidote → fatal dose/period if given → PM findings).
**Shapes:** poison card set (MOA / features / antidote / PM); timeline cards (use one-by-one for stages); legal-section cards **with both old and new numbering only if the source has them**.
**Gotchas:** India moved from IPC/CrPC/IEA to **BNS/BNSS/BSA** (2024). If the source gives IPC/CrPC/IEA numbers, keep them and tag `!Legal_Old_Code`; do **not** convert yourself except via the mapping in §15 and then tag `!Verify`.
**Examples**
```json
{"type":"Cloze","question":"<b>Post-mortem lividity</b> is <i>cherry-red</i> in poisoning with {{c1::carbon monoxide}} and {{c1::cyanide}}","answer":"<i>nitrites/aniline → chocolate brown</i>","tags":["MBBS::FMT::Thanatology::Post_Mortem_Changes"]}
{"type":"Cloze","question":"<u>Antidote</u> for <b>paracetamol</b> poisoning: {{c1::N-acetylcysteine}}","answer":"","tags":["MBBS::FMT::Toxicology::Antidotes"]}
{"type":"Cloze","question":"<u>Antidote</u> for <b>methanol</b> poisoning: {{c1::fomepizole}} (or ethanol)","answer":"","tags":["MBBS::FMT::Toxicology::Alcohols"]}
{"type":"Cloze","question":"<b>Garlic odour</b> of breath/vomitus suggests poisoning with {{c1::organophosphate}}, {{c1::arsenic}} or {{c1::phosphorus}}","answer":"","tags":["MBBS::FMT::Toxicology::General_Toxicology"],"sequential":true}
```

---

## 7. Image occlusion playbook (diagrams, histology, X-rays, flow-charts)

**When:** the learning target is *labels on a picture* (anatomy figures, histology fields, pathways, ECG segments, fundus/slit-lamp, instruments).

**Pick the mode**
| Picture type | Mode | Why |
|---|---|---|
| Labelled anatomical diagram with many separate structures | `hide-one` | Other labels give context; one hidden per card. |
| Many labels but the picture is mostly "name the thing" (no neighbours help) | `hide-all` | Every label hidden; one tested per card. |
| Flow-chart / pathway / cycle / algorithm | `sequential` | One card; reveal steps in order. |
| A set of unordered parts of one structure (e.g., layers of the retina) you want drilled randomly | `random` | One card; random-order recall. |
| Radiology/histology where you identify *the finding*, not labels | **Not IO** — use a cloze whose answer is the finding and put the image in Extra. |

**Masking rules**
1. Mask the **label text and leader-line tip area**, not the structure (unless the structure itself is the question).
2. One mask per label; masks that belong together (a label + its bracket; two halves of one structure) share a `group`.
3. Keep mask boxes tight; never cover labels that are *not* the target in `hide-one`.
4. Draw order matters in `sequential` (the order of the masks = reveal order): top-to-bottom / start-to-end of the process.
5. Max ~12 masks per card in `sequential/random`; split bigger figures into sub-figure cards.
6. Always add `answer` (Extra) with the 1–2 line takeaway and the source figure number.
7. **Coordinates you output are estimates.** The app's mask editor is where the human confirms them. Never claim pixel-accuracy.

**IO plan (what you output when you cannot attach the image yourself)** — see §11.3: image reference, mode, list of masks (label, approximate normalized `x,y,width,height` in 0–1 from the top-left, shape), optional groups, Extra text, tags. The user applies it in the app (or, if the user supplies the image file to the app's importer as `image_data`, the cards import directly).

---

### 7a. Precise masks and figure crops with `io_tools.py` (use whenever you can run Python and have the source PDF)

Never type pixel coordinates yourself - vision guesses drift by several percent and a drifting mask leaks or hides the wrong thing. **You decide WHAT to hide; `io_tools.py` (bundled next to this file; `pip install pymupdf pillow`) measures WHERE, from the PDF's own text layer.**

1. `python io_tools.py figures book.pdf OUT/` - finds every embedded figure and its `Fig. N.M` caption, crops it, writes `OUT/figures.json` (`b64`, `caption`, `page`). Look at a contact sheet of the crops before using them. Attach per §13 (max two cards per figure).
2. `python io_tools.py page book.pdf PAGE page.png` - preview with a point ruler; pick the rectangle of a labelled diagram (`x0,y0,x1,y1`, PDF points).
3. `python io_tools.py labels book.pdf PAGE x0,y0,x1,y1 OUT/io1` - prints numbered text labels found in that rectangle and writes `overlay.png` (red numbered boxes). **View the overlay.** If the diagram has no text layer (scan), the list is empty: fall back to a plan (`image_occlusion_plans`) for the user to draw in the app, never guessed boxes.
4. Choose label numbers and write a spec: `{"pdf": ..., "candidates": "OUT/io1/candidates.json", "tags": [...], "extra": "<Book> Fig. N - caption", "cards": [{"mode": "hide-one", "hide": [1,2,5,[7,8]]}]}`; `python io_tools.py build spec.json io.json`. A nested list joins several labels into one hidden group. Modes: `hide-one` (tree/anatomy where neighbours help), `hide-all` (hide everything, guess one), `sequential` (ordered pathway, ONE note), `random` (unordered set, ONE note).
5. `python io_tools.py check io.json OUT/chk` - renders each card with its masks; LOOK at it. Merge `io.json` cards into the deck JSON (same `cards` array).
6. Photos / histology with arrows have no text to measure: attach the picture in Extra of a cloze card instead (e.g. "Fig. 6.9 hairy cell leukemia") and say in the report that arrow-target occlusion needs the app's mask editor.
7. Skip junk labels (connector glyphs are already filtered), keep only learning targets, and never occlude the figure caption.
8. **Occlusion must be meaningful, never forced.** Occlude a label only if recalling it is a real learning target and cannot be deduced from visible neighbours. Skip trivial or obvious labels (a top-of-tree title, a product that just repeats its precursor). A small diagram usually deserves 4-8 notes, not one per label; photos/histology without text deserve none. Prefer anatomy/pathway-heavy sources for occlusion; for text-heavy subjects (most pathology) cloze is better and a figure belongs in Extra.
9. **Every occlusion note needs a hint** telling the learner what is expected in the hidden box, because in pre-made decks users often cannot tell ("a name? how many? which category?"). Use `"hints"` (one per group, shown in the note's Header) such as `Which stem cell? (parent of the B and T lymphoblasts)`, `Name the 3 granulocytes`, `Which enzyme?`, plus a `"header"` for the whole card. Hints state the category/count/role, never the answer.
10. **Pick the mode by the structure of the figure:** `hide-one` for independent labels, `hide-all` when context labels would not help, `sequential` for a chain with a true order (a lineage, a pathway, steps), `random` for an unordered set of equals (the six blast cells). Do not add sequential/random cards that merely repeat what the hide-one cards already test.
11. Source images/cards derived from a user's book stay local (copyright); only this script and the skill go to the public repo.


## 8. Permutation matrix — input × content × action

### 8.1 By input type
| Input | How to read | Extra care |
|---|---|---|
| Typed notes / text-PDF | Use as is. Work heading by heading. | Keep heading hierarchy → tags. |
| Slide deck | Titles = topic tags; bullets are often fragments → complete only with source content. | Do not expand beyond slide text. |
| Scanned PDF / photo of printed page | OCR visually, line by line. | Unclear text → `[?]` + `!Verify`. |
| Handwritten notes | Transcribe literally first (silently), then card. | Abbreviations: keep as written; expand only if unambiguous within the page. |
| Table image | Reconstruct the table in your head (rows/cols) → apply §5.8. | If merged cells make it ambiguous, flag it. |
| Flow-chart / algorithm | Convert to ordered steps → one-by-one cloze **and** (if diagram given) IO sequential. | Decision nodes: write each branch as its own card. |
| Labelled diagram | IO plan (§7) + 1–2 cloze summary cards. | |
| Histology / X-ray / ECG | Image in Extra; cloze on the diagnosis/finding. | Do not describe findings that are not visible/printed. |
| Mixed pages | Process sequentially; keep a running "seen facts" list to avoid duplicates. | |
| Another language / mixed language | Keep original medical terms; translate only if the source did. | |

### 8.2 By content structure
| Structure in the source | Output |
|---|---|
| Definition sentence | §5.1 |
| "X causes Y" / mechanism | §5.3 (+ chain → separate arrows) |
| Bullet list, parallel items (3+) | one-by-one cloze list **+** per-item cards for the high-yield ones |
| Bullet list, mixed unrelated facts | one card per bullet (never a combined card) |
| Numbered steps | ordered one-by-one cloze (c1…cn) |
| Table | row-cards + optional overview |
| Comparison (A vs B) | §5.11 |
| Classification/staging | §5.9 |
| Mnemonic in the source | §5.7 (copy mnemonic exactly; do not create a new mnemonic unless asked) |
| Numbers/ranges | §5.6 (one number per cloze) |
| Formula | §5.13 |
| Drug table | per drug: MOA, unique ADR, DOC, contraindication cards |
| Case/vignette in the source | §5.12 + the underlying fact cards |
| Figure with caption | image (Extra) + caption fact as cloze |
| Footnote / "remember" box | high-yield → card + `~HY` |

### 8.3 By desired outcome (the user's request)
| User says | Do |
|---|---|
| "make cards from this" | Full coverage of high-yield; §10 workflow. |
| "high-yield only" | Only items with emphasis or classic exam facts; ≤ ~5 cards/page. |
| "complete / every fact" | Everything except fluff; ~8–15 cards/page. |
| "mnemonics" | Only mnemonic cards (§5.7) |
| "image occlusion" | §7 plans/cards for every labelled figure |
| "revision cards / short" | Fewer, broader cards but still atomic; prefer lists one-by-one |
| "for NEET-PG/INICET" | Add clinical-association cards, "most common", DOC, IOC; tag `#Exam::NEETPG` |
| "for university exam" | Add definitions/classifications/short-note headings; tag `#Exam::Univ` |
| "AnKing style" | Exactly this skill. |

---

## 9. Tagging scheme

Anki tags: no spaces; `::` hierarchy; case-sensitive in practice — be consistent.

```
MBBS::<Subject>::<System_or_Chapter>::<Topic>[::<Subtopic>]      ← main location (required)
#Src::<Book_or_Teacher>::<Chapter_or_Page>                        ← source (required if known)
~HY                                                              ← source flags it as high-yield
!Verify                                                          ← something on this card needs the student's eyes
!Verify_Edition                                                  ← a number that may change by edition/guideline
!Legal_Old_Code                                                  ← cites IPC/CrPC/IEA numbers
#Exam::NEETPG | #Exam::INICET | #Exam::Step1 | #Exam::Univ
#NMC::<Competency_Code>                                          ← only if the source shows e.g. AN2.1 / PY3.2
#Img                                                             ← card has an image
```
Subject slugs (use exactly): `Anatomy`, `Physiology`, `Biochemistry`, `Pathology`, `Pharmacology`, `Microbiology`, `ENT`, `Ophthalmology`, `PSM`, `FMT`, plus any the user adds.
Topic names: Title_Case_With_Underscores, ASCII only, ≤ 4 levels. AnKing-style reference: `#AK_Step1_v12::#B&B::18_Pulm::01_Intro::02_Pulm_Anatomy` (resource → numbered chapter → topic). If the user's source has numbered chapters, prefix `01_`, `02_` to keep order.
Deck name = `MBBS::<Subject>` (one level; organisation is in tags, like AnKing).

---

## 10. Workflow (do these steps, in this order, every time)

**Step 0 — Intake.** Confirm: subject(s), exam target, source book/teacher, desired density (default: AnKing-style high-yield+), output (default JSON). Note page range processed. If the page is not legible → say so before proceeding.
**Step 1 — Inventory.** Silently list the headings, tables, figures and boxed/emphasised items on the page(s).
**Step 2 — Fact table (internal).** For each distinct testable fact: `fact | source location | type (def/mech/list/number/…) | emphasis? | confidence (high/med/low)`. Drop low-confidence facts into the "needs your eyes" list.
**Step 3 — Dedupe & group.** Merge identical facts; group parallel items (lists/tables); mark overview-vs-item cards.
**Step 4 — Choose note type per fact** (§2 tree) and **pattern** (§5).
**Step 5 — Write.** Obey §3 grammar, §4 atomicity; add Extra for ≥ 2/3 of cards when the source supports it; add tags (§9).
**Step 6 — Self-QA (mandatory)** — run every card through this checklist; fix or delete:
 1. Can I point to the source line? (else delete / `[Not in source]`+`!Verify`)
 2. Exactly one correct answer from the stem? (else add context/hint or split)
 3. Smallest answer (≤3 words typical)?
 4. One fact only? (else split)
 5. Cloze numbering valid (c1…, no gaps), no nested/empty cloze, no `}}` inside answer?
 6. No answer leakage in stem/hint; hint ≤ 3 words?
 7. Bold on subject, underline on category; no forbidden tags; special characters escaped?
 8. Numbers/units/names identical to source? Abbreviations not invented?
 9. No duplicate of another card (same fact twice)?
 10. Tags present, valid, hierarchical; `!Verify` where needed?
**Step 7 — Calibrate against §1.** Over the whole batch check: median body ≈ 100 chars; ≥ 75% single-cloze-number; ≈ 12–20% of cloze deletions hinted; ~60–70% with Extra; ≤ 10% reveal-one-by-one; ≤ 5% Basic. Explain deviations (a list-heavy page is fine).
**Step 8 — Output** exactly per §11, then the report per §14.

---

## 11. Output formats

### 11.1 Primary: JSON for Anki Studio (Import cards)
Return ONE JSON object in a fenced ```json block (nothing else inside the block):

```json
{
  "deck_name": "MBBS::Pharmacology",
  "cards": [
    {
      "type": "Cloze",
      "question": "<b>Warfarin</b> inhibits {{c1::vitamin K epoxide reductase (VKORC1)}}",
      "answer": "<i>↓ factors II, VII, IX, X; monitored by INR</i>",
      "tags": ["MBBS::Pharmacology::Blood::Anticoagulants", "#Src::KDT::Ch_Anticoagulants", "~HY"],
      "sequential": false
    },
    {
      "type": "Basic",
      "question": "List the stages of …",
      "answer": "…",
      "tags": ["MBBS::…"]
    }
  ]
}
```
Rules: valid JSON (double quotes, no trailing commas, no comments); `type` ∈ `Cloze | Basic | Image Occlusion`; Cloze `question` must contain ≥ 1 `{{cN::…}}`; Basic needs both `question` and `answer`; `sequential` only on Cloze (omit or false otherwise); strings are HTML (§3.3). Split very large outputs into batches of ≤ 60 cards per JSON block, each a complete valid object with the same `deck_name`.

### 11.2 Secondary: TSV for real Anki (AnKing note type)
Tab-separated, 3 columns, no header: `Text<TAB>Extra<TAB>Tags` (tags space-separated). For reveal-one-by-one add a 4th column handled as the **One by one** field (`y`) and map fields during import (note type `AnKingOverhaul`). Escape tabs/newlines inside HTML with `<br>`; fields with `"` must be wrapped in quotes with `""` escaping. Say clearly which columns map to which fields.

### 11.3 Image-occlusion plan (when image bytes are not in the JSON)
```json
{
  "image_occlusion_plans": [
    {
      "image_ref": "page12_fig3 (describe: 'brachial plexus diagram, upper right')",
      "occlusion_mode": "hide-one",
      "masks": [
        {"id": "m1", "label": "Musculocutaneous nerve", "x": 0.12, "y": 0.18, "width": 0.14, "height": 0.05, "shape": "rect", "group": null},
        {"id": "m2", "label": "Radial nerve", "x": 0.55, "y": 0.62, "width": 0.12, "height": 0.05, "shape": "rect", "group": null}
      ],
      "answer": "<i>Figure 3 – branches of the brachial plexus</i>",
      "tags": ["MBBS::Anatomy::Upper_Limb::Brachial_Plexus", "#Img"],
      "confidence_note": "coordinates estimated by eye – verify in the mask editor"
    }
  ]
}
```
If the user *does* attach the image to the app's importer (`image_data` as a data URL), a card of `"type":"Image Occlusion"` with `masks` imports directly.

### 11.4 Do not
Do not output cards inside Markdown tables; do not output prose between cards; do not renumber clozes across cards (each card starts at c1); do not reuse the same `tags` string for unrelated subjects.

---

## 12. Anti-patterns → rewrites

| Bad | Why | Good |
|---|---|---|
| `{{c1::Warfarin inhibits vitamin K epoxide reductase and decreases factors II, VII, IX, X}}` | whole sentence hidden; two facts | `<b>Warfarin</b> inhibits {{c1::VKORC1}}` + `<b>Warfarin</b> ↓ factors {{c1::II, VII, IX, X}}` |
| `Causes of hypercalcaemia: {{c1::hyperparathyroidism, malignancy, vit D toxicity, sarcoidosis}}` | list in one blank, no reveal order | one-by-one cloze list, c1…c4, hint `4` or separate cards for the top 2 causes |
| `The drug of choice is {{c1::X}}.` | stem has no subject | `<u>Drug of choice</u> for <b>[condition]</b>: {{c1::X}}` |
| `Which of the following is NOT a feature of …` | negative, multi-answer | one card per feature, positive form |
| `{{c1::Streptococcus}} causes {{c2::pharyngitis}}` | both blanks vague; many organisms cause it | `<b>Rheumatic fever</b> follows pharyngitis by {{c1::group A β-haemolytic streptococci}}` |
| Stem containing the answer word (e.g., "…a cystic lesion called **cyst**…") | leakage | rewrite stem |
| Hint that gives the answer (`{{c1::Gentamicin::aminoglycoside}}` when the stem says "aminoglycoside") | useless | remove or change hint to `drug` |
| Nested/overlapping clozes | breaks Anki | restructure |
| A Basic card with a paragraph answer | not atomic | split into 3–6 clozes |
| Cards that cite "as above"/"see previous card" | not self-contained | add the context |
| Pasting a table into one card | unreadable, un-testable | §5.8 |
| Adding "also known to cause X" from memory | hallucination | delete or `[Not in source]`+`!Verify` |
| Different spellings of the same drug in one batch | inconsistent | choose the source's spelling |
| Bold on the cloze answer | bolding the answer cues the eye | bold the *context*, not the answer (unless the answer is also a key term used on other cards) |

---

## 13. Edge cases and judgement calls

- **Source has an error** (obvious typo or wrong fact): do **not** silently fix. Make the card as written, tag `!Verify`, and report under "Possible source errors" with your reasoning and certainty level.
- **Source is incomplete** (cut-off sentence): no card; list under "Needs your eyes".
- **Conflicting values across pages**: no card for the contested number; list under "Conflicts".
- **Out-of-scope subject** (user adds Medicine/Surgery/OBG/Paeds etc.): use the same grammar; create a `MBBS::<Subject>` slug and say so.
- **User wants "everything"**: still atomic; just more cards.
- **User gives a vague image** ("make cards from this") and it is unreadable: say what you can/can't read; ask for a clearer scan; produce nothing speculative.
- **Duplicates vs the user's existing deck:** you cannot see it; if the user pastes a list of existing front texts, avoid those facts.
- **Mnemonic invention:** only if the user asks; label it `[Mnemonic: mine]` in Extra and tag `!Verify`.
- **Clinical numbers (doses, thresholds):** copy exactly; `!Verify_Edition` when guideline-dependent.
- **Units:** keep the source's (mg/dL vs mmol/L); never convert unless asked.
- **Long answers** (e.g., "complications of X: 8 items"): reveal-one-by-one list + individual cards only for the top 2–3 high-yield items.
- **Images in Extra:** only if the user supplied the image file to the app; otherwise write `[Figure: <caption>]` and tag `#Img`.
- **Attaching the source's own figures / tables (do this whenever you can open the source file, e.g. a PDF in Claude Code):**
  1. Locate every printed figure/table (search the page text for `Fig.`/`Table`) and crop only the picture band (not the caption) at ~3x zoom with PyMuPDF; shrink to <= 1000 px wide, JPEG q~82 (~40 KB each). Look at a contact sheet of all crops before using them.
  2. Put the crop in the card's `answer` (Extra) as `<img src="data:image/jpeg;base64,...">` (the app/exporter turns it into a media file), then a plain caption line: `<Book> Fig. N - caption (Courtesy ...)` - keep the source's credit line.
  3. Attach the image to at most the two best cards per figure; other cards on the same figure get only the text reference `<Book> Fig. N`. A multi-panel figure (A/B/C) is attached whole.
  4. Tables: one crop of the whole table on the 3-4 most representative row cards; every row still gets its own text cards.
  5. Add 1 short source-grounded Extra (mechanism, association, "also seen with") to as many cards as the source supports - aim for >= 40% of cards, never invent.
  6. Copyright: images/cards derived from a user's book stay in the user's files. Never commit them to a public repo.
- **Language:** English output; keep Latin/Greek/eponym spellings as in the source.

---

## 14. Final response template (use verbatim structure)

```
**Source processed:** <what, which pages/images, quality notes>
**Settings assumed:** <subject, exam level, density, anything you assumed>
**Output:** <N> cards  (Cloze <a> · Cloze one-by-one <b> · Basic <c> · IO plans <d>)
**Batch check vs AnKing profile:** median length <x> chars · single-number cloze <y>% · hinted <z>% · with Extra <w>%

<JSON block(s) per §11.1>
<optional IO plan block per §11.3>

**Needs your eyes (!Verify):** numbered list with the exact card + why
**Possible source errors:** …
**Conflicts / skipped:** … (what you intentionally did not card and why)
**How to import:** Anki Studio → Import cards → paste JSON (or upload file). For real Anki → TSV (§11.2).
```
No extra commentary. No apologies. If nothing is flagged, write "None".

---

## 15. Appendix

**A. Abbreviations (expand only if the source expands them):** AR/AD/XR/XD (inheritance), DOC (drug of choice), IOC (investigation of choice), MOA, ADR, CI (contraindication), HY (high yield), PM (post-mortem), BC/AC (bone/air conduction), IOP, GFR, MAP.

**B. Symbols:** ↑ ↓ → ← ↔ ⇒ ≥ ≤ ≠ ± ° µ α β γ δ κ. Subscripts/superscripts via `<sub>/<sup>` (CO<sub>2</sub>, Ca<sup>2+</sup>).

**C. INN ↔ USAN quick map (put the non-source name in Extra):** paracetamol ↔ acetaminophen · adrenaline ↔ epinephrine · noradrenaline ↔ norepinephrine · frusemide ↔ furosemide · salbutamol ↔ albuterol · lignocaine ↔ lidocaine · pethidine ↔ meperidine · glyceryl trinitrate ↔ nitroglycerin · rifampicin ↔ rifampin · benzylpenicillin ↔ penicillin G.

**D. Indian legal-code map (FMT) — reference only; always tag `!Verify` and prefer the source's numbering:** IPC → BNS (2023/24): 299→100 (culpable homicide) · 300→101 (murder) · 302→103 (punishment for murder) · 304→105 · 304A→106(1) (death by negligence) · 304B→80 (dowry death) · 319→114 (hurt) · 320→116 (grievous hurt) · 375→63 (rape) · 376→64. CrPC → BNSS: 174→194 (inquest by police). If unsure of any mapping, write the old number from the source and add `<i>(new code number: verify)</i>`.

**E. Source-book shorthand for `#Src::` tags (use the user's, else these):** Anatomy – BDC (BD Chaurasia), Snell, Gray's · Physiology – Guyton, Ganong, AKJ (AK Jain) · Biochemistry – Harper, DMV (DM Vasudevan), Satyanarayana · Pathology – Robbins, HM (Harsh Mohan) · Pharmacology – KDT (KD Tripathi), Katzung · Microbiology – Ananthanarayan, Jawetz · ENT – Dhingra · Ophthalmology – Khurana, Parsons · PSM – Park · FMT – Reddy, Parikh.

**F. Worked end-to-end example**

*Source excerpt (typed notes, Pharmacology – Antitubercular drugs):*
```
Isoniazid (H): inhibits mycolic acid synthesis (InhA). SE: peripheral neuropathy (give pyridoxine), hepatitis. Fast vs slow acetylators.
Rifampicin (R): inhibits DNA-dependent RNA polymerase. Orange-red colour of urine, tears. Enzyme inducer.
Pyrazinamide (Z): hyperuricaemia. Ethambutol (E): optic neuritis (red-green colour blindness).
```
*Fact table (internal):* H-MOA; H-neuropathy+B6; H-hepatitis; H-acetylators; R-MOA; R-orange-red; R-inducer; Z-hyperuricaemia; E-optic neuritis.
*Choose types:* H-MOA, R-MOA, R-orange, R-inducer, Z, E → Cloze; "ADRs" overview → one-by-one list is optional (sources list only 4 drugs → individual cards enough).
*Output (JSON, condensed):*
```json
{"deck_name":"MBBS::Pharmacology","cards":[
{"type":"Cloze","question":"<b>Isoniazid</b> inhibits <u>mycolic acid</u> synthesis by inhibiting {{c1::InhA}}","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB","~HY"]},
{"type":"Cloze","question":"<b>Isoniazid</b> peripheral neuropathy is prevented with {{c1::pyridoxine (vitamin B<sub>6</sub>)}}","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB","~HY"]},
{"type":"Cloze","question":"<b>Rifampicin</b> inhibits {{c1::DNA-dependent RNA polymerase}}","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB"]},
{"type":"Cloze","question":"<b>Rifampicin</b> colours urine and tears {{c1::orange-red}}","answer":"<i>also a microsomal enzyme inducer</i>","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB","~HY"]},
{"type":"Cloze","question":"<b>Pyrazinamide</b> causes {{c1::hyperuricaemia}}","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB"]},
{"type":"Cloze","question":"<b>Ethambutol</b> toxicity: {{c1::optic neuritis}} (red–green colour blindness)","answer":"","tags":["MBBS::Pharmacology::Chemotherapy::Antitubercular_Drugs","#Src::KDT::AntiTB","~HY"]}
]}
```
*Skipped:* "hepatitis" and "acetylators" — the notes give no detail beyond the phrase; flagged under "Conflicts / skipped: too little content to make an unambiguous card — tell me if you want 'isoniazid → hepatitis' as a card."

**G. Self-test of your output before sending (30 seconds):** Pick three random cards. For each: cover the answer — is the stem unambiguous? Reveal — is it a single short fact? Search the source — is it there verbatim or near-verbatim? If any fail, redo the batch.

---
*End of skill. Version 1.0 — calibrated on AnKing v12 statistics; designed for Anki Studio (Cloze, Reveal-one-by-one cloze, Basic, Image Occlusion hide-all/hide-one/sequential/random).*
