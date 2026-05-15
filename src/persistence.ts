import { Effect, Option } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { ActiveSoul } from "@/src/types";
import { FileSystemError } from "@/src/errors";
import { expandHome } from "@/src/services/soul-fs";

/** Persistence file path */
const ACTIVE_SOUL_PATH = "~/.pi/agent/.active-soul.json";

export class ActiveSoulPersistence extends Effect.Service<ActiveSoulPersistence>()(
  "app/ActiveSoulPersistence",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem;

      /**
       * Save the active soul to disk.
       * Creates the parent directory if it doesn't exist.
       */
      const save = (soulName: string, level: number): Effect.Effect<void, FileSystemError> => {
        return Effect.gen(function* () {
          const filePath = expandHome(ACTIVE_SOUL_PATH);
          const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));

          yield* fs.makeDirectory(dirPath, { recursive: true }).pipe(
            Effect.catchAll(() => Effect.void), // mkdir failure not fatal
          );

          const data: ActiveSoul = {
            soul: soulName,
            level,
            updatedAt: Date.now(),
          };

          yield* fs.writeFileString(filePath, JSON.stringify(data, null, 2));
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(new FileSystemError({ path: ACTIVE_SOUL_PATH, cause })),
          ),
        );
      };

      /**
       * Load the active soul from disk.
       * Returns Option.none() if file doesn't exist or is corrupt.
       */
      const load = (): Effect.Effect<Option.Option<ActiveSoul>, never> => {
        return Effect.gen(function* () {
          const filePath = expandHome(ACTIVE_SOUL_PATH);
          const exists = yield* fs.exists(filePath);
          if (!exists) return Option.none();

          const content = yield* fs.readFileString(filePath);
          const parseResult: unknown = yield* Effect.try({
            try: () => JSON.parse(content),
            catch: () => undefined,
          });
          if (
            parseResult &&
            typeof (parseResult as Record<string, unknown>).soul === "string" &&
            typeof (parseResult as Record<string, unknown>).level === "number"
          ) {
            return Option.some(parseResult as ActiveSoul);
          }
          return Option.none();
        }).pipe(Effect.catchAll(() => Effect.succeed(Option.none<ActiveSoul>())));
      };

      /**
       * Clear (delete) the active soul file.
       */
      const clear = (): Effect.Effect<void, FileSystemError> => {
        return Effect.gen(function* () {
          const filePath = expandHome(ACTIVE_SOUL_PATH);
          yield* fs.remove(filePath).pipe(
            Effect.catchAll(() => Effect.void), // removal failure not fatal
          );
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(new FileSystemError({ path: ACTIVE_SOUL_PATH, cause })),
          ),
        );
      };

      return { save, load, clear } as const;
    }),
    dependencies: [],
  },
) {}
