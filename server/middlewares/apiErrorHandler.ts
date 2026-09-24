import type { ErrorRequestHandler } from "express";

type PublicError = {
  status: number;
  message: string;
};

type ErrorLogger = (error: unknown) => void;

const INTERNAL_ERROR: PublicError = {
  status: 500,
  message: "Internal Server Error",
};

const MULTER_BAD_REQUEST_CODES = new Set([
  "LIMIT_PART_COUNT",
  "LIMIT_FILE_COUNT",
  "LIMIT_FIELD_KEY",
  "LIMIT_FIELD_VALUE",
  "LIMIT_FIELD_COUNT",
  "LIMIT_UNEXPECTED_FILE",
  "MISSING_FIELD_NAME",
]);

function asErrorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : null;
}

function classifyPublicError(error: unknown): PublicError {
  const record = asErrorRecord(error);
  if (!record) return INTERNAL_ERROR;

  if (record.type === "entity.parse.failed") {
    return { status: 400, message: "Invalid JSON request body." };
  }
  if (record.type === "entity.too.large") {
    return { status: 413, message: "Request body is too large." };
  }
  if (record.type === "charset.unsupported" || record.type === "encoding.unsupported") {
    return { status: 415, message: "Unsupported request encoding." };
  }
  if (record.type === "request.aborted" || record.type === "request.size.invalid") {
    return { status: 400, message: "Invalid request body." };
  }
  if (record.type === "entity.verify.failed") {
    return { status: 403, message: "Request body verification failed." };
  }

  if (record.name === "MulterError" && typeof record.code === "string") {
    if (record.code === "LIMIT_FILE_SIZE") {
      return { status: 413, message: "Uploaded file is too large." };
    }
    if (MULTER_BAD_REQUEST_CODES.has(record.code)) {
      return { status: 400, message: "Invalid upload request." };
    }
  }

  return INTERNAL_ERROR;
}

export function createApiErrorHandler(
  logError: ErrorLogger = (error) => console.error("Unhandled request error:", error),
): ErrorRequestHandler {
  return (error, _req, res, next) => {
    logError(error);

    if (res.headersSent) {
      return next(error);
    }

    const publicError = classifyPublicError(error);
    return res.status(publicError.status).json({ message: publicError.message });
  };
}