import { Cause, Effect, Ref } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform";
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
  readonly cachedLevel: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
    const pathSvc = yield* Path.Path;
    const cache = yield* Ref.make<Map<string, CacheEntry>>(new Map());

    // ── Internal helpers ─────────────────────────────────────────────────────────

    const expandHomeDir = expandHome;

    const resolveSoulPath = (soulName: string) => {
      return Effect.gen(function* () {
        const expandedDirect = yield* expandHomeDir(soulName);
        const directExists = yield* fs.exists(expandedDirect);
        if (directExists) {
          return expandedDirect;
        }
        const directWithJson = `${expandedDirect}/soul.json`;
        const directJsonExists = yield* fs.exists(directWithJson);
        if (directJsonExists) {
          return expandedDirect;
        }

        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = yield* expandHomeDir(base);
          const exactPath = `${resolvedBase}/${soulName}/soul.json`;
          const exists = yield* fs.exists(exactPath);
          if (exists) {
            return `${resolvedBase}/${soulName}`;
          }
        }

        const allSouls = yield* getAllSoulsInternal();
        const escaped = soulName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "i");
        const matches = allSouls.filter((s: string) => pattern.test(s));

        if (matches.length === 0) {
          return yield* Effect.fail(
            new SoulNotFoundError({ message: `Soul "${soulName}" not found`, soulPath: soulName }),
          );
        }

        return matches[0];
      });
    };

    const getAllSoulsInternal = () => {
      return Effect.gen(function* () {
        const seen = new Set<string>();
        const souls: string[] = [];

        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = yield* expandHomeDir(base);
          const baseExists = yield* fs.exists(resolvedBase);
          if (!baseExists) continue;

          const entries = yield* fs.readDirectory(resolvedBase);

          for (const entry of entries) {
            if (seen.has(entry)) continue;
            const soulJsonPath = `${resolvedBase}/${entry}/soul.json`;
            const hasSoul = yield* fs.exists(soulJsonPath);
            if (hasSoul) {
              seen.add(entry);
              souls.push(entry);
            }
          }
        }

        if (souls.length === 0) {
          return yield* Effect.fail(new NoSoulsFoundError());
        }

        return souls;
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
    const loadSoul = (soulName: string, level: number = 3) => {
      return Effect.gen(function* () {
        const soulPath = yield* resolveSoulPath(soulName);
        const cacheKey = pathSvc.basename(soulPath);
        const manifestPath = `${soulPath}/soul.json`;

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
          const existing = m.get(cacheKey);
          if (existing && existing.cachedLevel > level) return m;
          return new Map(m).set(cacheKey, { manifest, cachedLevel: level });
        });

        return manifest;
      }).pipe(
        Effect.catchTags({
          SoulNotFoundError: (_e) =>
            Effect.fail(new SoulLoadError({ message: `Soul "${soulName}" not found.`, soulName })),
          NoSoulsFoundError: (_e) =>
            Effect.fail(new SoulLoadError({ message: `No souls found in any search path.` })),
          ManifestParseError: (e) =>
            Effect.fail(
              new SoulLoadError({
                message: `Error parsing soul manifest: ${getErrorMessage(e.cause)}`,
                cause: e.cause,
              }),
            ),
          FileSystemError: (e) =>
            Effect.fail(
              new SoulLoadError({
                message: `File system error: ${getErrorMessage(e.cause)}`,
                cause: e.cause,
              }),
            ),
        }),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            if (Cause.isDieType(cause)) {
              yield* Effect.logError(
                `[loader] Defect loading soul "${soulName}"`,
                Cause.pretty(cause),
              );
            } else {
              yield* Effect.logWarning(
                `[loader] Unexpected error loading soul "${soulName}"`,
                Cause.pretty(cause),
              );
            }
            return yield* Effect.fail(
              new SoulLoadError({ message: "Error loading soul: Unexpected error", cause }),
            );
          }),
        ),
      );
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
          const baseExists = yield* fs.exists(resolvedBase);
          if (!baseExists) continue;

          const entries = yield* fs.readDirectory(resolvedBase);

          for (const entry of entries) {
            if (seen.has(entry)) continue;
            seen.add(entry);

            const soulJsonPath = `${resolvedBase}/${entry}/soul.json`;
            const hasSoul = yield* fs
              .exists(soulJsonPath)
              .pipe(Effect.catchAll(() => Effect.succeed(false)));
            if (!hasSoul) continue;

            const result = yield* loadSoul(entry, level).pipe(
              Effect.catchAll((e) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning(`[loader] Failed to load soul "${entry}": ${e.message}`);
                  return null as SoulManifest | null;
                }),
              ),
              Effect.catchAllCause((cause) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning(
                    `[loader] Unexpected failure loading soul "${entry}"`,
                    Cause.pretty(cause),
                  );
                  return null as SoulManifest | null;
                }),
              ),
            );

            if (result) {
              results.push(result);
            }
          }
        }

        if (results.length === 0) {
          return yield* Effect.fail(
            new SoulLoadError({ message: "No souls found in any search path." }),
          );
        }

        return results;
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            if (Cause.isDieType(cause)) {
              yield* Effect.logError("[loader] Defect loading all souls", Cause.pretty(cause));
            } else {
              yield* Effect.logWarning(
                "[loader] Unexpected error loading all souls",
                Cause.pretty(cause),
              );
            }
            return yield* Effect.fail(
              new SoulLoadError({
                message: "Error loading souls: Unexpected error",
                cause,
              }),
            );
          }),
        ),
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
        // Normalize cache key to match how loadSoul stores entries
        const res = yield* resolveSoulPath(soulName).pipe(
          Effect.catchAll(() => Effect.succeed(null as string | null)),
        );
        const cacheKey = res ? pathSvc.basename(res) : soulName;

        // Cache lookup with normalized key
        const currentCache = yield* Ref.get(cache);
        const entry = currentCache.get(cacheKey);
        if (entry && entry.cachedLevel >= level) {
          return filterByLevel(entry.manifest, level);
        }

        // Auto-load on miss or insufficient level
        return yield* loadSoul(soulName, level).pipe(
          Effect.map((manifest) => filterByLevel(manifest, level)),
        );
      });
    };

    /**
     * List all cached souls at the requested level.
     * Infallible — returns [] on empty cache.
     */
    const listSouls = (level: number = 1) => {
      return Effect.gen(function* () {
        const currentCache = yield* Ref.get(cache);
        return Array.from(currentCache.values()).map((entry) =>
          filterByLevel(entry.manifest, level),
        );
      });
    };

    return {
      getSoul,
      loadAllSouls,
      listSouls,
      loadSoul,
    } as const;
  }),
}) {}
