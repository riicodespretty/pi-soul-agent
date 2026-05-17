import { Effect, Option, Schema as S } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import os from "node:os";
import { SoulManifestDataSchema, type SoulManifest } from "../types";
import { FileSystemError, ManifestParseError } from "../errors";

// ── Helpers ──

export function resolveOsHomeDir(env: NodeJS.ProcessEnv) {
  return Option.getOrElse(
    Option.firstSomeOf([Option.fromNullable(env.HOME), Option.fromNullable(env.USERPROFILE)]),
    () => os.homedir(),
  );
}

export function expandHome(p: string) {
  if (!p.startsWith("~/")) return Effect.succeed(p);
  return Effect.gen(function* () {
    const path = yield* Path;
    return path.join(resolveOsHomeDir(process.env), p.slice(2));
  });
}

// ── Parsing ──

/**
 * Parse a raw JSON data object (from soul.json on disk) into a typed SoulManifest.
 * All field schemas are defined in `@/src/types.ts` as the source of truth.
 * Throws ManifestParseError on invalid data.
 */
export function parseManifest(raw: Record<string, unknown>): SoulManifest {
  // Normalize recommended skills: accept both `recommendedSkills` (v0.5+) and legacy `skills`
  const skillsInput = Array.isArray(raw.recommendedSkills)
    ? raw.recommendedSkills
    : Array.isArray(raw.skills)
      ? raw.skills
      : [];

  return decodeOrThrow(SoulManifestDataSchema, {
    ...raw,
    recommendedSkills: skillsInput,
  });
}

/** Decode a schema from unknown input, throwing ManifestParseError on failure. */
function decodeOrThrow<A, I>(schema: S.Schema<A, I, never>, input: I): A {
  try {
    return S.decodeUnknownSync(schema)(input);
  } catch (cause: unknown) {
    throw new ManifestParseError({
      message: `Failed to parse manifest: ${(cause as Error).message}`,
      cause,
    });
  }
}

// ── File reading ──

/**
 * Read and parse a JSON file, returning the typed result.
 */
export function readJsonFile<T>(
  fs: FileSystem,
  soulPath: string,
): Effect.Effect<T, FileSystemError | ManifestParseError> {
  return fs.readFileString(soulPath).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: () => JSON.parse(content) as T,
        catch: (cause) =>
          new ManifestParseError({
            message: `Failed to parse ${soulPath}`,
            path: soulPath,
            cause,
          }),
      }),
    ),
    Effect.mapError((cause) => {
      if (cause instanceof ManifestParseError) return cause;
      return new FileSystemError({
        message: `Failed to read ${soulPath}`,
        path: soulPath,
        cause,
      });
    }),
  );
}

/**
 * Read a text file, returning its content as a string.
 */
export function readTextFile(
  fs: FileSystem,
  soulPath: string,
): Effect.Effect<string, FileSystemError> {
  return fs.readFileString(soulPath).pipe(
    Effect.mapError(
      (cause) =>
        new FileSystemError({
          message: `Failed to read ${soulPath}`,
          path: soulPath,
          cause,
        }),
    ),
  );
}
