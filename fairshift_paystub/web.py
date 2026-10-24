"""Local-only HTTP adapter for the existing React app. No upload persistence.

Run python -m fairshift_paystub.web. Vite proxies /api/paystubs to loopback.
The browser owns redacted preview/result state; the server stores no documents,
OCR text, approval text, results, conversations or placeholder mappings.
Signed, expiring tickets bind a preview to its browser session and upload ID.
This development adapter is not a hosted authentication system.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import shutil
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore

from .documents import MAX_FILE_BYTES
from .errors import ApprovalError, DocumentError, FairShiftError, ModelError, RedactionError, ResponseError
from .muse import translate_texts
from .pipeline import MAX_TEXT, auto_send_paystub, complete_paystub, prepare_paystub_bytes
from .quiet import sensitive_operation
from .response import build_response

COOKIE = "fairshift_paystub_session"
_ID = re.compile(r"^[A-Za-z0-9_-]{24,80}$")
# English language names only (HTTP headers are ASCII), e.g. "Hindi", "Haitian Creole".
_LANGUAGE = re.compile(r"^[A-Za-z][A-Za-z ()-]{1,39}$")
_LOGGER = logging.getLogger(__name__)


class PaystubApplication:
    def __init__(self, *, prepare=prepare_paystub_bytes, complete=complete_paystub,
                 auto_send=auto_send_paystub, translate=translate_texts, source="muse_live", clock=time.time):
        self.prepare = prepare
        self.complete = complete
        self.auto_send = auto_send
        self.translate = translate
        self.source = source  # Tests explicitly use "mocked"; never selected via HTTP/env.
        self.clock = clock
        self.secret = secrets.token_bytes(32)
        # Upload IDs (random, no document content) whose extraction succeeded,
        # with their ticket expiry, so a ticket can't trigger repeat model calls.
        self.completed: dict[str, float] = {}

    def _ticket(self, upload_id: str, session: str) -> str:
        # The ticket binds an upload to its browser session. It does not bind the
        # text: the worker is meant to edit the preview before approving it.
        payload = json.dumps({"id": upload_id, "session": session,
                              "expires": self.clock() + 900}, separators=(",", ":")).encode()
        encoded = base64.urlsafe_b64encode(payload).rstrip(b"=")
        signature = hmac.new(self.secret, encoded, hashlib.sha256).hexdigest().encode()
        return (encoded + b"." + signature).decode()

    def _verify(self, ticket: str, upload_id: str, session: str) -> None:
        try:
            if not isinstance(ticket, str) or len(ticket) > 1200:
                raise ValueError()
            encoded, signature = ticket.encode("ascii").split(b".", 1)
            expected = hmac.new(self.secret, encoded, hashlib.sha256).hexdigest().encode()
            if not hmac.compare_digest(signature, expected):
                raise ValueError()
            value = json.loads(base64.urlsafe_b64decode(encoded + b"=" * (-len(encoded) % 4)))
            if (value["id"] != upload_id or value["session"] != session
                    or value["expires"] < self.clock() or upload_id in self.completed):
                raise ValueError()
        except Exception:
            raise ApprovalError("This preview is expired or belongs to another upload/browser. Upload the document again and review it.") from None

    def prepare_document(self, document: bytes, suffix: str, session: str) -> dict:
        redacted = self.prepare(document, suffix)
        upload_id = secrets.token_urlsafe(24)
        return {"upload_id": upload_id, "approval_token": self._ticket(upload_id, session),
                "redacted_text": redacted, "requires_approval": True,
                "trace": [{"stage": "local_text_extraction", "status": "passed", "mode": "local"},
                          {"stage": "redaction", "status": "passed", "mode": "local"},
                          {"stage": "user_approval", "status": "pending"}]}

    def extract_document(self, data: dict, session: str) -> dict:
        if not isinstance(data, dict) or data.get("approved") is not True:
            raise ApprovalError("Review and explicitly approve the exact redacted text before sending it to Muse.")
        upload_id, text = data.get("upload_id"), data.get("approved_text")
        if not isinstance(upload_id, str) or not _ID.fullmatch(upload_id):
            raise ApprovalError("A valid current upload is required. Upload and review the document again.")
        self._verify(data.get("approval_token"), upload_id, session)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ApprovalError("Approved text is empty or too long. Correct the preview before sending.")
        stub = self.complete(text, approved=True)
        # Single use once it succeeds; a failed attempt (say, a Muse timeout) can be retried.
        now = self.clock()
        self.completed = {key: expires for key, expires in self.completed.items() if expires >= now}
        self.completed[upload_id] = now + 900
        # The message uses the SAME validated object returned in this response.
        # No chatbot model, sample values, cached documents, or wage-law engine.
        message = build_response(stub)
        return {"upload_id": upload_id, "paystub": stub.model_dump(mode="json"),
                "assistant_message": message, "source": self.source,
                "trace": [{"stage": "user_approval", "status": "passed"},
                          {"stage": "outbound_privacy_check", "status": "passed", "mode": "local"},
                          {"stage": "muse", "status": "passed", "mode": self.source},
                          {"stage": "pydantic_validation", "status": "passed", "mode": "local"},
                          {"stage": "deterministic_checks", "status": "passed", "mode": "local"},
                          {"stage": "chatbot_response", "status": "passed", "mode": "validated_data"}]}


    def process_document(self, document: bytes, suffix: str, language: str = "English") -> dict:
        """Upload → local OCR and redaction → automatic send to Muse, in one call.

        There is no manual approval step: the redacted text is sent as soon as it
        is ready (see pipeline.auto_send_paystub for the re-redaction retries).
        The exact text that was sent is returned so the worker can see it.
        """
        redacted = self.prepare(document, suffix)
        stub, sent, retries, forced = self.auto_send(redacted)
        upload_id = secrets.token_urlsafe(24)
        message = build_response(stub)
        # Checks above ran on English text; the worker reads it in their own language.
        notes = list(stub.warnings)
        if language and language != "English" and _LANGUAGE.fullmatch(language):
            try:
                message, *notes = self.translate([message, *notes], language)
            except FairShiftError:
                _LOGGER.warning("Display translation failed; showing English.")
        send_stage = {"stage": "automatic_send", "status": "passed",
                      "mode": "forced" if forced else ("re-redacted" if retries else "clean")}
        return {"upload_id": upload_id, "paystub": stub.model_dump(mode="json"),
                "assistant_message": message, "warnings_display": notes, "source": self.source,
                "sent_text": sent, "redaction_retries": retries, "forced": forced,
                "trace": [{"stage": "local_text_extraction", "status": "passed", "mode": "local"},
                          {"stage": "redaction", "status": "passed", "mode": "local"},
                          send_stage,
                          {"stage": "muse", "status": "passed", "mode": self.source},
                          {"stage": "pydantic_validation", "status": "passed", "mode": "local"},
                          {"stage": "deterministic_checks", "status": "passed", "mode": "local"},
                          {"stage": "chatbot_response", "status": "passed", "mode": "validated_data"}]}


def create_server(address=("127.0.0.1", 8790), *, application=None, allowed_origins=None):
    application = application or PaystubApplication()
    allowed_origins = allowed_origins or {"http://localhost:8443", "http://127.0.0.1:8443"}
    active = BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # No request paths, filenames, body text, prompts or SDK errors.

        def _send(self, status, data, session=None):
            encoded = json.dumps(data, ensure_ascii=True).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if session is not None:
                self.send_header("Set-Cookie", f"{COOKIE}={session}; HttpOnly; SameSite=Strict; Path=/api/paystubs")
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if self.path != "/api/paystubs/health":
                self._send(404, {"error": "Unknown paystub endpoint."})
                return
            self._send(200, {"ok": True, "source": application.source,
                             "ocr_available": bool(shutil.which(os.environ.get("TESSERACT_CMD", "tesseract"))),
                             "api_configured": bool(os.environ.get("MUSE_API_KEY")),
                             "retention": "memory_only"})

        def do_POST(self):
            origin = self.headers.get("Origin")
            if ((origin and origin not in allowed_origins)
                    or self.headers.get("X-FairShift-Client") != "paystub-ui"):
                self._send(403, {"error": "Use the local FairShift upload screen.", "stage": "request"})
                return
            if self.path not in {"/api/paystubs/prepare", "/api/paystubs/extract", "/api/paystubs/process"}:
                self._send(404, {"error": "Unknown paystub endpoint.", "stage": "request"})
                return
            if not active.acquire(blocking=False):
                self._send(503, {"error": "Paystub processing is busy. Please retry shortly.", "stage": "request"})
                return
            uploads_file = self.path.endswith(("prepare", "process"))
            stage = "local_text_extraction" if uploads_file else "approval"
            try:
                with sensitive_operation():
                    length = int(self.headers.get("Content-Length", "0"))
                    maximum = MAX_FILE_BYTES if uploads_file else 1_200_000
                    if not 0 < length <= maximum or self.headers.get("Transfer-Encoding"):
                        self._send(413, {"error": "The upload is empty or too large.", "stage": "request"})
                        return
                    self.connection.settimeout(30)
                    body = self.rfile.read(length)
                    if len(body) != length:
                        raise DocumentError("The upload was interrupted. Choose the file again.")
                    cookie = SimpleCookie()
                    try:
                        cookie.load(self.headers.get("Cookie", ""))
                        session = cookie[COOKIE].value if COOKIE in cookie else ""
                    except Exception:
                        session = ""
                    if not _ID.fullmatch(session):
                        session = secrets.token_urlsafe(24)
                    if self.path.endswith("process"):
                        language = self.headers.get("X-FairShift-Language", "English")
                        result = application.process_document(body, self.headers.get("X-Document-Type", ""),
                                                              language if _LANGUAGE.fullmatch(language) else "English")
                        self._send(200, result, session)
                    elif self.path.endswith("prepare"):
                        result = application.prepare_document(body, self.headers.get("X-Document-Type", ""), session)
                        self._send(200, result, session)
                    else:
                        data = json.loads(body)
                        result = application.extract_document(data, session)
                        self._send(200, result)
            except ApprovalError as error:
                self._send(400, {"error": str(error), "stage": "approval"})
            except DocumentError as error:
                self._send(422, {"error": str(error), "stage": "local_text_extraction"})
            except RedactionError as error:
                self._send(422, {"error": str(error), "stage": "redaction"})
            except ModelError as error:
                self._send(502, {"error": str(error), "stage": "model"})
            except ResponseError as error:
                self._send(422, {"error": str(error), "stage": "validation"})
            except (ValueError, UnicodeError):
                self._send(400, {"error": "Invalid upload request. Choose and review the document again.", "stage": stage})
            except Exception:
                try:
                    self._send(500, {"error": "Paystub processing failed safely. Retry after checking local setup.", "stage": stage})
                except Exception:
                    pass
            finally:
                active.release()

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            pass  # Base implementation prints unsanitized tracebacks.

    return Server(address, Handler)


def main():
    from dotenv import load_dotenv
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
    port = int(os.environ.get("FAIRSHIFT_PAYSTUB_PORT", "8790"))
    origins = {value.strip() for value in os.environ.get(
        "FAIRSHIFT_WEB_ORIGIN", "http://localhost:8443,http://127.0.0.1:8443"
    ).split(",") if value.strip()}
    server = create_server(("127.0.0.1", port), allowed_origins=origins)
    print(f"FairShift local paystub service ready on port {port}. Raw uploads are not saved; Muse request diagnostics (no document text) are logged.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
