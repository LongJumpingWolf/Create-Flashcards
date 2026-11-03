import io
import logging
import os
import random
import tempfile
import re
from base64 import b64decode
from html import escape as html_escape
from typing import List, Dict, Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
import genanki
from PIL import Image, ImageDraw

# --- Configuration ---
# NEW: Define a robust CSS structure for centering non-list content and handling lists cleanly.
DEFAULT_CARD_CSS = """
.card {
    font-family: arial;
    font-size: 20px;
    text-align: center; /* Main card content is centered on the card area */
    color: black;
    background-color: white;
    /* Basic max-width for better readability */
    max-width: 600px; 
    margin: 0 auto;
}

/* This is the key: Apply left-alignment to the *content* area itself, 
   while keeping the outer card centered. */
.editable-content {
    text-align: left; 
    /* display: inline-block allows the content div to shrink to content width 
       and be centered by the parent's text-align: center; */
    display: inline-block;
    padding: 0 10px;
}

.editable-content ul, 
.editable-content ol {
    /* Ensures list content is aligned left *within* the list container */
    text-align: left; 
    padding-left: 20px; 
    margin: 8px 0;
}
"""

# Standard Anki Basic Model (for Basic cards)
ANKI_BASIC_MODEL = genanki.Model(
    1607392319,
    'Simple Basic Model',
    fields=[
        {'name': 'Question'},
        {'name': 'Answer'},
    ],
    templates=[
        {
            'name': 'Card 1',
            # NEW: Wrap content in the .editable-content div for styling
            'qfmt': '<div class="editable-content">{{Question}}</div>',
            'afmt': '{{FrontSide}}<hr id="answer"><div class="editable-content">{{Answer}}</div>',
        },
    ],
    css=DEFAULT_CARD_CSS,
)

# Standard Anki Cloze Model (for Cloze cards)
ANKI_CLOZE_MODEL = genanki.Model(
    1607392320,
    'Simple Cloze Model',
    model_type=genanki.Model.CLOZE,
    fields=[
        {'name': 'Text'},
        {'name': 'Extra'},
    ],
    templates=[
        {
            'name': 'Cloze Card',
            # NEW: Wrap content in the .editable-content div for styling
            'qfmt': '<div class="editable-content">{{cloze:Text}}</div>',
            'afmt': '{{cloze:Text}}<br><hr id="answer"><div class="editable-content">{{Extra}}</div>',
        },
    ],
    # Append cloze-specific style for bolding the cloze
    css=DEFAULT_CARD_CSS + '.cloze { font-weight: bold; }', 
)

class AnkiImageOcclusionModel(genanki.Model):
    """Anki's stock Image Occlusion cloze notetype, represented in an APKG."""

    def to_json(self, timestamp: float, deck_id):
        model = super().to_json(timestamp, deck_id)
        # Anki 2.1.62+ uses this marker to identify native stock note types.
        model['originalStockKind'] = 6  # OriginalStockKind.ImageOcclusion
        return model


ANKI_IMAGE_OCCLUSION_MODEL = AnkiImageOcclusionModel(
    1607392321,
    'Image Occlusion',
    fields=[
        {'name': 'Occlusions', 'tag': 0, 'preventDeletion': True},
        {'name': 'Image', 'tag': 1, 'preventDeletion': True},
        {'name': 'Header', 'tag': 2, 'preventDeletion': True},
        {'name': 'Back Extra', 'tag': 3, 'preventDeletion': True},
        {'name': 'Comments', 'tag': 4, 'preventDeletion': False},
    ],
    templates=[{
        'name': 'Image Occlusion',
        'qfmt': '''{{#Header}}<div>{{Header}}</div>{{/Header}}
<div style="display:none">{{cloze:Occlusions}}</div>
<div id="err"></div>
<div id="image-occlusion-container">
    {{Image}}
    <canvas id="image-occlusion-canvas"></canvas>
</div>
<script>
try { anki.imageOcclusion.setup(); }
catch (exc) { document.getElementById("err").textContent = "Image Occlusion requires Anki 23.10 or newer: " + exc; }
</script>''',
        'afmt': '''{{#Header}}<div>{{Header}}</div>{{/Header}}
<div style="display:none">{{cloze:Occlusions}}</div>
<div id="err"></div>
<div id="image-occlusion-container">
    {{Image}}
    <canvas id="image-occlusion-canvas"></canvas>
</div>
<script>
try { anki.imageOcclusion.setup(); }
catch (exc) { document.getElementById("err").textContent = "Image Occlusion requires Anki 23.10 or newer: " + exc; }
</script>
<div><button id="toggle">Toggle Masks</button></div>
{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}''',
    }],
    css='''#image-occlusion-canvas {
    --inactive-shape-color: #ffeba2;
    --active-shape-color: #ff8e8e;
    --inactive-shape-border: 1px #212121;
    --active-shape-border: 1px #212121;
    --highlight-shape-color: #ff8e8e00;
    --highlight-shape-border: 1px #ff8e8e;
}
.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }''',
    model_type=genanki.Model.CLOZE,
    sort_field_index=1,
)


def _io_cloze_field(masks: list[dict], occlusion_mode: str) -> str:
    """Serialize vector regions in Anki's native image-occlusion cloze syntax."""
    grouped: dict[str, list[dict]] = {}
    for index, mask in enumerate(masks):
        grouped.setdefault(str(mask.get('group') or mask.get('id') or f'mask-{index + 1}'), []).append(mask)

    def display(value: float) -> str:
        # Match Anki's floatToDisplay convention: 4 decimal places, trim zeros.
        return f'{value:.4f}'.rstrip('0').rstrip('.') or '0'

    def escape_prop(value: str) -> str:
        return value.replace('\\', '\\\\').replace(':', '\\:')

    clozes = []
    for ordinal, group_masks in enumerate(grouped.values(), 1):
        for mask in group_masks:
            shape = mask.get('shape', 'rect')
            props = []
            if shape == 'ellipse':
                props.extend((('left', mask['x']), ('top', mask['y']),
                              ('rx', mask['width'] / 2), ('ry', mask['height'] / 2)))
            elif shape == 'polygon':
                points = ' '.join(f'{display(float(point["x"]))},{display(float(point["y"]))}'
                                  for point in mask.get('points', []))
                props.extend((('left', mask['x']), ('top', mask['y']), ('points', points)))
            else:
                props.extend((('left', mask['x']), ('top', mask['y']),
                              ('width', mask['width']), ('height', mask['height'])))
            if occlusion_mode == 'hide-all':
                props.append(('oi', '1'))
            encoded = ':'.join(f'{key}={escape_prop(str(value) if isinstance(value, str) else display(value))}'
                               for key, value in props)
            clozes.append(f'{{{{c{ordinal}::image-occlusion:{shape}:{encoded}}}}}<br>')
    return ''.join(clozes)


# --- FastAPI Models ---
logger = logging.getLogger(__name__)


class CardPayload(BaseModel):
    type: Literal["Basic", "Cloze", "Image Occlusion"]
    question: str = Field(default="", max_length=2_000_000)
    answer: str = Field(default="", max_length=2_000_000)
    tags: List[str] = Field(default_factory=list, max_length=50)
    image_data: str | None = None
    masks: List[dict] = Field(default_factory=list, max_length=300)
    occlusion_mode: Literal["hide-all", "hide-one"] = "hide-all"

    @field_validator("question")
    @classmethod
    def require_question_for_text_cards(cls, value: str, info):
        if info.data.get("type") != "Image Occlusion" and not value.strip():
            raise ValueError("Question cannot be empty")
        return value

class DeckPayload(BaseModel):
    deck_name: str = Field(min_length=1, max_length=100)
    cards: List[CardPayload] = Field(min_length=1, max_length=1000)

    @field_validator("deck_name")
    @classmethod
    def clean_deck_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Deck name cannot be empty")
        return cleaned

# --- Helpers ---
def extract_media_from_html(html_content: str) -> tuple[str, Dict[str, bytes]]:
    """
    Extracts base64 encoded images from HTML content, prepares data for genanki,
    and returns the modified HTML and a dictionary of filename: raw_bytes.
    """
    media_files = {}
    
    # Regex to find base64 images: <img src="data:image/png;base64,...">
    pattern = r'<img[^>]+src="data:(image/[^;]+);base64,([^"]+)"[^>]*>'
    matches = list(re.finditer(pattern, html_content, re.IGNORECASE))
    
    # Process matches in reverse order to avoid index issues on replace
    for match in reversed(matches):
        full_match = match.group(0)
        mime_type = match.group(1)
        base64_data = match.group(2)
        
        try:
            image_data = b64decode(base64_data)
            
            # Determine file extension
            ext = mime_type.split('/')[1]
            if not ext or len(ext) > 4: ext = 'png' # Fallback
            
            # Generate a unique filename
            filename = f"media_{random.randint(1000, 9999)}_{os.urandom(4).hex()}.{ext}"
            
            media_files[filename] = image_data
            
            # The replacement tag should only contain the filename for Anki
            # We specifically replace the entire original match to ensure clean HTML
            replacement_tag = f'<img src="{filename}" style="max-width:100%; height:auto;">'
            html_content = html_content[:match.start()] + replacement_tag + html_content[match.end():]
            
        except Exception as e:
            print(f"Error processing image: {e}")
            continue

    return html_content, media_files


def create_anki_deck(deck_payload: DeckPayload) -> bytes:
    """Creates a .apkg file in memory from the deck payload."""
    deck_id = random.randint(1000000000, 9999999999)
    deck = genanki.Deck(deck_id, deck_payload.deck_name)
    all_media_files = {}

    for card_data in deck_payload.cards:
        if card_data.type == "Image Occlusion":
            if not card_data.image_data or not card_data.image_data.startswith("data:image/") or not card_data.masks:
                raise ValueError("Image Occlusion cards need a source image and at least one mask")
            try:
                _, encoded = card_data.image_data.split(";base64,", 1)
                image = Image.open(io.BytesIO(b64decode(encoded))).convert("RGB")
            except Exception as exc:
                raise ValueError("Invalid image data for Image Occlusion") from exc
            if image.width * image.height > 40_000_000:
                raise ValueError("Image Occlusion source image is too large")

            normalized_masks = []
            groups: dict[str, list[dict]] = {}
            for index, source_mask in enumerate(card_data.masks):
                mask = dict(source_mask)
                shape = mask.get("shape", "rect")
                if shape not in {"rect", "ellipse", "polygon"}:
                    raise ValueError("Unsupported occlusion shape")
                for key in ("x", "y", "width", "height"):
                    value = mask.get(key)
                    if not isinstance(value, (int, float)) or not 0 <= value <= 1:
                        raise ValueError("Mask coordinates must be normalized between 0 and 1")
                if shape == "polygon":
                    points = mask.get("points", [])
                    if len(points) < 3:
                        raise ValueError("Polygon masks need at least three points")
                    for point in points:
                        if not (0 <= float(point.get("x", -1)) <= 1 and 0 <= float(point.get("y", -1)) <= 1):
                            raise ValueError("Polygon points must be normalized between 0 and 1")
                mask_id = str(mask.get("id") or f"mask-{index + 1}")
                group = str(mask.get("group") or mask_id)
                mask["id"] = mask_id
                mask["group"] = group
                normalized_masks.append(mask)
                groups.setdefault(group, []).append(mask)

            image_name = f"io_source_{os.urandom(8).hex()}.png"
            image_buffer = io.BytesIO()
            image.save(image_buffer, format="PNG")
            all_media_files[image_name] = image_buffer.getvalue()

            # Anki's native IO type stores all shapes as image-occlusion clozes
            # in one note. Anki then creates one sibling card per cloze ordinal.
            occlusions = _io_cloze_field(normalized_masks, card_data.occlusion_mode)
            note = genanki.Note(
                model=ANKI_IMAGE_OCCLUSION_MODEL,
                fields=[
                    occlusions,
                    f'<img src="{image_name}">',
                    '',
                    card_data.answer,
                    '',
                ],
                tags=card_data.tags,
            )
            deck.add_note(note)
            continue
        if card_data.type == "Basic":
            # Extract and replace images from question and answer
            q_html, q_media = extract_media_from_html(card_data.question)
            a_html, a_media = extract_media_from_html(card_data.answer)
            all_media_files.update(q_media)
            all_media_files.update(a_media)

            note = genanki.Note(
                model=ANKI_BASIC_MODEL,
                fields=[q_html, a_html],
                tags=card_data.tags
            )
            deck.add_note(note)

        elif card_data.type == "Cloze":
            # Extract and replace images from text and extra field
            t_html, t_media = extract_media_from_html(card_data.question)
            e_html, e_media = extract_media_from_html(card_data.answer)
            all_media_files.update(t_media)
            all_media_files.update(e_media)
            
            note = genanki.Note(
                model=ANKI_CLOZE_MODEL,
                fields=[t_html, e_html],
                tags=card_data.tags
            )
            deck.add_note(note)

    # Use a temporary directory for saving media files and generating the package
    with tempfile.TemporaryDirectory() as tmpdir:
        package = genanki.Package(deck)
        
        # Write all media files to disk within the temp directory
        temp_media_paths = []
        for filename, data in all_media_files.items():
            file_path = os.path.join(tmpdir, filename)
            with open(file_path, 'wb') as f:
                f.write(data)
            temp_media_paths.append(file_path)

        # Set the media files for the package (these are the *paths* to the files)
        package.media_files = temp_media_paths

        # Generate the apkg file into a BytesIO buffer
        apkg_buffer = io.BytesIO()
        
        # Correct method name is write_to_file
        package.write_to_file(apkg_buffer)
        
        return apkg_buffer.getvalue()


# --- FastAPI App Initialization ---
app = FastAPI()

# Add CORS middleware to allow the frontend to connect
origins = [
    "http://localhost:5173",  # Vite default
    "http://127.0.0.1:5173",
    "https://anki-flashcard-builder.vercel.app",  # Frontend deployed URL
    "https://create-flashcards.vercel.app",  # Current production frontend
    *[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()],
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Endpoint ---
@app.get("/")
async def root():
    """Simple landing response for the API service."""
    return {"service": "Create Flashcards API", "status": "ok", "health": "/health", "docs": "/docs"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/generate")
async def generate_anki_package(deck_payload: DeckPayload):
    """Generates an Anki .apkg file and returns it as a stream."""
    try:
        apkg_data = create_anki_deck(deck_payload)
        
        # Clean the deck name for use in Content-Disposition header
        filename = re.sub(r'[^a-zA-Z0-9_\s]', '', deck_payload.deck_name).lower().replace(' ', '_')
        if not filename:
            filename = "anki_deck"

        headers = {
            'Content-Disposition': f'attachment; filename="{filename}.apkg"',
            'Content-Type': 'application/octet-stream',
        }
        
        return Response(content=apkg_data, headers=headers)

    except Exception:
        logger.exception("Anki package generation failed")
        raise HTTPException(status_code=500, detail="Could not generate the Anki package. Check the deck content and try again.")
