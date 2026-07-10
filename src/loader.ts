import { Cause, Effect, Option, Ref } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { SoulManifest, WritableSoulManifestProps } from "./types";
import { NoSoulsFoundError, SoulNotFoundError, SoulLoadError } from "./errors";
import { expandHome, parseManifest, readJsonFile, readTextFile } from "./services/soul-fs";
import { logError } from "./logger";

export const SOUL_SEARCH_PATHS = [
  "~/.pi/agent/souls",
  "~/.openclaw/souls/clawsouls",
  ".pi/souls",
  "./souls",
] as const;

interface CacheEntry {
  readonly manifest: SoulManifest;
  readonly soulPath: string;
  readonly cachedLevel: number;
}

function soulLoadError(message: string, cause?: unknown): SoulLoadError {
  return new SoulLoadError({
    message,
    cause,
  });
}

export function filterByLevel(manifest: SoulManifest, level: number): SoulManifest {
  const result = { ...manifest };

  if (level < 3) {
    delete result.agentsContent;
    delete result.styleContent;
    delete result.heartbeatContent;
    delete result.userTemplateContent;
    delete result.examplesGoodContent;
    delete result.examplesBadContent;
  }

  if (level < 2) {
    delete result.soulContent;
    delete result.identityContent;
  }

  return result;
}

export class SoulSpecLoader extends Effect.Service<SoulSpecLoader>()("app/SoulSpecLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem;
    const cache = yield* Ref.make<Map<string, CacheEntry>>(new Map());

    const resolveSoulPath = (soulName: string) => {
      return Effect.gen(function* () {
        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = yield* expandHome(base);
          const exactPath = `${resolvedBase}/${soulName}/soul.json`;
          const exists = yield* fs.exists(exactPath);
          if (exists) {
            return `${resolvedBase}/${soulName}`;
          }
        }

        return yield* Effect.fail(
          new SoulNotFoundError({
            message: `Soul "${soulName}" not found`,
          }),
        );
      });
    };

    // ── Public API ────────────────────────────────────────────────────────────────

    /**
     * Load a soul manifest from disk at the requested level.
     * Always reads from disk — no cache lookup.
     * Cache is updated with upgrade-only policy (never downgrades).
     *
     * Level 1: metadata only (soul.json)
     * Level 2: include soulContent + identityContent
     * Level 3: include all content (agents, style, heartbeat, userTemplate, examples)
     */
    const loadSoul = (soulName: string, soulPath: string, level: number = 2) => {
      return Effect.gen(function* () {
        // Cache hit
        const currentCache = yield* Ref.get(cache);
        const entry = currentCache.get(soulName);
        if (entry) {
          if (entry.cachedLevel >= level) {
            return filterByLevel(entry.manifest, level);
          }
        }

        // Cache miss
        const manifestPath = `${soulPath}/soul.json`;
        const raw = yield* readJsonFile<Record<string, unknown>>(fs, manifestPath);
        const manifest = parseManifest(raw);

        // Helper: read an optional content file and set the manifest field
        const readAndSet = (
          key: keyof WritableSoulManifestProps,
          filename: string | undefined,
          minLevel: number,
        ) =>
          Option.fromNullable(filename).pipe(
            Option.filter((f) => Boolean(f) && level >= minLevel),
            Effect.transposeMapOption((f) => readTextFile(fs, `${soulPath}/${f}`)),
            Effect.flatMap((opt) =>
              Option.isSome(opt)
                ? Effect.sync(() => {
                    manifest[key] = opt.value;
                  })
                : Effect.void,
            ),
          );

        // Level 1 content
        yield* readAndSet("avatarPath", manifest.files.avatar, 1);

        // Level 2 content
        yield* readAndSet("soulContent", manifest.files.soul, 2);
        yield* readAndSet("identityContent", manifest.files.identity, 2);

        // Level 3 content
        yield* readAndSet("agentsContent", manifest.files.agents, 3);
        yield* readAndSet("styleContent", manifest.files.style, 3);
        yield* readAndSet("heartbeatContent", manifest.files.heartbeat, 3);
        yield* readAndSet("userTemplateContent", manifest.files.userTemplate, 3);
        yield* readAndSet("examplesGoodContent", manifest.examples?.good, 3);
        yield* readAndSet("examplesBadContent", manifest.examples?.bad, 3);

        // Cache: upgrade-only (never downgrade)
        yield* Ref.update(cache, (m) => {
          const existing = m.get(soulName);
          if (existing && existing.cachedLevel > level) return m;
          return new Map(m).set(soulName, { manifest, soulPath, cachedLevel: level });
        });

        return filterByLevel(manifest, level);
      }).pipe(Effect.catchAll((e) => Effect.fail(soulLoadError(e.message, e.cause))));
    };

    /**
     * Load all souls from all search paths at the requested level.
     * Best-effort per soul — individual failures are logged and skipped.
     * Fails with SoulLoadError if zero souls are found.
     */
    const loadAllSouls = (level: number = 1) => {
      return Effect.gen(function* () {
        const seen = new Set<string>();
        const results: SoulManifest[] = [];

        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = yield* expandHome(base);
          const soulNames = yield* fs.readDirectory(resolvedBase);

          for (const soulName of soulNames) {
            if (seen.has(soulName)) continue;
            seen.add(soulName);

            const soulPath = `${resolvedBase}/${soulName}`;
            const exists = yield* fs.exists(`${soulPath}/soul.json`);
            if (!exists) continue;

            const result = yield* loadSoul(soulName, soulPath, level);
            results.push(result);
          }
        }

        if (results.length === 0) {
          return yield* new NoSoulsFoundError({ message: "No souls found in any search paths." });
        }

        return results;
      }).pipe(
        Effect.catchAll((e) => {
          // Passthrough already-wrapped SoulLoadError (from loadSoul)
          if (e instanceof SoulLoadError) return Effect.fail(e);
          return Effect.fail(soulLoadError(e.message, e.cause));
        }),
      );
    };

    /**
     * Get a soul manifest, cache-first.
     * Normalizes cache key via resolveSoulPath + path.basename.
     * If found with cachedLevel >= level, returns filtered result.
     * Otherwise auto-loads via loadSoul (which remaps errors to SoulLoadError).
     */
    const getSoul = (soulName: string, level: number = 2) => {
      return Effect.gen(function* () {
        const soulPath = yield* resolveSoulPath(soulName);
        return yield* loadSoul(soulName, soulPath, level);
      }).pipe(
        Effect.catchAll((e) => {
          // Passthrough already-wrapped SoulLoadError (from loadSoul)
          if (e instanceof SoulLoadError) return Effect.fail(e);
          return Effect.fail(soulLoadError(e.message, e.cause));
        }),
      );
    };

    /**
     * List all discovered souls at the requested level.
     * Returns cached manifests when already populated at sufficient level.
     * Otherwise loads via loadAllSouls (which respects cache internally).
     * Fails with SoulLoadError when no souls are found.
     */
    const listSouls = (level: number = 1) => {
      return Effect.gen(function* () {
        const currentCache = yield* Ref.get(cache);

        // Cache already populated at requested level — skip I/O
        const hasAllAtLevel =
          currentCache.size > 0 &&
          Array.from(currentCache.values()).every((e) => e.cachedLevel >= level);

        if (!hasAllAtLevel) {
          yield* loadAllSouls(level);
        }

        const updatedCache = yield* Ref.get(cache);
        return Array.from(updatedCache.values()).map((entry) =>
          filterByLevel(entry.manifest, level),
        );
      });
    };

    return {
      getSoul,
      loadAllSouls,
      listSouls,
      loadSoul,
      resolveSoulPath,
    } as const;
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.gen(function* () {
        const defectDesc = Cause.pretty(Cause.die(defect));
        yield* logError("loader", "Defect in SoulSpecLoader", defectDesc);
        return yield* Effect.fail(
          soulLoadError(`[loader] Defect in SoulSpecLoader: ${defectDesc}`, defectDesc),
        );
      }),
    ),
  ),
}) {}
