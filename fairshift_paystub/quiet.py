"""Keep dependency debug records free of content during sensitive operations.

The flag is context-local, so simultaneous requests do not suppress one another.
Applications must also avoid HTTP tracing, exception-local capture and recording
terminal sessions. This cannot control an embedding application's instrumentation.
"""

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Lock

_private = ContextVar("fairshift_private_operation", default=False)
_lock = Lock()
_installed = False


def _install() -> None:
    global _installed
    with _lock:
        if _installed:
            return
        previous_factory = logging.getLogRecordFactory()

        def factory(*args, **kwargs):
            if _private.get():
                # Do not pass sensitive args/exception data to another factory.
                return logging.LogRecord("fairshift", logging.DEBUG, "", 0,
                                         "Sensitive-operation log suppressed.", (), None)
            return previous_factory(*args, **kwargs)

        logging.setLogRecordFactory(factory)
        _installed = True


@contextmanager
def sensitive_operation():
    _install()
    token = _private.set(True)
    try:
        yield
    finally:
        _private.reset(token)


@contextmanager
def safe_diagnostic_logging():
    """Temporarily emit only a caller-sanitized diagnostic inside private work."""
    token = _private.set(False)
    try:
        yield
    finally:
        _private.reset(token)
