// ── Error Types ──

import { Data } from "effect";

export class SoulNotFoundError extends Data.TaggedError("SoulNotFoundError")<{
  readonly soulPath: string;
}> {}

export class NoSoulsFoundError extends Data.TaggedError("NoSoulsFoundError") {}

export class ManifestParseError extends Data.TaggedError("ManifestParseError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

/** Union of all errors that can occur during soul loading */
export type SoulLoadError = SoulNotFoundError | ManifestParseError | FileSystemError;
