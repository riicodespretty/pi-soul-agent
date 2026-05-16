import { Cause, Effect, Option, Ref } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { SoulManifest, WritableSoulManifestProps } from "@/src/types";
import { NoSoulsFoundError, SoulNotFoundError, SoulLoadError } from "@/src/errors";
import { expandHome, parseManifest, readJsonFile, readTextFile } from "@/src/services/soul-fs";

/** Soul search paths (with tilde — expanded at runtime) */
const SOUL_SEARCH_PATHS = [
  "~/.pi/agent/souls",
  "~/.openclaw/souls/clawsouls",
  ".pi/souls",
  "./souls",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  readonly manifest: SoulManifest;
  readonly soulPath: string;
  readonly cachedLevel: number;
}

/**
 * Create a SoulLoadError with message and optional cause.
 * Shorthand for `new SoulLoadError({ message, ...(cause ? { cause } : {}) })`.
 */
function soulLoadError(message: string, cause?: unknown): SoulLoadError {
  return new SoulLoadError({
    message,
    cause,
  });
}

/**
 * Filter a manifest to only include content fields up to the requested level.
 * Level 1: metadata only (no content fields)
 * Level 2: soul_content + identity_content
 * Level 3: all content fields
 */
export function filterByLevel(manifest: SoulManifest, level: number): SoulManifest {
  const result = { ...manifest };

  if (level < 3) {
    delete result.agents_content;
    delete result.style_content;
    delete result.heartbeat_content;
    delete result.user_template_content;
    delete result.examples_good_content;
    delete result.examples_bad_content;
  }

  if (level < 2) {
    delete result.soul_content;
    delete result.identity_content;
  }

  return result;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SoulSpecLoader extends Effect.Service<SoulSpecLoader>()("app/SoulSpecLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem;
    const cache = yield* Ref.make<Map<string, CacheEntry>>(new Map());

    // ── Internal helpers ─────────────────────────────────────────────────────────

    const expandHomeDir = expandHome;

    const resolveSoulPath = (soulName: string) => {
      return Effect.gen(function* () {
        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = yield* expandHomeDir(base);
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
     * Level 2: include soul_content + identity_content
     * Level 3: include all content (agents, style, heartbeat, user_template, examples)
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
        yield* readAndSet("avatar_path", manifest.files.avatar, 1);

        // Level 2 content
        yield* readAndSet("soul_content", manifest.files.soul, 2);
        yield* readAndSet("identity_content", manifest.files.identity, 2);

        // Level 3 content
        yield* readAndSet("agents_content", manifest.files.agents, 3);
        yield* readAndSet("style_content", manifest.files.style, 3);
        yield* readAndSet("heartbeat_content", manifest.files.heartbeat, 3);
        yield* readAndSet("user_template_content", manifest.files.user_template, 3);
        yield* readAndSet("examples_good_content", manifest.examples?.good, 3);
        yield* readAndSet("examples_bad_content", manifest.examples?.bad, 3);

        // Cache: upgrade-only (never downgrade)
        yield* Ref.update(cache, (m) => {
          const existing = m.get(soulName);
          if (existing && existing.cachedLevel > level) return m;
          return new Map(m).set(soulName, { manifest, soulPath, cachedLevel: level });
        });

        return manifest;
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
          const resolvedBase = yield* expandHomeDir(base);
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
      }).pipe(Effect.catchAll((e) => Effect.fail(soulLoadError(e.message, e.cause))));
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
      }).pipe(Effect.catchAll((e) => Effect.fail(soulLoadError(e.message, e.cause))));
    };

    /**
     * List all cached souls at the requested level.
     * Infallible — returns [] on empty cache.
     */
    const listSouls = () => {
      return Effect.gen(function* () {
        const currentCache = Ref.get(cache);

        // Cache miss
        if (Array.from((yield* currentCache).values()).length === 0) {
          yield* loadAllSouls();
        }

        return Array.from((yield* currentCache).values()).map((entry) => entry.manifest.name);
      });
    };

    return {
      getSoul,
      loadAllSouls,
      listSouls,
      loadSoul,
    } as const;
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.gen(function* () {
        const message = [
          `[loader] Defect in SoulSpecLoader`,
          Cause.pretty(Cause.die(defect)),
        ] as const;

        yield* Effect.logError(...message);
        return yield* Effect.fail(soulLoadError(...message));
      }),
    ),
  ),
}) {}
