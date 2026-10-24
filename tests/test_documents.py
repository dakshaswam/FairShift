"""Local parser/rendering checks; every Tesseract subprocess is MOCKED.

These checks never call Gemini, and do not claim live OCR accuracy.
All generated documents contain fictional text only.
"""

from __future__ import annotations

import builtins
import io
import logging
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

from PIL import Image
import pytest
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from fairshift_paystub import documents
from fairshift_paystub.errors import DocumentError


FICTIONAL_TEXT = "FICTIONAL PAYSTUB Employee: Morgan Testperson Gross pay: 1234.56"


def make_pdf(path: Path, pages: tuple[str, ...]) -> None:
    """Generate searchable, scanned, or mixed fictional PDF pages."""
    with io.BytesIO() as stream:
        canvas = Canvas(stream, pagesize=(612, 792))
        for kind in pages:
            if kind in {"scan", "scan-with-header"}:
                with Image.new("RGB", (240, 300), "white") as scan:
                    canvas.drawImage(ImageReader(scan), 0, 0, width=612, height=792)
            if kind in {"digital", "scan-with-header"}:
                canvas.drawString(24, 760, FICTIONAL_TEXT)
            canvas.showPage()
        canvas.save()
        path.write_bytes(stream.getvalue())


def mock_tesseract(monkeypatch, text: str = FICTIONAL_TEXT) -> Mock:
    """Mock ONLY the local OCR executable, retaining real image/PDF processing."""
    monkeypatch.setattr(documents.shutil, "which", lambda _: "tesseract")
    monkeypatch.delenv("TESSERACT_CMD", raising=False)
    monkeypatch.delenv("TESSERACT_LANGUAGE", raising=False)
    runner = Mock(return_value=SimpleNamespace(returncode=0, stdout=text.encode(), stderr=b""))
    real_run = subprocess.run

    def invoke(command, **kwargs):
        # Python's platform module may run a local Windows-version probe when
        # PDFium first imports. Mock the Tesseract boundary specifically.
        if isinstance(command, list) and command[0] == "tesseract":
            return runner(command, **kwargs)
        return real_run(command, **kwargs)

    monkeypatch.setattr(documents.subprocess, "run", invoke)
    return runner


def assert_ocr_pipe_boundary(runner: Mock) -> None:
    args, kwargs = runner.call_args
    assert args[0] == ["tesseract", "stdin", "stdout", "-l", "eng", "--dpi", "300", "--psm", "3"]
    assert kwargs["input"].startswith(b"\x89PNG\r\n\x1a\n")
    assert kwargs["stdout"] == subprocess.PIPE
    assert kwargs["stderr"] == subprocess.PIPE
    assert kwargs["shell"] is False
    assert kwargs["timeout"] == documents.OCR_TIMEOUT_SECONDS


def test_digital_pdf_uses_pdfplumber_without_ocr(tmp_path, monkeypatch):
    original = tmp_path / "fictional-digital.pdf"
    make_pdf(original, ("digital",))
    original_bytes = original.read_bytes()
    ocr = Mock(side_effect=AssertionError("Digital PDF unexpectedly used OCR"))
    monkeypatch.setattr(documents, "_ocr_image", ocr)

    result = documents.extract_text(original)

    assert FICTIONAL_TEXT in result
    ocr.assert_not_called()
    assert original.read_bytes() == original_bytes
    assert set(tmp_path.iterdir()) == {original}


def test_image_mocked_ocr_uses_memory_pipes_without_temp_files(tmp_path, monkeypatch, capsys):
    original = tmp_path / "fictional-personal-file.png"
    with Image.new("RGB", (100, 100), "white") as image:
        image.save(original)
    original_bytes = original.read_bytes()
    runner = mock_tesseract(monkeypatch)
    monkeypatch.setenv("TMP", str(tmp_path))
    monkeypatch.setenv("TEMP", str(tmp_path))

    assert documents.extract_text(original) == FICTIONAL_TEXT

    assert_ocr_pipe_boundary(runner)
    with Image.open(io.BytesIO(runner.call_args.kwargs["input"])) as prepared:
        assert prepared.size == (300, 300)
        assert prepared.mode == "L"
        assert sum(prepared.histogram()[1:-1]) == 0
    assert original.name not in repr(runner.call_args.args)
    assert original.read_bytes() == original_bytes
    assert set(tmp_path.iterdir()) == {original}
    captured = capsys.readouterr()
    assert not captured.out and not captured.err


def test_scan_pdf_renders_locally_before_mocked_tesseract(tmp_path, monkeypatch):
    original = tmp_path / "fictional-scan.pdf"
    make_pdf(original, ("scan",))
    original_bytes = original.read_bytes()
    runner = mock_tesseract(monkeypatch)

    assert documents.extract_text(original) == FICTIONAL_TEXT

    assert_ocr_pipe_boundary(runner)
    assert original.read_bytes() == original_bytes
    assert set(tmp_path.iterdir()) == {original}


def test_mixed_pdf_keeps_digital_page_and_locally_ocrs_scanned_page(tmp_path, monkeypatch):
    original = tmp_path / "fictional-mixed.pdf"
    make_pdf(original, ("digital", "scan"))
    runner = mock_tesseract(monkeypatch, "Fictional second page regular pay 1234.56")

    result = documents.extract_text(original)

    assert FICTIONAL_TEXT in result
    assert "Fictional second page regular pay 1234.56" in result
    assert runner.call_count == 1
    assert set(tmp_path.iterdir()) == {original}


def test_scanned_body_with_searchable_header_still_uses_ocr(tmp_path, monkeypatch):
    original = tmp_path / "fictional-header-and-scan.pdf"
    make_pdf(original, ("scan-with-header",))
    runner = mock_tesseract(monkeypatch, "Fictional scanned body regular pay 1234.56")

    assert documents.extract_text(original) == "Fictional scanned body regular pay 1234.56"

    runner.assert_called_once()


@pytest.mark.parametrize("failure", ["nonzero", "timeout", "empty"])
def test_mocked_ocr_failure_leaves_no_temp_files_or_sensitive_error(tmp_path, monkeypatch, capsys, failure):
    original = tmp_path / "fictional-sensitive-input.pdf"
    make_pdf(original, ("scan",))
    original_bytes = original.read_bytes()
    runner = mock_tesseract(monkeypatch)
    secret_error = "Morgan Testperson at C:/fictional-personal-path"
    if failure == "nonzero":
        runner.return_value = SimpleNamespace(returncode=1, stdout=b"", stderr=secret_error.encode())
    elif failure == "timeout":
        runner.side_effect = subprocess.TimeoutExpired(secret_error, 60)
    else:
        runner.return_value = SimpleNamespace(returncode=0, stdout=b"  ", stderr=b"")

    with pytest.raises(DocumentError) as caught:
        documents.extract_text(original)

    assert secret_error not in str(caught.value)
    assert original.name not in str(caught.value)
    assert "No file was uploaded" in str(caught.value)
    assert original.read_bytes() == original_bytes
    assert set(tmp_path.iterdir()) == {original}
    # This also checks that PDF/image file handles close when OCR fails.
    with original.open("rb+") as handle:
        assert handle.read(4) == b"%PDF"
    captured = capsys.readouterr()
    assert not captured.out and not captured.err


def test_missing_tesseract_fails_without_starting_process(tmp_path, monkeypatch):
    original = tmp_path / "fictional-photo.png"
    with Image.new("RGB", (100, 100), "white") as image:
        image.save(original)
    monkeypatch.setattr(documents.shutil, "which", lambda _: None)
    runner = Mock()
    monkeypatch.setattr(documents.subprocess, "run", runner)

    with pytest.raises(DocumentError, match="Local Tesseract OCR is missing"):
        documents.extract_text(original)

    runner.assert_not_called()
    assert set(tmp_path.iterdir()) == {original}


@pytest.mark.parametrize(
    ("module", "operation", "message"),
    [
        ("pdfplumber", lambda: documents._extract_pdf(b"fictional"), "requires pdfplumber"),
        ("pypdfium2", lambda: documents._render_pdf_page(b"fictional", 0), "require pypdfium2"),
        ("PIL", lambda: documents._extract_image(b"fictional"), "requires Pillow"),
    ],
)
def test_missing_python_dependencies_fail_helpfully(monkeypatch, module, operation, message):
    original_import = builtins.__import__

    def without_dependency(name, *args, **kwargs):
        if name == module:
            raise ImportError("fictional sensitive dependency details")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_dependency)
    with pytest.raises(DocumentError, match=message) as caught:
        operation()
    assert "sensitive dependency details" not in str(caught.value)


@pytest.mark.parametrize("suffix", [".pdf", ".png"])
def test_corrupt_input_errors_omit_personal_paths(tmp_path, suffix):
    original = tmp_path / ("fictional-sensitive-name" + suffix)
    original.write_bytes(b"this is not a document")

    with pytest.raises(DocumentError) as caught:
        documents.extract_text(original)

    assert str(tmp_path) not in str(caught.value)
    assert original.name not in str(caught.value)
    assert "this is not a document" not in str(caught.value)
    assert original.read_bytes() == b"this is not a document"
    assert set(tmp_path.iterdir()) == {original}


def test_missing_unsupported_empty_and_oversized_inputs_fail_locally(tmp_path, monkeypatch):
    with pytest.raises(DocumentError, match="not found"):
        documents.extract_text(tmp_path / "missing.pdf")
    unsupported = tmp_path / "fictional.txt"
    unsupported.write_text("fictional", encoding="utf-8")
    with pytest.raises(DocumentError, match="Unsupported input"):
        documents.extract_text(unsupported)
    empty = tmp_path / "fictional-empty.pdf"
    empty.touch()
    with pytest.raises(DocumentError, match="nonempty"):
        documents.extract_text(empty)
    oversized = tmp_path / "fictional-too-large.pdf"
    oversized.write_bytes(b"too big")
    monkeypatch.setattr(documents, "MAX_FILE_BYTES", 2)
    with pytest.raises(DocumentError, match="smaller than"):
        documents.extract_text(oversized)


def test_invalid_ocr_language_prevents_subprocess(monkeypatch):
    monkeypatch.setenv("TESSERACT_LANGUAGE", "../../fictional")
    runner = Mock()
    monkeypatch.setattr(documents.subprocess, "run", runner)
    with Image.new("RGB", (20, 20)) as image:
        with pytest.raises(DocumentError, match="installed language codes"):
            documents._ocr_image(image)
    runner.assert_not_called()


def test_oversized_render_rejected_before_allocating_bitmap(tmp_path, monkeypatch):
    original = tmp_path / "fictional-scan.pdf"
    make_pdf(original, ("scan",))
    monkeypatch.setattr(documents, "MAX_IMAGE_PIXELS", 2)
    with pytest.raises(DocumentError, match="too large to render"):
        documents.extract_text(original)
    assert set(tmp_path.iterdir()) == {original}


def test_dependency_debug_logging_never_records_document_or_path(tmp_path, caplog):
    original = tmp_path / "fictional-personal-filename.pdf"
    make_pdf(original, ("digital",))

    with caplog.at_level(logging.DEBUG):
        assert FICTIONAL_TEXT in documents.extract_text(original)

    assert FICTIONAL_TEXT not in caplog.text
    assert "Morgan Testperson" not in caplog.text
    assert original.name not in caplog.text
    assert str(tmp_path) not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)


def test_extract_bytes_digital_pdf_matches_file_extraction_without_writes(tmp_path, monkeypatch):
    original = tmp_path / "fictional-in-memory.pdf"
    make_pdf(original, ("digital",))
    document_bytes = original.read_bytes()
    monkeypatch.setattr(documents, "_ocr_image", Mock(side_effect=AssertionError("Unexpected OCR")))

    assert documents.extract_bytes(document_bytes, ".PDF") == documents.extract_text(original)
    assert original.read_bytes() == document_bytes
    assert set(tmp_path.iterdir()) == {original}


def test_extract_bytes_image_mocked_ocr_never_creates_upload_file(tmp_path, monkeypatch):
    with Image.new("RGB", (100, 100), "white") as image, io.BytesIO() as stream:
        image.save(stream, format="PNG")
        document_bytes = stream.getvalue()
    runner = mock_tesseract(monkeypatch)
    monkeypatch.chdir(tmp_path)

    assert documents.extract_bytes(document_bytes, ".png") == FICTIONAL_TEXT
    assert_ocr_pipe_boundary(runner)
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize(
    ("data", "suffix"),
    [(b"", ".pdf"), (None, ".pdf"), ("fictional", ".pdf"), (b"fictional", ".exe"), (b"fictional", None)],
)
def test_extract_bytes_invalid_upload_prevents_parsers(monkeypatch, data, suffix):
    pdf = Mock()
    image = Mock()
    monkeypatch.setattr(documents, "_extract_pdf", pdf)
    monkeypatch.setattr(documents, "_extract_image", image)

    with pytest.raises(DocumentError):
        documents.extract_bytes(data, suffix)

    pdf.assert_not_called()
    image.assert_not_called()


def test_extract_bytes_oversized_upload_rejected_before_parse(monkeypatch):
    monkeypatch.setattr(documents, "MAX_FILE_BYTES", 2)
    parser = Mock()
    monkeypatch.setattr(documents, "_extract_pdf", parser)

    with pytest.raises(DocumentError, match="smaller than"):
        documents.extract_bytes(b"fictional", ".pdf")

    parser.assert_not_called()


def test_extract_bytes_failure_never_writes_upload_or_ocr_file(tmp_path, monkeypatch, caplog):
    with Image.new("RGB", (100, 100), "white") as image, io.BytesIO() as stream:
        image.save(stream, format="PNG")
        document_bytes = stream.getvalue()
    runner = mock_tesseract(monkeypatch)
    runner.return_value = SimpleNamespace(returncode=1, stdout=b"", stderr=b"fictional personal error")
    monkeypatch.chdir(tmp_path)

    with caplog.at_level(logging.DEBUG), pytest.raises(DocumentError):
        documents.extract_bytes(document_bytes, ".png")

    assert "fictional personal error" not in caplog.text
    assert not list(tmp_path.iterdir())


def test_ocr_prep_flattens_transparency_onto_white():
    from PIL import Image
    from fairshift_paystub.documents import _prepare_for_ocr

    image = Image.new("RGBA", (400, 200), (0, 0, 0, 0))  # transparent background
    image.paste((0, 0, 0, 255), (50, 50, 150, 100))  # dark text block
    prepared = _prepare_for_ocr(image)
    scale = prepared.width // image.width  # small images are enlarged
    assert prepared.getpixel((5 * scale, 5 * scale)) > 200  # background is light, not black
    assert prepared.getpixel((60 * scale, 60 * scale)) < 50


def test_ocr_prep_keeps_gray_paper_light_and_text_dark():
    from PIL import Image
    from fairshift_paystub.documents import _prepare_for_ocr

    image = Image.new("RGB", (400, 200), (180, 180, 180))  # paper under room lighting
    image.paste((60, 60, 60), (50, 50, 150, 100))
    prepared = _prepare_for_ocr(image)
    scale = prepared.width // image.width
    assert prepared.getpixel((5 * scale, 5 * scale)) > 200
    assert prepared.getpixel((60 * scale, 60 * scale)) < 50


def test_ocr_prep_only_enlarges_small_images():
    from PIL import Image
    from fairshift_paystub.documents import OCR_UPSCALE_MAX, _prepare_for_ocr

    assert _prepare_for_ocr(Image.new("RGB", (2550, 3300), "white")).size == (2550, 3300)
    small = _prepare_for_ocr(Image.new("RGB", (500, 400), "white"))
    assert small.size == (500 * OCR_UPSCALE_MAX, 400 * OCR_UPSCALE_MAX)
