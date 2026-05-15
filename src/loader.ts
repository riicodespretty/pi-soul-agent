import { Effect, Ref } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { SoulManifest } from "./types";
import { SoulNotFoundError } from "./types";
import { expandHome, parseManifest, readJsonFile, readTextFile } from "./services/soul-fs";

/** Soul search paths (with tilde — expanded at runtime) */
const SOUL_SEARCH_PATHS = [
  "~/.pi/agent/souls",
  "~/.openclaw/souls/clawsouls",
  ".pi/souls",
  "./souls",
] as const;

export class SoulSpecLoader extends Effect.Service<SoulSpecLoader>()("app/SoulSpecLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem;
    const cache = yield* Ref.make<Map<string, SoulManifest>>(new Map());

    /**
     * Resolve a soul name to its manifest directory path.
     * Supports partial matching: "dev" matches "developer" if unique.
     */
    const resolveSoulPath = (soulName: string) => {
      return Effect.gen(function* () {
        // Try as absolute/relative path first (matching reference findExactSoulPath)
        const expandedDirect = expandHome(soulName);
        const directExists = yield* fs.exists(expandedDirect);
        if (directExists) {
          return expandedDirect;
        }
        // Also check if soulName/soul.json exists directly
        const directWithJson = `${expandedDirect}/soul.json`;
        const directJsonExists = yield* fs.exists(directWithJson);
        if (directJsonExists) {
          return expandedDirect;
        }

        // Check exact match across all search paths
        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = expandHome(base);
          const exactPath = `${resolvedBase}/${soulName}/soul.json`;
          const exists = yield* fs.exists(exactPath);
          if (exists) {
            return `${resolvedBase}/${soulName}`;
          }
        }

        // Partial matching — scan all souls dirs
        const allSouls = yield* getAllSouls();
        const pattern = new RegExp(soulName, "i");
        const matches = allSouls.filter((s: string) => pattern.test(s));

        if (matches.length === 0) {
          return yield* Effect.fail(new SoulNotFoundError({ soulPath: soulName }));
        }

        // Return first match (caller can use findMatching for disambiguation)
        return matches[0];
      });
    };

    /**
     * Load a soul manifest with progressive disclosure.
     * Level 1: metadata only (soul.json)
     * Level 2: include soul_content + identity_content
     * Level 3: include all content (agents, style, heartbeat, user_template, examples)
     */
    const load = (soulPath: string, level: number = 2) => {
      return Effect.gen(function* () {
        // Check cache
        const currentCache = yield* Ref.get(cache);
        const cachedKey = `${soulPath}:${level}`;
        const cached = currentCache.get(cachedKey);
        if (cached) {
          return cached;
        }

        // Resolve path
        const resolvedDir = yield* resolveSoulPath(soulPath);
        const manifestPath = `${resolvedDir}/soul.json`;

        // Read and parse manifest (maps camelCase JSON → snake_case TS fields)
        const raw = yield* readJsonFile<Record<string, unknown>>(fs, manifestPath);
        const manifest = parseManifest(raw);

        // Progressive disclosure — load files from disk
        const files = manifest.files;

        if (level >= 2) {
          // Load SOUL.md (core persona)
          if (files.soul) {
            manifest.soul_content = yield* readTextFile(fs, `${resolvedDir}/${files.soul}`).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
            );
          }

          // Load IDENTITY.md
          if (files.identity) {
            manifest.identity_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.identity}`,
            ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          }
        }

        if (level >= 3) {
          // Load AGENTS.md
          if (files.agents) {
            manifest.agents_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.agents}`,
            ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          }

          // Load STYLE.md
          if (files.style) {
            manifest.style_content = yield* readTextFile(fs, `${resolvedDir}/${files.style}`).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
            );
          }

          // Load HEARTBEAT.md
          if (files.heartbeat) {
            manifest.heartbeat_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.heartbeat}`,
            ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          }

          // Load USER_TEMPLATE.md
          if (files.user_template) {
            manifest.user_template_content = yield* readTextFile(
              fs,
              `${resolvedDir}/${files.user_template}`,
            ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          }

          // Load calibration examples
          if (manifest.examples) {
            if (manifest.examples.good) {
              manifest.examples_good_content = yield* readTextFile(
                fs,
                `${resolvedDir}/${manifest.examples.good}`,
              ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
            }
            if (manifest.examples.bad) {
              manifest.examples_bad_content = yield* readTextFile(
                fs,
                `${resolvedDir}/${manifest.examples.bad}`,
              ).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
            }
          }
        }

        // Resolve avatar path
        if (files.avatar) {
          const avatarFullPath = `${resolvedDir}/${files.avatar}`;
          const avatarExists = yield* fs.exists(avatarFullPath);
          if (avatarExists) {
            manifest.avatar_path = avatarFullPath;
          }
        }

        // Update cache
        yield* Ref.update(cache, (m) => new Map(m).set(cachedKey, manifest));

        return manifest;
      });
    };

    /**
     * List all available souls (directory names that contain soul.json).
     */
    const getAllSouls = () => {
      return Effect.gen(function* () {
        const seen = new Set<string>();
        const souls: string[] = [];

        for (const base of SOUL_SEARCH_PATHS) {
          const resolvedBase = expandHome(base);
          const baseExists = yield* fs
            .exists(resolvedBase)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));
          if (!baseExists) continue;

          const entries = yield* fs
            .readDirectory(resolvedBase)
            .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

          for (const entry of entries) {
            if (seen.has(entry)) continue;
            const soulJsonPath = `${resolvedBase}/${entry}/soul.json`;
            const hasSoul = yield* fs
              .exists(soulJsonPath)
              .pipe(Effect.catchAll(() => Effect.succeed(false)));
            if (hasSoul) {
              seen.add(entry);
              souls.push(entry);
            }
          }
        }

        return souls;
      });
    };

    /**
     * Find souls matching a regex pattern.
     */
    const findMatchingSouls = (pattern: RegExp) => {
      return Effect.gen(function* () {
        const all = yield* getAllSouls();
        return all.filter((s: string) => pattern.test(s));
      });
    };

    return {
      load,
      getAllSouls,
      findMatchingSouls,
      resolveSoulPath,
    } as const;
  }),
  dependencies: [],
}) {}
