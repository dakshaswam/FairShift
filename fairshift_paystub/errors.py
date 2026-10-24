"""Safe, user-facing errors. Never include document text, paths or SDK details."""


class FairShiftError(Exception):
    """Base class for errors safe to display to a user."""


class DocumentError(FairShiftError):
    pass


class RedactionError(FairShiftError):
    pass


class ApprovalError(FairShiftError):
    pass


class ModelError(FairShiftError):
    """The extraction model (Muse) could not return a result."""


class ResponseError(FairShiftError):
    pass
