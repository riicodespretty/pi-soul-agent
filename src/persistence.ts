import { Effect, Option, Schema as S } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform";
import { ActiveSoulSchema, type ActiveSoul } from "@/src/types";
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
      const save = (
        soulName: string,
        level: number,
      ): Effect.Effect<void, FileSystemError, Path.Path> => {
        return Effect.gen(function* () {
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);
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
            Effect.fail(
              new FileSystemError({
                message: `Failed to save active soul`,
                path: ACTIVE_SOUL_PATH,
                cause,
              }),
            ),
          ),
        );
      };

      /**
       * Load the active soul from disk.
       * Returns Option.none() if file doesn't exist or is corrupt.
       */
      const load = (): Effect.Effect<Option.Option<ActiveSoul>, never, Path.Path> => {
        return Effect.gen(function* () {
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);
          const exists = yield* fs.exists(filePath);
          if (!exists) return Option.none();

          const content = yield* fs.readFileString(filePath);
          const parsed: unknown = yield* Effect.try({
            try: () => JSON.parse(content),
            catch: () => undefined,
          });
          if (parsed === undefined) return Option.none();

          const result = S.decodeUnknownEither(ActiveSoulSchema)(parsed);
          if (result._tag === "Left") return Option.none();
          return Option.some(result.right);
        }).pipe(Effect.catchAll(() => Effect.succeed(Option.none<ActiveSoul>())));
      };

      /**
       * Clear (delete) the active soul file.
       */
      const clear = (): Effect.Effect<void, FileSystemError, Path.Path> => {
        return Effect.gen(function* () {
          const filePath = yield* expandHome(ACTIVE_SOUL_PATH);
          yield* fs.remove(filePath).pipe(
            Effect.catchAll(() => Effect.void), // removal failure not fatal
          );
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(
              new FileSystemError({
                message: `Failed to clear active soul`,
                path: ACTIVE_SOUL_PATH,
                cause,
              }),
            ),
          ),
        );
      };

      return { save, load, clear } as const;
    }),
    dependencies: [],
  },
) {}
