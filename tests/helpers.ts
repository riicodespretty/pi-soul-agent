import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, SOUL_SEARCH_PATHS } from "@/src/loader";
import { expandHome, parseManifest } from "@/src/services/soul-fs";
import type { SoulManifest } from "@/src/types";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Soul definition for building mock FS layers.
 * The soul.json is generated with camelCase keys matching parseManifest expectations
 * (e.g. `displayName` not `display_name`).
 */
export interface MockSoulDef {
  /** Soul directory name (used as both directory name and manifest `name`) */
  readonly name: string;
  /** Explicit camelCase JSON for soul.json. Auto-generated from `name` if omitted. */
  readonly manifestJson?: string;
  /** Content files to create: filename → content string. */
  readonly files?: Record<string, string>;
  /** Search path to place this soul in (default: ~/.pi/agent/souls) */
  readonly searchPath?: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const HOME = "/Users/test";

/** First search path (~/.pi/agent/souls) expanded with test HOME */
export const FIRST_PATH = `${HOME}/.pi/agent/souls`;

// ── Source of truth: camelCase JSON (what a real soul.json looks like) ──────

const DEFAULT_SOURCE = {
  specVersion: "0.5",
  name: "bodhisattva-coder",
  displayName: "Bodhisattva Coder",
  version: "1.0.0",
  description: "A test bodhisattva coder soul",
  author: { name: "Test Author" },
  license: "MIT",
  tags: ["coder", "bodhisattva"],
  category: "general",
  compatibility: { models: [], frameworks: [] },
  allowedTools: [],
  recommendedSkills: [],
  files: { soul: "SOUL.md" },
  deprecated: false,
  environment: "virtual",
  interactionMode: "text",
};

/**
 * Derived SoulManifest via parseManifest.
 * NOTE: content fields (soul_content, identity_content, etc.) are not included
 * because parseManifest only parses the JSON manifest — loadSoul sets them
 * at runtime by reading content files.
 */
export const MOCK_SOUL_MANIFEST: SoulManifest = parseManifest(DEFAULT_SOURCE);

// ── Internal helpers ──────────────────────────────────────────────────────────

const enoent = (method: string, path: string) =>
  new SystemError({
    module: "FileSystem",
    method,
    reason: "NotFound",
    description: "No such file or directory",
    pathOrDescriptor: path,
  });

// ── Mock builder ──────────────────────────────────────────────────────────────

/**
 * Build a mock FileSystem.layerNoop from the given soul definitions.
 *
 * Every mock starts with a directory skeleton for all 4 search paths.
 * Each soul gets:
 *   - An entry in its parent search path's directory listing
 *   - Its own directory (for listing & exists checks)
 *   - A `soul.json` file (auto-generated or explicit)
 *   - Any content files declared via `.files`
 *
 * @example
 * ```ts
 * createMockFsLayer([{ name: "my-soul", files: { "SOUL.md": "# Hello" } }])
 * ```
 */
export function createMockFsLayer(souls?: MockSoulDef[]) {
  // 1. Directory skeleton — all search paths as empty dirs
  const dirs: Record<string, string[]> = {};
  for (const p of SOUL_SEARCH_PATHS) {
    dirs[Effect.runSync(Effect.provide(expandHome(p), NodePathLayer))] = [];
  }
  const mkdir = (p: string) => (dirs[p] ??= []);

  // 2. File contents (soul.json + content files) for each soul
  const files: Record<string, string> = {};

  const defs = souls ?? [{ name: "bodhisattva-coder", files: { "SOUL.md": "" } }];
  for (const soul of defs) {
    const baseDir = soul.searchPath ?? FIRST_PATH;
    const soulDir = `${baseDir}/${soul.name}`;

    mkdir(baseDir).push(soul.name);
    mkdir(soulDir);

    files[`${soulDir}/soul.json`] =
      soul.manifestJson ??
      JSON.stringify({
        ...DEFAULT_SOURCE,
        name: soul.name,
        displayName: soul.name,
        description: "A test soul",
        tags: [],
      });

    for (const [fn, content] of Object.entries(soul.files ?? {})) {
      files[`${soulDir}/${fn}`] = content;
    }
  }

  // 3. Build the layer
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path in dirs || path in files),
    readFileString: (path) => {
      if (path in files) return Effect.succeed(files[path]);
      return Effect.fail(enoent("readFileString", path));
    },
    readDirectory: (path) => {
      const c = dirs[path];
      if (c !== undefined) return Effect.succeed([...c]);
      return Effect.fail(enoent("readDirectory", path));
    },
  });
}

// ── Legacy helpers ────────────────────────────────────────────────────────────

/**
 * Create a fresh SoulSpecLoader layer (new cache per call).
 * @deprecated Use `Layer.fresh(SoulSpecLoader.Default)` directly.
 */
export const freshLoaderLayer = () => Layer.fresh(SoulSpecLoader.Default);
