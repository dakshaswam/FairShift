"""Local extraction → redaction → review → Muse → validation → checks."""

import json
import unicodedata
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

from .checks import review_checks
from .documents import extract_bytes, extract_text
from .errors import ApprovalError, FairShiftError, RedactionError, ResponseError
from .muse import request_extraction
from .privacy import assert_no_pii, redact_text
from .quiet import sensitive_operation
from .schema import Extraction, Paystub

Review = Callable[[str], str | None]
MAX_TEXT = 200_000


# C1 terminal controls and bidi overrides can conceal PII in a preview.
# Preserve ordinary Unicode letters, natural RTL text, ZWJ and ZWNJ.
_BIDI_CONTROLS = "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"


def _is_unsafe_control(c: str) -> bool:
    return (unicodedata.category(c) == "Cc" and c not in "\n\t") or c in _BIDI_CONTROLS


def _check_controls(text: str) -> None:
    if any(_is_unsafe_control(c) for c in text):
        raise RedactionError("Text contains unsafe display control characters. Prepare clean local text and review it again.")


def _clean_extracted(text: str) -> str:
    """Normalize newlines and drop stray controls that PDF/OCR text often carries
    (badly encoded fonts emit NULs and bells). Page breaks become newlines. Only
    raw local text is cleaned; approved text and model output are still rejected
    if they contain controls, so the worker always reviews exactly what is sent."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x0c", "\n").replace("\x0b", "\n")
    return "".join(" " if _is_unsafe_control(c) else c for c in text)


def _safe_text(text: str) -> None:
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise RedactionError("The redacted text is empty or too long. Review the input document.")
    _check_controls(text)


def prepare_paystub(file_path: str | Path) -> str:
    """Local-only step for a future UI. Returns preview text, never a mapping."""
    with sensitive_operation():
        try:
            raw_text = _clean_extracted(extract_text(file_path))
            _safe_text(raw_text)
            redacted = redact_text(raw_text)
            del raw_text
            _safe_text(redacted)
            return redacted
        except FairShiftError:
            raise
        except Exception:
            raise RedactionError("Local preparation failed. Check local OCR and redaction dependencies; nothing was sent.") from None


def prepare_paystub_bytes(document: bytes, suffix: str) -> str:
    """Web upload preparation, entirely in memory on this Python machine."""
    with sensitive_operation():
        try:
            raw_text = _clean_extracted(extract_bytes(document, suffix))
            _safe_text(raw_text)
            redacted = redact_text(raw_text)
            del raw_text
            _safe_text(redacted)
            return redacted
        except FairShiftError:
            raise
        except Exception:
            raise RedactionError("Local upload preparation failed. Check OCR and redaction dependencies; nothing was sent to Muse.") from None


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key.")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValueError("Non-finite JSON number.")


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _strings(child)


def _validate_response(response: str, approved_text: str) -> Paystub:
    try:
        if not isinstance(response, str) or len(response) > MAX_TEXT:
            raise ValueError("Response limit.")
        data = json.loads(response, parse_float=Decimal, parse_constant=_invalid_constant,
                          object_pairs_hook=_unique_object)
        extracted = Extraction.model_validate(data)
    except Exception:
        raise ResponseError("Muse returned invalid JSON or values that do not match the paystub schema. Nothing was saved.") from None

    try:
        # Include every string, including warnings/labels and internal fields.
        strings = list(_strings(data))
        for value in strings:
            _check_controls(value)
        # Text the worker already approved was screened before sending; only new
        # model text (a reconstructed value, an invented name) needs screening.
        # Screening approved values out of context misfires: a business name
        # such as "Brooklyn Bagels LLC" reads as a place on its own.
        approved = approved_text.casefold()
        new_strings = [value for value in strings if value.strip().casefold() not in approved]
        # A blank separator keeps unrelated fields from becoming a synthetic
        # label/value pair (for example Social Security + a deduction amount).
        if new_strings:
            assert_no_pii("\n\n".join(new_strings))
    except RedactionError:
        raise ResponseError("The model result failed local privacy screening. It was blocked and was not printed or saved.") from None
    stub = extracted.paystub
    has_payroll_data = any(v is not None for v in (
        stub.regular_hours, stub.regular_pay, stub.overtime_hours,
        stub.overtime_pay, stub.tips, stub.gross_pay, stub.net_pay,
    )) or bool(stub.deductions or stub.other_earnings)
    if not extracted.is_paystub or not has_payroll_data:
        raise ResponseError("This is not a recognizable paystub, or there is insufficient readable payroll data. Try a clearer paystub.")
    return _assume_usd(review_checks(stub, extracted.reconciliation, approved_text))


ASSUMED_USD = "The paystub doesn't show a currency, so FairShift assumes US dollars (USD)."


def _assume_usd(stub: Paystub) -> Paystub:
    """FairShift serves workers in the United States, so a paystub that prints no
    currency is in dollars. An explicit currency (for example CAD) is kept."""
    if stub.currency is not None:
        return stub
    notes = [note for note in stub.warnings if "currency" not in note.lower()]
    return stub.model_copy(update={"currency": "USD", "warnings": [ASSUMED_USD, *notes]})


def extract_paystub(file_path: str | Path, *, review: Review | None = None,
                    api_key: str | None = None, model: str | None = None) -> Paystub:
    """Return a validated Paystub, with no disk writes.

    review receives locally redacted text. It must display the EXACT text to this
    user, allow edits, and return the exact approved text, or None to cancel.
    Never implement review as an automatic identity callback in production.
    For asynchronous UIs use prepare_paystub, then complete_paystub after review.
    """
    if review is None:
        raise ApprovalError("A user review callback is required. Preview and approve the redacted text before any API call.")
    redacted = prepare_paystub(file_path)
    try:
        approved = review(redacted)
    except Exception:
        raise ApprovalError("Local review failed; nothing was sent. Reopen the preview and approve it explicitly.") from None
    if approved is None:
        raise ApprovalError("Review cancelled; nothing was sent.")
    return complete_paystub(approved, approved=True, api_key=api_key, model=model)


def complete_paystub(approved_text: str, *, approved: bool = False,
                     api_key: str | None = None, model: str | None = None) -> Paystub:
    """UI second step. approved=True attests this user approved this exact text.

    This library has no authentication/session storage. A backend must bind the
    preview and consent to the correct user; never accept a shared approval flag.
    """
    if approved is not True:
        raise ApprovalError("Explicit user approval of the exact redacted text is required; nothing was sent.")
    with sensitive_operation():
        try:
            _safe_text(approved_text)
            assert_no_pii(approved_text)
            response = request_extraction(approved_text, api_key=api_key, model=model)
            return _validate_response(response, approved_text)
        except FairShiftError:
            raise
        except Exception:
            raise ResponseError("Processing failed safely. Check dependencies and retry after reviewing the redacted text.") from None


AUTO_REDACTION_RETRIES = 2


def auto_send_paystub(redacted_text: str, *, api_key: str | None = None,
                      model: str | None = None) -> tuple[Paystub, str, int, bool]:
    """Send locally redacted text to Muse with no manual approval step.

    If the outbound privacy check still finds a possible identifier, the text is
    redacted again (the flagged spans become placeholders) and re-checked, up to
    AUTO_REDACTION_RETRIES times. If the check still objects after that, the text
    is sent anyway ("forced"); by then every detection has been redacted twice,
    so what remains is almost always a false alarm such as a field label.

    Returns (paystub, text_sent, redaction_retries, forced).
    """
    with sensitive_operation():
        try:
            text = redacted_text
            _safe_text(text)
            retries = 0
            forced = False
            while True:
                try:
                    assert_no_pii(text)
                    break
                except RedactionError:
                    if retries == AUTO_REDACTION_RETRIES:
                        forced = True
                        break
                    retries += 1
                    text = redact_text(text)
                    _safe_text(text)
            response = request_extraction(text, api_key=api_key, model=model)
            return _validate_response(response, text), text, retries, forced
        except FairShiftError:
            raise
        except Exception:
            raise ResponseError("Processing failed safely. Check dependencies and try the upload again.") from None
