import { Data } from "effect";

// ── Internal Error Classes ────────────────────────────────────────────────────
// Used by soul-fs.ts and internal loader methods. Not consumed directly by
// external callers — the public loader API re-maps these into SoulLoadError.

/** Soul not found in any search path */
export class SoulNotFoundError extends Data.TaggedError("SoulNotFoundError")<{
  readonly message: string;
}> {}

/** No soul manifests found in any search path */
export class NoSoulsFoundError extends Data.TaggedError("NoSoulsFoundError")<{
  readonly message: string;
}> {}

/** Failed to parse a soul.json manifest */
export class ManifestParseError extends Data.TaggedError("ManifestParseError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

/** Generic filesystem operation failure */
export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

// ── Consumer-Facing Error ─────────────────────────────────────────────────────
// This is the only error type that escapes the public loader API.
// All internal errors are caught, logged, and re-mapped into this type.
// Consumers handle a single error type with Effect.catchTag("SoulLoadError", ...).

export class SoulLoadError extends Data.TaggedError("SoulLoadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
