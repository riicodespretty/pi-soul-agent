import { Cause, Effect, Ref } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { SoulManifest } from "@/src/types";
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
  if (level >= 3) return { ...manifest };

  const result = { ...manifest };

  // Level < 3: remove level-3-only content fields
  delete result.agents_content;
  delete result.style_content;
  delete result.heartbeat_content;
  delete result.user_template_content;
  delete result.examples_good_content;
  delete result.examples_bad_content;

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
          return filterByLevel(entry.manifest, level);
        }

        // Soul does not exist
        const manifestPath = `${soulPath}/soul.json`;
        const exists = yield* fs.exists(manifestPath);
        if (!exists) {
          return yield* Effect.fail(
            new SoulNotFoundError({
              message: `Soul "${soulName}" not found`,
            }),
          );
        }

        // Cache miss
        const raw = yield* readJsonFile<Record<string, unknown>>(fs, manifestPath);
        const manifest = parseManifest(raw);

        const files = manifest.files;

        if (level >= 2) {
          if (files.soul) {
            manifest.soul_content = yield* readTextFile(fs, `${soulPath}/${files.soul}`);
          }
          if (files.identity) {
            manifest.identity_content = yield* readTextFile(fs, `${soulPath}/${files.identity}`);
          }
        }

        if (level >= 3) {
          if (files.agents) {
            manifest.agents_content = yield* readTextFile(fs, `${soulPath}/${files.agents}`);
          }
          if (files.style) {
            manifest.style_content = yield* readTextFile(fs, `${soulPath}/${files.style}`);
          }
          if (files.heartbeat) {
            manifest.heartbeat_content = yield* readTextFile(fs, `${soulPath}/${files.heartbeat}`);
          }
          if (files.user_template) {
            manifest.user_template_content = yield* readTextFile(
              fs,
              `${soulPath}/${files.user_template}`,
            );
          }
          if (manifest.examples) {
            if (manifest.examples.good) {
              manifest.examples_good_content = yield* readTextFile(
                fs,
                `${soulPath}/${manifest.examples.good}`,
              );
            }
            if (manifest.examples.bad) {
              manifest.examples_bad_content = yield* readTextFile(
                fs,
                `${soulPath}/${manifest.examples.bad}`,
              );
            }
          }
        }

        if (files.avatar) {
          const avatarFullPath = `${soulPath}/${files.avatar}`;
          const avatarExists = yield* fs.exists(avatarFullPath);
          if (avatarExists) {
            manifest.avatar_path = avatarFullPath;
          }
        }

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

            const soulPath = `${resolvedBase}/${soulName}/soul.json`;
            const exists = yield* fs.exists(soulPath);
            if (!exists) continue;

            const result = yield* loadSoul(soulName, soulPath, level);
            if (result) results.push();
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
        // Cache lookup with normalized key
        const currentCache = yield* Ref.get(cache);
        const entry = currentCache.get(soulName);
        if (entry) {
          if (entry.cachedLevel >= level) {
            return filterByLevel(entry.manifest, level);
          }

          // Insufficient level
          return yield* loadSoul(soulName, entry.soulPath, level);
        }

        // Cache miss
        const soulPath = yield* resolveSoulPath(soulName);
        return yield* loadSoul(soulName, soulPath, level);
      });
    };

    /**
     * List all cached souls at the requested level.
     * Infallible — returns [] on empty cache.
     */
    const listSouls = () => {
      return Effect.gen(function* () {
        const currentCache = Ref.get(cache);

        // Cache miss
        if ((yield* currentCache).values.length === 0) {
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
