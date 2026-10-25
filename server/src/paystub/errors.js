// Safe, user-facing errors. Never include document text, paths or SDK details.
// Each carries the HTTP status and pipeline stage the upload route reports.

export class FairShiftError extends Error {
  status = 500
  stage = "request"
}

export class DocumentError extends FairShiftError {
  status = 422
  stage = "local_text_extraction"
}

export class RedactionError extends FairShiftError {
  status = 422
  stage = "redaction"
}

// The extraction model (Muse) could not return a result.
export class ModelError extends FairShiftError {
  status = 502
  stage = "model"
}

export class ResponseError extends FairShiftError {
  status = 422
  stage = "validation"
}
