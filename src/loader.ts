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

/** An individual soul entry from enumerateSouls — best-effort loading */
export type EnumeratedSoul =
  | { readonly _tag: "loaded"; readonly name: string; readonly manifest: SoulManifest }
  | { readonly _tag: "skipped"; readonly name: string; readonly reason: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatSoulOffers(soulName: string, offers: { matches: string[]; all: string[] }): string {
  if (offers.matches.length > 0) {
    const matchList = offers.matches.slice(0, 5).join(", ");
    const hint = offers.matches.length > 5 ? ` (showing first 5 of ${offers.matches.length})` : "";
    return `No exact match found for "${soulName}". Did you mean one of these?\n\n${matchList}${hint}\n\nTry one of these exact names, or use a more specific pattern.`;
  }
  if (offers.all.length > 0) {
    const soulList = offers.all.slice(0, 10).join(", ");
    return `No soul found matching "${soulName}".\n\nAvailable souls:\n\n${soulList}\n\nUse /souls to see all available souls, or try a partial match like "dev" or "assist".`;
  }
  return `No soul found matching "${soulName}".`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SoulSpecLoader extends Effect.Service<SoulSpecLoader>()("app/SoulSpecLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem;
    const cache = yield* Ref.make<Map<string, SoulManifest>>(new Map());

    // ── Internal (error-throwing) methods ────────────────────────────────────────
    // These use internal error classes and are wrapped by the public methods below.

    const getSoulOffers = (soulName: string) => {
      return Effect.gen(function* () {
        const matches = yield* findMatchingSoulsInternal(new RegExp(soulName, "i")).pipe(
          Effect.catchAllCause(() => Effect.succeed([] as string[])),
        );
        const souls = yield* getAllSoulsInternal().pipe(
          Effect.catchAllCause(() => Effect.succeed([] as string[])),
        );
        return { matches, all: souls };
      });
    };

    const resolveSoulPath = (soulName: string) => {
      return Effect.gen(function* () {
        const expandedDirect = yield* expandHome(soulName);
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
          const resolvedBase = yield* expandHome(base);
          const exactPath = `${resolvedBase}/${soulName}/soul.json`;
          const exists = yield* fs.exists(exactPath);
          if (exists) {
            return `${resolvedBase}/${soulName}`;
          }
        }

        const allSouls = yield* getAllSoulsInternal();
        const pattern = new RegExp(soulName, "i");
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
          const resolvedBase = yield* expandHome(base);
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

    const findMatchingSoulsInternal = (pattern: RegExp) => {
      return Effect.gen(function* () {
        const all = yield* getAllSoulsInternal();
        return all.filter((s: string) => pattern.test(s));
      });
    };

    const loadInternal = (soulPath: string, level: number) => {
      return Effect.gen(function* () {
        const currentCache = yield* Ref.get(cache);
        const cachedKey = `${soulPath}:${level}`;
        const cached = currentCache.get(cachedKey);
        if (cached) {
          return cached;
        }

        const resolvedDir = yield* resolveSoulPath(soulPath);
        const manifestPath = `${resolvedDir}/soul.json`;

        const raw = yield* readJsonFile<Record<string, unknown>>(fs, manifestPath);
        const manifest = parseManifest(raw);

        const files = manifest.files;

        if (level >= 2) {
          if (files.soul) {
            manifest.soul_content = yield* readTextFile(fs, `${resolvedDir}/${files.soul}`);
          }
          if (files.identity) {
            manifest.identity_content = yield* readTextFile(fs, `${resolvedDir}/${files.identity}`);
          }
        }

        if (level >= 3) {
          if (files.agents) {
            manifest.agents_content = yield* readTextFile(fs, `${resolvedDir}/${files.agents}`);
          }
          if (files.style) {
            manifest.style_content = yield* readTextFile(fs, `${resolvedDir}/${files.style}`);
          }
          if (files.heartbeat) {
            manifest.heartbeat_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.heartbeat}`,
            );
          }
          if (files.user_template) {
            manifest.user_template_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.user_template}`,
            );
          }
          if (manifest.examples) {
            if (manifest.examples.good) {
              manifest.examples_good_content = yield* readTextFile(
                fs,
                `${resolvedDir}/${manifest.examples.good}`,
              );
            }
            if (manifest.examples.bad) {
              manifest.examples_bad_content = yield* readTextFile(
                fs,
                `${resolvedDir}/${manifest.examples.bad}`,
              );
            }
          }
        }

        if (files.avatar) {
          const avatarFullPath = `${resolvedDir}/${files.avatar}`;
          const avatarExists = yield* fs.exists(avatarFullPath);
          if (avatarExists) {
            manifest.avatar_path = avatarFullPath;
          }
        }

        yield* Ref.update(cache, (m) => new Map(m).set(cachedKey, manifest));

        return manifest;
      });
    };

    // ── Public API ────────────────────────────────────────────────────────────────
    // All errors are caught, logged, and re-mapped to SoulLoadError.
    // Consumers handle a single error type with Effect.catchTag("SoulLoadError", ...).

    /**
     * Load a soul manifest with progressive disclosure.
     *
     * Level 1: metadata only (soul.json)
     * Level 2: include soul_content + identity_content
     * Level 3: include all content (agents, style, heartbeat, user_template, examples)
     *
     * On failure, returns a SoulLoadError with a user-friendly message.
     * For not-found errors, the error also carries suggestion data in `.offers`.
     */
    const load = (soulPath: string, level: number = 2) => {
      return loadInternal(soulPath, level).pipe(
        Effect.catchTags({
          SoulNotFoundError: (e) =>
            Effect.gen(function* () {
              console.debug(`[loader] Soul not found: ${soulPath}`);
              const offers = yield* getSoulOffers(e.soulPath);
              const message = offers
                ? formatSoulOffers(e.soulPath, offers)
                : `Soul "${soulPath}" not found.`;
              return yield* Effect.fail(
                new SoulLoadError({ message, soulName: e.soulPath, offers: offers ?? undefined }),
              );
            }),
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
        Effect.catchAllCause((cause) => {
          if (Cause.isDieType(cause)) {
            console.error(`[loader] Defect loading soul "${soulPath}": ${Cause.pretty(cause)}`);
          } else {
            console.debug(
              `[loader] Unexpected error loading soul "${soulPath}": ${Cause.pretty(cause)}`,
            );
          }
          return Effect.fail(
            new SoulLoadError({ message: "Error loading soul: Unexpected error", cause }),
          );
        }),
      );
    };

    /**
     * List all available souls (directory names that contain soul.json).
     * On failure, returns a SoulLoadError with a user-friendly message.
     */
    const getAllSouls = () => {
      return getAllSoulsInternal().pipe(
        Effect.catchTags({
          NoSoulsFoundError: () => {
            console.debug("[loader] No souls found in any search path");
            return Effect.fail(
              new SoulLoadError({
                message: "No souls found. Create a souls/ directory with soul.json files.",
              }),
            );
          },
        }),
        Effect.catchAllCause((cause) => {
          if (Cause.isDieType(cause)) {
            console.error(`[loader] Defect listing souls: ${Cause.pretty(cause)}`);
          } else {
            console.debug(`[loader] Unexpected error listing souls: ${Cause.pretty(cause)}`);
          }
          return Effect.fail(
            new SoulLoadError({ message: "Error listing souls: Unexpected error", cause }),
          );
        }),
      );
    };

    /**
     * Load all souls with level-1 manifests.
     * Individual load failures are logged and returned as "skipped" entries.
     * Safe — never fails (failures are captured in the result array).
     */
    const enumerateSouls = () => {
      return Effect.gen(function* () {
        const souls = yield* getAllSouls().pipe(
          Effect.catchAll(() => Effect.succeed([] as string[])),
        );
        const entries: EnumeratedSoul[] = [];
        for (const name of souls) {
          const entry = yield* load(name, 1).pipe(
            Effect.map((manifest): EnumeratedSoul => ({ _tag: "loaded", name, manifest })),
            Effect.catchAll(
              (e) =>
                Effect.succeed({
                  _tag: "skipped",
                  name,
                  reason: e.message,
                }) as Effect.Effect<EnumeratedSoul>,
            ),
          );
          entries.push(entry);
        }
        return entries;
      });
    };

    /**
     * Find souls matching a regex pattern.
     * Safe — returns an empty array on error.
     */
    const findMatchingSouls = (pattern: RegExp) => {
      return findMatchingSoulsInternal(pattern).pipe(
        Effect.catchAllCause((cause) => {
          console.debug(
            `[loader] Error searching souls with pattern ${pattern}: ${Cause.pretty(cause)}`,
          );
          return Effect.succeed([] as string[]);
        }),
      );
    };

    return {
      load,
      getAllSouls,
      enumerateSouls,
      findMatchingSouls,
    } as const;
  }),
}) {}
