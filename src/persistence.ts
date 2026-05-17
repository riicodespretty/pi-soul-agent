import { Cause, Effect, Option, Schema as S } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { ActiveSoulSchema, type ActiveSoul, type HeartbeatMode } from "./types";
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
      const save = (soulName: string, level: number, heartbeatMode?: HeartbeatMode) =>
        Effect.gen(function* () {
          const path = yield* Path;
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);

          // mkdir may fail if the directory already exists — not fatal
          yield* fs
            .makeDirectory(path.dirname(filePath), { recursive: true })
            .pipe(Effect.catchAll(() => Effect.void));

          const data: ActiveSoul = {
            soul: soulName,
            level,
            updatedAt: Date.now(),
            heartbeatMode: heartbeatMode ?? "lite",
          };
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

      /**
       * Update the heartbeat mode without changing the soul name or level.
       */
      const updateHeartbeatMode = (mode: HeartbeatMode) =>
        Effect.gen(function* () {
          const current = yield* load();
          if (Option.isNone(current)) {
            return yield* Effect.fail(persistenceError("No active soul to update heartbeat mode"));
          }

          const existing = current.value;
          const data: ActiveSoul = { ...existing, heartbeatMode: mode, updatedAt: Date.now() };
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);
          yield* fs.writeFileString(filePath, JSON.stringify(data, null, 2));
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(persistenceError("Failed to update heartbeat mode", cause)),
          ),
        );

      return { save, load, clear, updateHeartbeatMode } as const;
    }).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.gen(function* () {
          const defectDesc = Cause.pretty(Cause.die(defect));
          yield* logError("persistence", "Defect in ActiveSoulPersistence", defectDesc);
          return yield* Effect.fail(
            persistenceError(
              `[persistence] Defect in ActiveSoulPersistence: ${defectDesc}`,
              defectDesc,
            ),
          );
        }),
      ),
    ),
    dependencies: [],
  },
) {}
