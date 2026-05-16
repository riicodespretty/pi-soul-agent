import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { SoulSpecLoader, SOUL_SEARCH_PATHS } from "@/src/loader";
import { parseManifest } from "@/src/services/soul-fs";
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
  // Build directory skeleton from SOUL_SEARCH_PATHS
  const dirs: Record<string, string[]> = {};
  for (const p of SOUL_SEARCH_PATHS) {
    const resolved = p.startsWith("~/") ? `${HOME}/${p.slice(2)}` : p;
    dirs[resolved] = [];
  }

  const fileContents: Record<string, string> = {};
  const filePaths = new Set<string>();

  // If souls arg is undefined (not empty array), use a default soul (backward compat)
  const defs = souls ?? [
    {
      name: "bodhisattva-coder" as string,
      files: { "SOUL.md": "" } as Record<string, string>,
    },
  ];

  for (const soul of defs) {
    const baseDir = soul.searchPath ?? FIRST_PATH;
    const soulDir = `${baseDir}/${soul.name}`;

    // Register in parent directory listing
    if (!dirs[baseDir]) dirs[baseDir] = [];
    dirs[baseDir].push(soul.name);

    // Create soul directory entry (for exists + readDirectory)
    if (!dirs[soulDir]) dirs[soulDir] = [];

    // soul.json
    const sjPath = `${soulDir}/soul.json`;
    fileContents[sjPath] =
      soul.manifestJson ??
      JSON.stringify({
        ...DEFAULT_SOURCE,
        name: soul.name,
        displayName: soul.name,
        description: "A test soul",
        tags: [],
      });
    filePaths.add(sjPath);

    // Content files
    for (const [filename, content] of Object.entries(soul.files ?? {})) {
      const fp = `${soulDir}/${filename}`;
      fileContents[fp] = content;
      filePaths.add(fp);
    }
  }

  const dirPathSet = new Set(Object.keys(dirs));

  return FileSystem.layerNoop({
    exists: (path: string) => Effect.succeed(dirPathSet.has(path) || filePaths.has(path)),
    readFileString: (path: string) => {
      if (path in fileContents) return Effect.succeed(fileContents[path]);
      return Effect.fail(enoent("readFileString", path));
    },
    readDirectory: (path: string) => {
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
