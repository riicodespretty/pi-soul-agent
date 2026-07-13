import { Effect, Option, Predicate, Schema as S } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import os from "node:os";
import { SoulManifestDataSchema, type SoulManifest } from "../types";
import { FileSystemError, ManifestParseError } from "../errors";

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

export function parseManifest(raw: unknown): SoulManifest {
  if (!Predicate.isRecord(raw)) {
    return decodeOrThrow(SoulManifestDataSchema, raw);
  }

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

function decodeOrThrow<A, I>(schema: S.Schema<A, I, never>, input: unknown): A {
  try {
    return S.decodeUnknownSync(schema)(input);
  } catch (cause: unknown) {
    throw new ManifestParseError({
      message: `Failed to parse manifest: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
}

// ── File reading ──

/**
 * Read and parse a JSON file, returning the parsed value as `unknown`.
 * Callers validate the shape via Schema before use.
 */
export function readJsonFile(
  fs: FileSystem,
  soulPath: string,
): Effect.Effect<unknown, FileSystemError | ManifestParseError> {
  return fs.readFileString(soulPath).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: (): unknown => JSON.parse(content),
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
