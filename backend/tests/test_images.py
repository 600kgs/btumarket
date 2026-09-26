import io

import pytest
from PIL import Image

from images import process_image, thumb_path_for, webp_path_for, MAX_DIMENSION, THUMB_DIMENSION


def make_image_bytes(size, fmt="PNG", mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, size, color=(200, 50, 50)).save(buf, fmt)
    buf.seek(0)
    return buf.read()


def test_process_image_resizes_large_image_to_max_dimension():
    original = make_image_bytes((3000, 2000))
    result = process_image(original)

    full_img = Image.open(io.BytesIO(result.full_jpeg))
    assert max(full_img.size) <= MAX_DIMENSION
    assert full_img.format == "JPEG"

    thumb_img = Image.open(io.BytesIO(result.thumb_jpeg))
    assert max(thumb_img.size) <= THUMB_DIMENSION
    assert thumb_img.format == "JPEG"


def test_process_image_also_produces_matching_webp_variants():
    original = make_image_bytes((3000, 2000))
    result = process_image(original)

    full_webp = Image.open(io.BytesIO(result.full_webp))
    assert full_webp.format == "WEBP"
    assert full_webp.size == Image.open(io.BytesIO(result.full_jpeg)).size

    thumb_webp = Image.open(io.BytesIO(result.thumb_webp))
    assert thumb_webp.format == "WEBP"
    assert thumb_webp.size == Image.open(io.BytesIO(result.thumb_jpeg)).size


def test_process_image_leaves_small_image_dimensions_unchanged():
    original = make_image_bytes((200, 150))
    result = process_image(original)
    full_img = Image.open(io.BytesIO(result.full_jpeg))
    assert full_img.size == (200, 150)


def test_process_image_converts_rgba_to_rgb_jpeg():
    # RGBA (has transparency) - JPEG has no alpha channel, so this must not
    # crash and must produce a flattened RGB JPEG instead.
    original = make_image_bytes((100, 100), fmt="PNG", mode="RGBA")
    result = process_image(original)
    full_img = Image.open(io.BytesIO(result.full_jpeg))
    assert full_img.mode == "RGB"


def test_process_image_rejects_non_image_bytes():
    with pytest.raises(ValueError):
        process_image(b"this is not an image")


def test_thumb_path_for():
    assert thumb_path_for("uploads/123_abc.jpg") == "uploads/thumbs/123_abc.jpg"


def test_webp_path_for():
    assert webp_path_for("uploads/123_abc.jpg") == "uploads/123_abc.webp"
    assert webp_path_for("uploads/thumbs/123_abc.jpg") == "uploads/thumbs/123_abc.webp"
