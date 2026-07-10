import { Data } from "effect";

export class SoulNotFoundError extends Data.TaggedError("SoulNotFoundError")<{
  readonly message: string;
}> {}

export class NoSoulsFoundError extends Data.TaggedError("NoSoulsFoundError")<{
  readonly message: string;
}> {}

export class ManifestParseError extends Data.TaggedError("ManifestParseError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class SoulLoadError extends Data.TaggedError("SoulLoadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
