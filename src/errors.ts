export type ExtractionErrorCode =
  | "BOT_CHECK"
  | "RELOAD_REQUIRED"
  | "PRIVATE"
  | "UNAVAILABLE"
  | "GEO_BLOCKED"
  | "TIMEOUT"
  | "SPAWN_FAILED"
  | "UNKNOWN";

/**
 * A failed extraction, tagged with a machine-readable code instead of a
 * message meant for an end user — mapping a code to real UI text (in
 * whatever language) is the calling app's job, not this library's.
 */
export class ExtractionError extends Error {
  code: ExtractionErrorCode;
  stderr?: string;

  constructor(code: ExtractionErrorCode, opts: { cause?: unknown; stderr?: string } = {}) {
    super(`extraction failed: ${code}`);
    this.name = "ExtractionError";
    this.code = code;
    this.stderr = opts.stderr;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class TooManyExtractionsError extends Error {
  limit: number;

  constructor(limit: number) {
    super(`concurrent extraction limit reached (${limit})`);
    this.name = "TooManyExtractionsError";
    this.limit = limit;
  }
}

/** yt-dlp's stderr text → a code. */
export function classifyYtDlpError(stderr: string): ExtractionErrorCode {
  if (/sign in to confirm/i.test(stderr)) return "BOT_CHECK";
  if (/page needs to be reloaded/i.test(stderr)) return "RELOAD_REQUIRED";
  if (/private video/i.test(stderr)) return "PRIVATE";
  if (/video unavailable/i.test(stderr)) return "UNAVAILABLE";
  if (/not available in your country|geo/i.test(stderr)) return "GEO_BLOCKED";
  return "UNKNOWN";
}
