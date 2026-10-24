"""Extract text on this machine. No network calls or sensitive temporary files.

Tesseract receives an in-memory PNG through stdin and returns text through stdout.
The original input is only read. Neither OCR text nor rendered pages are saved.
"""

from __future__ import annotations

import io
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import warnings

from .errors import DocumentError
from .quiet import sensitive_operation


MAX_FILE_BYTES = 30 * 1024 * 1024
MAX_PAGES = 20
MAX_IMAGE_PIXELS = 40_000_000
MAX_TEXT_CHARACTERS = 200_000
OCR_TIMEOUT_SECONDS = 60
OCR_UPSCALE_MAX = 3
# Small photos are enlarged until their long side reaches this; larger ones are left alone.
OCR_TARGET_LONG_SIDE = 3000
PDF_RENDER_SCALE = 300 / 72
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}

# PDFium is not thread-safe, including calls involving different documents.
# This mutex contains no user data. Use separate processes to parallelize OCR.
_PDFIUM_LOCK = threading.Lock()


def _check_text_size(text: str) -> str:
    if len(text) > MAX_TEXT_CHARACTERS:
        raise DocumentError("The extracted text is too large. Use a shorter paystub.")
    return text


def _ocr_image(image) -> str:
    """Run local Tesseract using pipes; do not create any temporary files."""
    from PIL import Image

    executable = os.environ.get("TESSERACT_CMD", "tesseract")
    language = os.environ.get("TESSERACT_LANGUAGE", "eng")
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*", language):
        raise DocumentError("TESSERACT_LANGUAGE must contain installed language codes, such as eng or eng+spa.")
    if not shutil.which(executable):
        raise DocumentError(
            "Local Tesseract OCR is missing. Install Tesseract and its English language data, "
            "then add it to PATH or set TESSERACT_CMD to its executable. No file was uploaded."
        )
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise DocumentError("The image is too large. Resize it locally before trying again.")

    try:
        with _prepare_for_ocr(image) as prepared, io.BytesIO() as encoded:
            prepared.save(encoded, format="PNG")
            result = subprocess.run(
                [executable, "stdin", "stdout", "-l", language, "--dpi", "300", "--psm", "3"],
                input=encoded.getvalue(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=OCR_TIMEOUT_SECONDS,
                check=False,
                shell=False,
                # Prevent a console window when this module is imported by a Windows UI.
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        if result.returncode != 0:
            raise DocumentError(
                "Local OCR failed. Check that Tesseract and the selected language data are installed, "
                "and try a clearer image. No file was uploaded."
            )
        text = result.stdout.decode("utf-8").strip()
    except subprocess.TimeoutExpired:
        raise DocumentError("Local OCR timed out. Try a smaller, clearer image. No file was uploaded.") from None
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("Local OCR could not read the image. Check the local OCR installation. No file was uploaded.") from None

    if not text:
        raise DocumentError("Local OCR found no readable text. Try a clearer image. No file was uploaded.")
    return _check_text_size(text)


def _prepare_for_ocr(image):
    """Grayscale, contrast-stretched copy for Tesseract, enlarged only when small.

    Transparent pixels are flattened onto white first; otherwise they turn black.
    No fixed black/white cutoff is applied: photographed paper is often mid-gray,
    and Tesseract's own adaptive thresholding handles uneven lighting better.
    """
    from PIL import Image, ImageOps

    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        flattened = Image.new("RGB", rgba.size, "white")
        flattened.paste(rgba, mask=rgba.getchannel("A"))
        rgba.close()
        grayscale = flattened.convert("L")
        flattened.close()
    else:
        grayscale = image.convert("L")

    scale = min(
        OCR_UPSCALE_MAX,
        max(1.0, OCR_TARGET_LONG_SIDE / max(image.width, image.height)),
        math.sqrt(MAX_IMAGE_PIXELS / (image.width * image.height)),
    )
    if scale > 1:
        size = (int(image.width * scale), int(image.height * scale))
        enlarged = grayscale.resize(size, Image.Resampling.LANCZOS)
        grayscale.close()
        grayscale = enlarged
    stretched = ImageOps.autocontrast(grayscale, cutoff=1)
    grayscale.close()
    return stretched


def _render_pdf_page(document_bytes: bytes, page_index: int):
    """Return an independent PIL image; release PDFium handles before returning."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        raise DocumentError("Scanned PDFs require pypdfium2. Install the Python requirements and try again.") from None

    try:
        with _PDFIUM_LOCK:
            document = pdfium.PdfDocument(document_bytes)
            try:
                page = document[page_index]
                try:
                    width, height = page.get_size()
                    pixels = math.ceil(width * PDF_RENDER_SCALE) * math.ceil(height * PDF_RENDER_SCALE)
                    if pixels > MAX_IMAGE_PIXELS:
                        raise DocumentError("A PDF page is too large to render. Resize it locally before trying again.")
                    bitmap = page.render(scale=PDF_RENDER_SCALE)
                    try:
                        with bitmap.to_pil() as image:
                            # to_pil() can share the PDFium buffer. Copy before closing it.
                            return image.copy()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
            finally:
                document.close()
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("The scanned PDF could not be rendered locally. Try an unlocked, valid PDF.") from None


def _needs_ocr(page, text: str) -> bool:
    if sum(character.isalnum() for character in text) < 30:
        return True
    # A scan can have a tiny searchable header over a large raster body. Do not
    # mistake that header for successful extraction of the full paystub.
    page_area = float(page.width) * float(page.height)
    image_area = sum(
        max(0, float(item.get("x1", 0)) - float(item.get("x0", 0)))
        * max(0, float(item.get("bottom", 0)) - float(item.get("top", 0)))
        for item in page.images
    )
    return page_area > 0 and image_area / page_area >= 0.6


def _extract_pdf(document_bytes: bytes) -> str:
    try:
        import pdfplumber
    except ImportError:
        raise DocumentError("PDF text extraction requires pdfplumber. Install the Python requirements and try again.") from None

    try:
        parts = []
        with io.BytesIO(document_bytes) as stream, pdfplumber.open(stream, strict_metadata=True) as document:
            if not 1 <= len(document.pages) <= MAX_PAGES:
                raise DocumentError("Use a PDF containing between 1 and 20 pages.")
            for index, page in enumerate(document.pages):
                try:
                    text = (page.extract_text(layout=False) or "").strip()
                    if _needs_ocr(page, text):
                        with _render_pdf_page(document_bytes, index) as image:
                            text = _ocr_image(image)
                    parts.append(text)
                    _check_text_size("\n\n".join(parts))
                finally:
                    page.close()
        return "\n\n".join(parts)
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("The PDF could not be read locally. Check that it is valid and not password-protected.") from None


def _extract_image(document_bytes: bytes) -> str:
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise DocumentError("Image OCR requires Pillow. Install the Python requirements and try again.") from None

    try:
        parts = []
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with io.BytesIO(document_bytes) as stream, Image.open(stream) as image:
                frames = getattr(image, "n_frames", 1)
                if not 1 <= frames <= MAX_PAGES:
                    raise DocumentError("Use an image containing between 1 and 20 frames.")
                for index in range(frames):
                    image.seek(index)
                    if image.width * image.height > MAX_IMAGE_PIXELS:
                        raise DocumentError("The image is too large. Resize it locally before trying again.")
                    with ImageOps.exif_transpose(image) as oriented:
                        parts.append(_ocr_image(oriented))
                    _check_text_size("\n\n".join(parts))
        return "\n\n".join(parts)
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("The image could not be read locally. Use a valid PNG, JPEG, TIFF, BMP, or WebP image.") from None


def _extract_text(file_path: str | Path) -> str:
    try:
        path = Path(file_path)
        if not path.is_file():
            raise DocumentError("The input file was not found. Check the selected file.")
        suffix = path.suffix.lower()
        if suffix != ".pdf" and suffix not in IMAGE_SUFFIXES:
            raise DocumentError("Unsupported input. Use a PDF, PNG, JPEG, TIFF, BMP, or WebP file.")
        if not 0 < path.stat().st_size <= MAX_FILE_BYTES:
            raise DocumentError("Use a nonempty input file smaller than 30 MiB.")
        with path.open("rb") as stream:
            # Bounded read also protects against a file growing after stat().
            document_bytes = stream.read(MAX_FILE_BYTES + 1)
        if len(document_bytes) > MAX_FILE_BYTES:
            raise DocumentError("Use an input file smaller than 30 MiB.")
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("The input file could not be opened. Check that it exists and is readable.") from None

    return extract_bytes(document_bytes, suffix)


def extract_bytes(document_bytes: bytes, suffix: str) -> str:
    """Extract an uploaded document in memory on the Python module's machine.

    A web backend may pass its bounded upload bytes and an extension such as
    ".pdf" or ".png". This never saves the upload, OCR text, or rendered pages.
    It uses exactly the same local parsers, OCR, limits, and errors as files.
    """
    with sensitive_operation():
        if not isinstance(document_bytes, bytes) or not 0 < len(document_bytes) <= MAX_FILE_BYTES:
            raise DocumentError("Use nonempty document bytes smaller than 30 MiB.")
        if not isinstance(suffix, str):
            raise DocumentError("Unsupported input. Use a PDF, PNG, JPEG, TIFF, BMP, or WebP file.")
        suffix = suffix.lower()
        if suffix != ".pdf" and suffix not in IMAGE_SUFFIXES:
            raise DocumentError("Unsupported input. Use a PDF, PNG, JPEG, TIFF, BMP, or WebP file.")
        try:
            text = _extract_pdf(document_bytes) if suffix == ".pdf" else _extract_image(document_bytes)
            if not text.strip():
                raise DocumentError("No readable text was found locally. Try a clearer copy. No file was uploaded.")
            return _check_text_size(text)
        except DocumentError:
            raise
        except Exception:
            raise DocumentError("The document could not be read locally. Check the file and local OCR installation. No file was uploaded.") from None


def extract_text(file_path: str | Path) -> str:
    """Read a PDF/photo locally, using pdfplumber or local Tesseract OCR.

    "Local" means the computer running this Python module. A future hosted
    backend receives the original input unless OCR moves to the user's device.
    This function creates no files and never deletes the original input.
    Dependency log records are sanitized in this execution context, including
    when the embedding application enables verbose PDF parser logging.
    """
    with sensitive_operation():
        return _extract_text(file_path)
