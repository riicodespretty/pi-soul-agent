import { Cause, Effect, Option, Schema as S } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { ActiveSoulSchema, type ActiveSoul } from "./types";
import { FileSystemError } from "./errors";
import { expandHome, readJsonFile } from "./services/soul-fs";
import { logError } from "./logger";
import { Path } from "@effect/platform/Path";

/** Persistence file path (tilde expanded at runtime) */
const ACTIVE_SOUL_PATH = "~/.pi/agent/.active-soul.json";

/**
 * Create a FileSystemError with message and optional cause.
 * Shorthand for `new FileSystemError({ message, ...(cause ? { cause } : {}) })`.
 */
function persistenceError(message: string, cause?: unknown): FileSystemError {
  return new FileSystemError({ message, cause });
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ActiveSoulPersistence extends Effect.Service<ActiveSoulPersistence>()(
  "app/ActiveSoulPersistence",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem;

      /**
       * Save the active soul to disk.
       * Creates the parent directory if it doesn't exist (mkdir failure is not fatal).
       */
      const save = (soulName: string, level: number) =>
        Effect.gen(function* () {
          const path = yield* Path;
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);

          // mkdir may fail if the directory already exists — not fatal
          yield* fs
            .makeDirectory(path.dirname(filePath), { recursive: true })
            .pipe(Effect.catchAll(() => Effect.void));

          const data: ActiveSoul = { soul: soulName, level, updatedAt: Date.now() };
          yield* fs.writeFileString(filePath, JSON.stringify(data, null, 2));
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(persistenceError("Failed to save active soul", cause)),
          ),
        );

      /**
       * Load the active soul from disk.
       * Returns Option.none() if file doesn't exist, is corrupt, or is not valid ActiveSoul data.
       */
      const load = () =>
        Effect.gen(function* () {
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);

          const exists = yield* fs.exists(filePath);
          if (!exists) return Option.none();

          const parsed = yield* readJsonFile<Record<string, unknown>>(fs, filePath);
          return S.decodeUnknownOption(ActiveSoulSchema)(parsed);
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(persistenceError("Failed to load active soul", cause)),
          ),
        );

      /**
       * Clear (delete) the active soul file.
       * Removal failure is not fatal — the file may not exist.
       */
      const clear = () =>
        Effect.gen(function* () {
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);

          yield* fs.remove(filePath);
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(persistenceError("Failed to clear active soul", cause)),
          ),
        );

      return { save, load, clear } as const;
    }).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.gen(function* () {
          const defectDesc = Cause.pretty(Cause.die(defect));
          yield* logError("persistence", "Defect in ActiveSoulPersistence", defectDesc);
          return yield* Effect.fail(
            persistenceError(`[persistence] Defect in ActiveSoulPersistence`, defectDesc),
          );
        }),
      ),
    ),
    dependencies: [],
  },
) {}
