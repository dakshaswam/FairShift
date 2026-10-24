"""Local, fail-closed redaction; no original-value lookup table is constructed.

English Presidio NER is supplemented by payroll labels and identifier patterns.
Detection is imperfect (particularly with OCR errors and non-English addresses),
so callers must also obtain human review of the exact text sent to the API.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import re

from .errors import RedactionError
from .quiet import sensitive_operation


_MODEL = "en_core_web_lg"
_PLACEHOLDER = re.compile(r"\[(?:NAME|SSN|EMPLOYEE_ID|ADDRESS|EMAIL|PHONE|ACCOUNT|ROUTING|PII)_\d+\]")
# A NER model can mistake a currency code such as USD for a location. These
# literal ISO codes carry payroll meaning and must survive redaction.
_CURRENCY_CODES = frozenset(
    "USD EUR GBP CAD AUD NZD MXN BRL CNY JPY KRW INR PHP VND CHF HKD SGD TWD THB "
    "IDR MYR BDT PKR LKR NPR AED SAR QAR KWD BHD OMR ILS TRY UAH PLN CZK HUF RON "
    "BGN DKK NOK SEK ISK ZAR NGN KES GHS EGP MAD ETB TZS UGX XOF XAF CLP COP PEN "
    "ARS UYU DOP GTQ HNL NIO CRC PAB BOB PYG HTG JMD TTD BZD BBD BSD XCD".split()
)


@dataclass(frozen=True)
class _Span:
    start: int
    end: int
    kind: str


# Longer labels must precede their shorter alternatives. Only values are masked;
# keeping labels lets the extraction model understand the remaining payroll text.
_LABELS = (
    ("SSN", r"(?:social[ \t]+security(?:[ \t]+(?:number|no\.?))?|ssn|ss[ \t]*#)(?![ \t]+(?:tax|withheld|deduction|wages))(?:[ \t]+\(?[ \t]*(?:last[ \t]*(?:four|4)(?:[ \t]+digits)?|ending(?:[ \t]+in)?)[ \t]*\)?)?"),
    ("EMPLOYEE_ID", r"(?:employee|emp\.?|worker|payroll)[ \t]*(?:id|number|no\.?|#)(?:[ \t]+number)?"),
    ("NAME", r"(?:employee|worker)(?:[ \t]+name)?(?![ \t]+(?:id|number|no\.?|#|address|tax|contributions?|deductions?|benefits?))|payee(?:[ \t]+name)?|(?:paid|pay)[ \t]+to(?:[ \t]+the[ \t]+order[ \t]+of)?|name"),
    ("ADDRESS", r"(?:(?:employee|worker|personal|home|mailing|residential)[ \t]+)?address"),
    ("EMAIL", r"(?:e-?mail)(?:[ \t]+address)?"),
    ("PHONE", r"(?:phone|telephone|mobile|cell)(?:[ \t]+(?:number|no\.?))?"),
    ("ROUTING", r"(?:aba[ \t]+)?(?:routing|transit)(?:[ \t]+(?:number|no\.?|#))?"),
    ("ACCOUNT", r"(?:(?:bank|checking|savings)[ \t]+)?(?:account|acct\.?)(?:[ \t]+(?:number|no\.?|#))?(?:[ \t]+\(?[ \t]*(?:ending(?:[ \t]+in)?|last[ \t]*(?:four|4)(?:[ \t]+digits)?)[ \t]*\)?)?"),
)
_SEPARATOR = r"(?:[ \t]*(?::|=|#)[ \t]*|[ \t]{2,}|(?<=#)(?=\w)|$)"
_UNPUNCTUATED_VALUE = {
    "NAME": r"(?-i:[A-Z])",
    "SSN": r"[\dXx*•]",
    "EMPLOYEE_ID": r"[A-Za-z0-9*-]*\d",
    "ADDRESS": r"(?:\d|[Pp]\.?[ \t]*[Oo]\.?)",
    "EMAIL": r"\S+@",
    "PHONE": r"[\d+(]",
    "ACCOUNT": r"[\dXx*•]",
    "ROUTING": r"[\dXx*•]",
}
_LABEL_PATTERNS = tuple(
    (kind, re.compile(
        r"(?<!\w)(?:" + pattern + r")(?:" + _SEPARATOR
        + r"|[ \t]+(?=" + _UNPUNCTUATED_VALUE[kind] + r"))",
        re.I,
    ))
    for kind, pattern in _LABELS
)
_BOUNDARY = re.compile(
    r"(?<!\w)(?:employee(?:[ \t]+(?:name|id|address|number))?|emp[ \t]*id|worker(?:[ \t]+(?:name|id))?|"
    r"ssn|social[ \t]+security(?:[ \t]+number)?|(?:bank[ \t]+)?(?:account|acct\.?)(?:[ \t]+(?:number|no\.?))?|"
    r"routing(?:[ \t]+number)?|(?:home[ \t]+)?address|e-?mail|phone|telephone|"
    r"pay[ \t]+period(?:[ \t]+(?:start|end))?|pay[ \t]+date|currency|gross(?:[ \t]+pay)?|"
    r"net(?:[ \t]+pay)?|regular(?:[ \t]+(?:hours|pay|rate))?|overtime(?:[ \t]+(?:hours|pay|rate))?|"
    r"tips|deductions?|earnings|ytd|year.to.date)[ \t]*[:=#]",
    re.I,
)
_PAYROLL_LINE = re.compile(
    r"^[ \t]*(?:pay[ \t]+(?:period|date)|employer|currency|regular|overtime|gross|net|"
    r"earnings|deductions?|hours|rate|tips|tax|federal|state|fica|medicare|social[ \t]+security[ \t]+tax|"
    r"current|year.to.date|ytd|total|bonus|reimbursement)\b",
    re.I,
)
_CITY_STATE_ZIP = re.compile(r"^[ \t]*[A-Za-z.'’ \-]{2,60},?[ \t]+[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?[ \t]*$", re.I)
_STREET = re.compile(
    r"\b(?:\d{1,6}[ \t]+[A-Za-z0-9.'’# \-]{1,70}[ \t]+"
    r"(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|terrace|ter|place|pl)\b"
    r"|p\.?[ \t]*o\.?[ \t]+box[ \t]+\d+)\.?[^\r\n|]*",
    re.I,
)
_UNIT = re.compile(r"^[ \t]*(?:apt\.?|apartment|unit|suite|#)[ \t]*[A-Za-z0-9-]+[ \t]*$", re.I)
_FINANCIAL_PREFIX = re.compile(
    r"(?:\b(?:gross(?:[ \t]+pay)?|net(?:[ \t]+pay)?|regular(?:[ \t]+(?:pay|hours|rate))?|"
    r"overtime(?:[ \t]+(?:pay|hours|rate))?|tips|hours|rate|amount|tax|deductions?|ytd|year.to.date)"
    r"[ \t]*[:=]?[ \t]*(?:[A-Z]{3}[ \t]+)?(?:[$€£¥][ \t]*)?|[$€£¥][ \t]*)$",
    re.I,
)
_PATTERNS = (
    ("EMAIL", re.compile(r"(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+", re.I)),
    ("SSN", re.compile(r"(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)")),
    ("PII", re.compile(r"(?<![\w.$])\d{9,17}(?![\d.])")),
    ("SSN", re.compile(r"(?<!\w)[xX*•]{3}[- ]?[xX*•]{2}[- ]?\d{4}(?!\d)")),
    ("ACCOUNT", re.compile(r"(?<!\w)[xX*•]{2,}[- ]?\d{3,4}(?!\d)")),
    ("ACCOUNT", re.compile(r"\b(?:[A-Z]{2}\d{2}[A-Z0-9]{11,30}|[A-Z]{2}\d{2}(?:[ ][A-Z0-9]{4}){2,7}(?:[ ][A-Z0-9]{1,4})?)\b")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]\d{4}(?!\d)")),
)


def _without_placeholders(text: str) -> str:
    # Maintain offsets while ensuring known placeholders aren't mistaken for PII.
    # Underscores also stop a label from looking onto the next line when its
    # value is already redacted; whitespace would incorrectly look empty.
    return _PLACEHOLDER.sub(lambda match: "_" * len(match.group()), text)


def _trim_value(line: str, start: int) -> tuple[int, int]:
    end = len(line)
    boundary = _BOUNDARY.search(line, start)
    if boundary:
        end = boundary.start()
    column = re.search(r"[\t|]", line[start:end])
    if column:
        end = start + column.start()
    while start < end and line[start].isspace():
        start += 1
    while end > start and line[end - 1].isspace():
        end -= 1
    return start, end


def _social_security_amount(label: str, value: str) -> bool:
    # "Social Security: 100.00" on a deduction list is money, while
    # "Social Security number: 1234" remains sensitive. Ambiguous integers are
    # deliberately still redacted; users must resolve ambiguous source labels.
    return bool(
        re.fullmatch(r"social[ \t]+security[ \t]*[:=]?[ \t]*", label, re.I)
        and re.fullmatch(r"(?:[$€£¥][ \t]*)?-?\d[\d,]*\.\d{1,4}", value.strip())
    )


def _regex_spans(text: str) -> list[_Span]:
    """Supplement NER with identifiers that often evade generic PII detection."""
    spans = []
    for kind, pattern in _PATTERNS:
        for match in pattern.finditer(text):
            if kind == "PII":
                line_start = text.rfind("\n", 0, match.start()) + 1
                if _FINANCIAL_PREFIX.search(text[line_start:match.start()]):
                    continue
            spans.append(_Span(match.start(), match.end(), kind))

    lines = text.splitlines(keepends=True)
    offsets = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)
    for index, full_line in enumerate(lines):
        line = full_line.rstrip("\r\n")
        offset = offsets[index]
        for kind, pattern in _LABEL_PATTERNS:
            for match in pattern.finditer(line):
                start, end = _trim_value(line, match.end())
                if end > start:
                    if kind != "SSN" or not _social_security_amount(match.group(), line[start:end]):
                        spans.append(_Span(offset + start, offset + end, kind))
                # A separate name/address line is a common PDF/OCR layout.
                elif index + 1 < len(lines):
                    following = lines[index + 1].rstrip("\r\n")
                    plausible = kind in {"NAME", "ADDRESS"} or bool(re.search(r"\d|@", following))
                    if plausible and following.strip() and not _PAYROLL_LINE.match(following) and not _BOUNDARY.search(following):
                        begin = len(following) - len(following.lstrip())
                        finish = len(following.rstrip())
                        if kind != "SSN" or not _social_security_amount(match.group(), following[begin:finish]):
                            spans.append(_Span(offsets[index + 1] + begin, offsets[index + 1] + finish, kind))
                if kind == "ADDRESS":
                    for extra in range(index + 1, min(index + 4, len(lines))):
                        following = lines[extra].rstrip("\r\n")
                        if _STREET.search(following) or _CITY_STATE_ZIP.match(following) or _UNIT.match(following):
                            spans.append(_Span(offsets[extra], offsets[extra] + len(following), "ADDRESS"))
                        else:
                            break
        street = _STREET.search(line)
        if street:
            start, end = _trim_value(line, street.start())
            spans.append(_Span(offset + start, offset + end, "ADDRESS"))
        elif _CITY_STATE_ZIP.match(line) or _UNIT.match(line):
            spans.append(_Span(offset, offset + len(line), "ADDRESS"))
    return spans


def _presidio_spans(text: str) -> list[_Span]:
    """Create an explicitly offline analyzer without default network recognizers."""
    try:
        import spacy
        from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
        from presidio_analyzer.nlp_engine import SpacyNlpEngine
        from presidio_analyzer.predefined_recognizers import PhoneRecognizer, SpacyRecognizer

        class InstalledModelEngine(SpacyNlpEngine):
            @staticmethod
            def _download_spacy_model_if_needed(model_name: str) -> None:
                # Presidio normally downloads missing models. Never do so while
                # processing a document, even if an installation disappears.
                if not spacy.util.is_package(model_name):
                    raise RuntimeError("local NLP model unavailable")

        if not spacy.util.is_package(_MODEL):
            raise RuntimeError("local NLP model unavailable")
        engine = InstalledModelEngine(models=[{"lang_code": "en", "model_name": _MODEL}])
        registry = RecognizerRegistry(
            recognizers=[
                SpacyRecognizer(supported_entities=["PERSON", "LOCATION"]),
                PhoneRecognizer(),
            ],
            supported_languages=["en"],
        )
        analyzer = AnalyzerEngine(
            nlp_engine=engine,
            registry=registry,
            supported_languages=["en"],
            log_decision_process=False,
        )
        results = analyzer.analyze(
            text=text,
            language="en",
            entities=["PERSON", "LOCATION", "PHONE_NUMBER"],
            score_threshold=0.35,
            return_decision_process=False,
        )
        kinds = {"PERSON": "NAME", "LOCATION": "ADDRESS", "PHONE_NUMBER": "PHONE"}
        return [
            _Span(item.start, item.end, kinds[item.entity_type]) for item in results
            if text[item.start:item.end] not in _CURRENCY_CODES
        ]
    except Exception:
        raise RedactionError(
            "Local PII detection is unavailable. Install the Python requirements and run "
            "'python -m spacy download en_core_web_lg' during setup, then try again. "
            "No document was sent."
        ) from None


def _find_spans(text: str) -> list[_Span]:
    masked = _without_placeholders(text)
    spans = _regex_spans(masked) + _presidio_spans(masked)
    # Collapse overlapping detections. This only retains offsets and a type;
    # there is deliberately no dictionary of original identifiers.
    result: list[_Span] = []
    priority = {kind: index for index, kind in enumerate(("SSN", "EMPLOYEE_ID", "ACCOUNT", "ROUTING", "EMAIL", "PHONE", "ADDRESS", "NAME"))}
    for span in sorted(spans, key=lambda item: (item.start, -item.end)):
        if span.start >= span.end or not masked[span.start:span.end].strip("_ \t\r\n"):
            continue
        if result and span.start < result[-1].end:
            previous = result.pop()
            kind = min((previous.kind, span.kind), key=lambda name: priority.get(name, 99))
            result.append(_Span(previous.start, max(previous.end, span.end), kind))
        else:
            result.append(span)
    return result


def redact_text(text: str) -> str:
    """Return locally redacted text. Never writes the input, result, or a mapping."""
    with sensitive_operation():
        if not isinstance(text, str) or not text.strip():
            raise RedactionError("No readable local text is available for PII redaction. No document was sent.")
        spans = _find_spans(text)
        counters: dict[str, int] = defaultdict(int)
        # Avoid duplicate placeholder numbers if the input already contains some.
        for match in _PLACEHOLDER.finditer(text):
            kind, count = match.group()[1:-1].rsplit("_", 1)
            counters[kind] = max(counters[kind], int(count))
        parts = []
        previous = 0
        for span in spans:
            counters[span.kind] += 1
            parts.extend((text[previous:span.start], f"[{span.kind}_{counters[span.kind]}]"))
            previous = span.end
        parts.append(text[previous:])
        return "".join(parts)


def assert_no_pii(text: str) -> None:
    """Reject detected residual/new PII without altering any approved text."""
    with sensitive_operation():
        if not isinstance(text, str):
            raise RedactionError("The privacy check requires text. No document was sent.")
        if _find_spans(text):
            raise RedactionError(
                "The local privacy check found a possible personal identifier. "
                "Review the redacted text or model result locally; no further request was sent."
            )
