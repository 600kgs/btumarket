"""Image processing for listing photos.

Every upload goes through process_image():
  1. Full decode proves the bytes are a real image (the declared
     content-type is client-supplied and not trusted).
  2. EXIF orientation is baked into the pixels so phone photos display
     upright.
  3. Conversion to RGB JPEG strips all EXIF metadata, including GPS.
  4. The full image is capped at MAX_DIMENSION on the long side.
  5. A thumbnail is emitted for listing cards.
  6. WebP versions of both sizes are emitted alongside the JPEGs; the
     frontend serves them via <picture> with JPEG as the fallback.
"""

from io import BytesIO
from typing import NamedTuple

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_DIMENSION = 1600   # long side of the full-size photo, px
THUMB_DIMENSION = 640  # long side of the card thumbnail, px
JPEG_QUALITY = 82
THUMB_QUALITY = 82
WEBP_QUALITY = 80


class ProcessedImage(NamedTuple):
    full_jpeg: bytes
    thumb_jpeg: bytes
    full_webp: bytes
    thumb_webp: bytes


def process_image(contents: bytes) -> ProcessedImage:
    """Raises ValueError if the bytes are not a decodable image."""
    try:
        img = Image.open(BytesIO(contents))
        img.load()  # force full decode so corrupt files fail here
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValueError("File is not a valid image.")

    img = ImageOps.exif_transpose(img)

    # JPEG has no alpha channel; flatten transparency onto white
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    full = img.copy()
    full.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    full_jpeg_buf = BytesIO()
    full.save(full_jpeg_buf, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    full_webp_buf = BytesIO()
    full.save(full_webp_buf, "WEBP", quality=WEBP_QUALITY)

    thumb = img.copy()
    thumb.thumbnail((THUMB_DIMENSION, THUMB_DIMENSION))
    thumb_jpeg_buf = BytesIO()
    thumb.save(thumb_jpeg_buf, "JPEG", quality=THUMB_QUALITY, optimize=True)
    thumb_webp_buf = BytesIO()
    thumb.save(thumb_webp_buf, "WEBP", quality=WEBP_QUALITY)

    return ProcessedImage(
        full_jpeg=full_jpeg_buf.getvalue(),
        thumb_jpeg=thumb_jpeg_buf.getvalue(),
        full_webp=full_webp_buf.getvalue(),
        thumb_webp=thumb_webp_buf.getvalue(),
    )


def thumb_path_for(file_path: str) -> str:
    """uploads/123_abc.jpg -> uploads/thumbs/123_abc.jpg"""
    directory, _, name = file_path.rpartition("/")
    return f"{directory}/thumbs/{name}"


def webp_path_for(file_path: str) -> str:
    """uploads/123_abc.jpg -> uploads/123_abc.webp; composes with
    thumb_path_for in either order."""
    return file_path.rsplit(".", 1)[0] + ".webp"
