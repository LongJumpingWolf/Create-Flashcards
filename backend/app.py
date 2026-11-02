import io
import logging
import os
import random
import tempfile
import re
from base64 import b64decode
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
                mime, encoded = card_data.image_data.split(";base64,", 1)
                image = Image.open(io.BytesIO(b64decode(encoded))).convert("RGB")
            except Exception as exc:
                raise ValueError("Invalid image data for Image Occlusion") from exc
            if image.width * image.height > 40_000_000:
                raise ValueError("Image Occlusion source image is too large")
            groups = {}
            for mask in card_data.masks:
                shape = mask.get("shape", "rect")
                if shape not in {"rect", "ellipse", "polygon"}:
                    raise ValueError("Unsupported occlusion shape")
                group = mask.get("group") or mask.get("id") or str(len(groups))
                groups.setdefault(group, []).append(mask)
            if not groups:
                raise ValueError("Image Occlusion cards need at least one mask")
            normalized_masks = []
            for mask in card_data.masks:
                for key in ("x", "y", "width", "height"):
                    if not isinstance(mask.get(key), (int, float)) or not 0 <= mask[key] <= 1:
                        raise ValueError("Mask coordinates must be normalized between 0 and 1")
                normalized_masks.append(mask)
            def render_occlusion(hidden_groups):
                result = image.copy()
                draw = ImageDraw.Draw(result)
                for mask in normalized_masks:
                    group = mask.get("group") or mask.get("id")
                    if group not in hidden_groups: continue
                    x0 = round(mask["x"] * image.width); y0 = round(mask["y"] * image.height)
                    x1 = round((mask["x"] + mask["width"]) * image.width); y1 = round((mask["y"] + mask["height"]) * image.height)
                    fill = (43, 51, 45)
                    if mask.get("shape") == "ellipse": draw.ellipse((x0, y0, x1, y1), fill=fill)
                    elif mask.get("shape") == "polygon":
                        points = [(round(point["x"] * image.width), round(point["y"] * image.height)) for point in mask.get("points", [])]
                        if len(points) >= 3: draw.polygon(points, fill=fill)
                    else: draw.rectangle((x0, y0, x1, y1), fill=fill)
                output = io.BytesIO(); result.save(output, format="PNG"); return output.getvalue()
            for index, (group, group_masks) in enumerate(groups.items(), 1):
                target_groups = set(groups) if card_data.occlusion_mode == "hide-all" else {group}
                shown_answer_groups = set(groups) - {group} if card_data.occlusion_mode == "hide-all" else set()
                q_name = f"occlusion_q_{os.urandom(6).hex()}.png"; a_name = f"occlusion_a_{os.urandom(6).hex()}.png"
                all_media_files[q_name] = render_occlusion(target_groups)
                all_media_files[a_name] = render_occlusion(shown_answer_groups)
                label = ", ".join(m.get("label", "").strip() for m in group_masks if m.get("label", "").strip())
                answer_html = f'<img src="{a_name}" style="max-width:100%;height:auto;"><br><strong>{label or f"Region {index}"}</strong>'
                if card_data.answer.strip(): answer_html += f'<hr>{card_data.answer}'
                note = genanki.Note(model=ANKI_BASIC_MODEL, fields=[f'<img src="{q_name}" style="max-width:100%;height:auto;">', answer_html], tags=card_data.tags)
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
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Endpoint ---
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
