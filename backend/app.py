import io
import logging
import os
import random
import tempfile
import re
import uuid
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

IOE_FIELDS = [
    'ID (hidden)', 'Header', 'Image', 'Question Mask', 'Footer', 'Remarks',
    'Sources', 'Extra 1', 'Extra 2', 'Answer Mask', 'Original Mask',
]
IOE_CARD_CSS = '''
.card { font-family: Arial, sans-serif; font-size: 20px; text-align: center; color: #202521; background: #fff; }
#io-header, #io-footer { margin: .5em auto; max-width: 90%; }
#io-wrapper { position: relative; display: inline-block; max-width: 100%; margin: 0 auto; line-height: 0; }
#io-original { position: relative; z-index: 1; }
#io-original img { display: block; max-width: 100%; height: auto; }
#io-overlay { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; }
#io-overlay img { display: block; width: 100%; height: 100%; object-fit: fill; }
#io-revl-btn { display: block; margin: .8em auto; padding: .35em .8em; }
#io-extra-wrapper { width: min(80%, 42rem); margin: .8em auto; text-align: left; line-height: 1.5; }
.io-extra-entry { margin-top: .6em; }
.io-field-descr { font-weight: 700; margin-bottom: .15em; }
'''
IOE_QFMT = '''{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="io-wrapper"><div id="io-overlay">{{Question Mask}}</div><div id="io-original">{{Image}}</div></div>
{{#Footer}}<div id="io-footer">{{Footer}}</div>{{/Footer}}
{{/Image}}'''
IOE_AFMT = '''{{#Image}}
<div id="io-header">{{Header}}</div>
<div id="io-wrapper"><div id="io-overlay">{{Answer Mask}}</div><div id="io-original">{{Image}}</div></div>
{{#Footer}}<div id="io-footer">{{Footer}}</div>{{/Footer}}
<button id="io-revl-btn" onclick="var m=document.getElementById('io-overlay');m.style.display=m.style.display==='none'?'block':'none'">Toggle Masks</button>
<div id="io-extra-wrapper">
{{#Remarks}}<div class="io-extra-entry"><div class="io-field-descr">Remarks</div>{{Remarks}}</div>{{/Remarks}}
{{#Sources}}<div class="io-extra-entry"><div class="io-field-descr">Sources</div>{{Sources}}</div>{{/Sources}}
{{#Extra 1}}<div class="io-extra-entry">{{Extra 1}}</div>{{/Extra 1}}
{{#Extra 2}}<div class="io-extra-entry">{{Extra 2}}</div>{{/Extra 2}}
</div>
{{/Image}}'''
ANKI_IMAGE_OCCLUSION_ENHANCED_MODEL = genanki.Model(
    1607392322,
    'Image Occlusion Enhanced',
    fields=[{'name': name} for name in IOE_FIELDS],
    templates=[{'name': 'IO Card', 'qfmt': IOE_QFMT, 'afmt': IOE_AFMT}],
    css=IOE_CARD_CSS,
    sort_field_index=1,
)


# --- FastAPI Models ---
logger = logging.getLogger(__name__)


class CardPayload(BaseModel):
    type: Literal["Basic", "Cloze", "Image Occlusion"]
    question: str = Field(default="", max_length=2_000_000)
    answer: str = Field(default="", max_length=2_000_000)
    tags: List[str] = Field(default_factory=list, max_length=50)
    image_data: str | None = None
    image_width: int = Field(default=720, ge=180, le=1800)
    masks: List[dict] = Field(default_factory=list, max_length=300)
    occlusion_mode: Literal["hide-all", "hide-one"] = "hide-all"

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: List[str]) -> List[str]:
        # genanki raises on tags containing whitespace; Anki tags cannot contain spaces.
        return [re.sub(r'\s+', '_', tag.strip()) for tag in value if tag and tag.strip()]

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
            ext = {'jpeg': 'jpg', 'svg+xml': 'svg'}.get(mime_type.split('/')[1].lower(), mime_type.split('/')[1].lower())
            if not re.fullmatch(r'[a-z0-9]{1,4}', ext): ext = 'png' # Fallback
            
            # Generate a unique filename
            filename = f"media_{random.randint(1000, 9999)}_{os.urandom(4).hex()}.{ext}"
            
            media_files[filename] = image_data
            
            # The replacement tag should only contain the filename for Anki
            # We specifically replace the entire original match to ensure clean HTML
            replacement_tag = f'<img src="{filename}" style="max-width:100%; height:auto;">'
            html_content = html_content[:match.start()] + replacement_tag + html_content[match.end():]
            
        except Exception as e:
            logger.warning("Error processing embedded image: %s", e)
            continue

    return html_content, media_files


def _ioe_svg_shape(mask: dict, image_width: int, image_height: int, fill: str, shape_id: str) -> str:
    """Serialize a normalized app mask as an IOE-editable SVG shape."""
    x, y = float(mask['x']) * image_width, float(mask['y']) * image_height
    width, height = float(mask['width']) * image_width, float(mask['height']) * image_height
    common = f'id="{html_escape(shape_id, quote=True)}" fill="{fill}" stroke="#2D2D2D" stroke-width="2"'
    if mask.get('shape') == 'ellipse':
        return f'<ellipse {common} cx="{x + width / 2:.3f}" cy="{y + height / 2:.3f}" rx="{width / 2:.3f}" ry="{height / 2:.3f}" />'
    if mask.get('shape') == 'polygon':
        points = ' '.join(
            f'{float(point["x"]) * image_width:.3f},{float(point["y"]) * image_height:.3f}'
            for point in mask.get('points', [])
        )
        return f'<polygon {common} points="{points}" />'
    return f'<rect {common} x="{x:.3f}" y="{y:.3f}" width="{width:.3f}" height="{height:.3f}" />'


def _ioe_mask_svg(image_width: int, image_height: int, mask_groups: list[list[dict]],
                  mode: str, target_index: int | None, side: str, session_id: str) -> str:
    """Build one SVG mask in Image Occlusion Enhanced's layered note format."""
    elements = []
    for index, group in enumerate(mask_groups):
        if side == 'A' and (mode == 'oa' or index == target_index):
            continue
        if side == 'Q' and mode == 'oa' and index != target_index:
            continue
        fill = '#FF7E7E' if index == target_index else '#FFEBA2'
        shape_id = f'{session_id}-{mode}-{index + 1}'
        if len(group) > 1:
            children = ''.join(_ioe_svg_shape(mask, image_width, image_height, fill, f'{shape_id}-{child + 1}')
                               for child, mask in enumerate(group))
            elements.append(f'<g id="{shape_id}">{children}</g>')
        else:
            elements.append(_ioe_svg_shape(group[0], image_width, image_height, fill, shape_id))
    svg_id = html_escape(f'{session_id}-{mode}-{side}', quote=True)
    svg_elements = ''.join(elements)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
        f'width="{image_width}" height="{image_height}" viewBox="0 0 {image_width} {image_height}" id="{svg_id}">'
        f'<g inkscape:groupmode="layer" inkscape:label="Masks" id="ioe-mask-layer">{svg_elements}</g></svg>'
    )


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
                        try:
                            px, py = float(point.get("x", -1)), float(point.get("y", -1))
                        except (TypeError, ValueError, AttributeError):
                            raise ValueError("Polygon points must be normalized between 0 and 1")
                        if not (0 <= px <= 1 and 0 <= py <= 1):
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
            mask_groups = list(groups.values())
            mode = 'ao' if card_data.occlusion_mode == 'hide-all' else 'oa'
            session_id = uuid.uuid4().hex
            original_mask_name = f'{session_id}-{mode}-O.svg'
            all_media_files[original_mask_name] = _ioe_mask_svg(
                image.width, image.height, mask_groups, mode, None, 'O', session_id
            ).encode('utf-8')

            for target_index in range(len(mask_groups)):
                note_id = f'{session_id}-{mode}-{target_index + 1}'
                question_mask_name = f'{note_id}-Q.svg'
                answer_mask_name = f'{note_id}-A.svg'
                all_media_files[question_mask_name] = _ioe_mask_svg(
                    image.width, image.height, mask_groups, mode, target_index, 'Q', session_id
                ).encode('utf-8')
                all_media_files[answer_mask_name] = _ioe_mask_svg(
                    image.width, image.height, mask_groups, mode, target_index, 'A', session_id
                ).encode('utf-8')
                image_tag = f'<img src="{image_name}" style="width:{card_data.image_width}px;max-width:100%;height:auto">'
                mask_tag_style = 'style="display:block;width:100%;height:100%"'
                fields = [
                    note_id,
                    '',
                    image_tag,
                    f'<img src="{question_mask_name}" {mask_tag_style}>',
                    '',
                    '',
                    '',
                    card_data.answer,
                    '',
                    f'<img src="{answer_mask_name}" {mask_tag_style}>',
                    f'<img src="{original_mask_name}">',
                ]
                deck.add_note(genanki.Note(
                    model=ANKI_IMAGE_OCCLUSION_ENHANCED_MODEL,
                    fields=fields,
                    tags=card_data.tags,
                ))
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

    except ValueError as exc:
        # Validation problems with the user's content (e.g. bad image/mask data) are client errors.
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("Anki package generation failed")
        raise HTTPException(status_code=500, detail="Could not generate the Anki package. Check the deck content and try again.")
