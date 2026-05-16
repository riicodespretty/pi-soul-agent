import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { SoulSpecLoader } from "@/src/loader";
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

/** Second search path expanded */
const SECOND_PATH = `${HOME}/.openclaw/souls/clawsouls`;

/** Relative search paths (not tilde-prefixed — used as-is) */
const REL_PATH_1 = ".pi/souls";
const REL_PATH_2 = "./souls";

/**
 * Default soul manifest as camelCase JSON.
 * This is what parseManifest actually expects from a real soul.json on disk.
 * (The SoulManifest TS type uses snake_case internally after parsing.)
 */
export const DEFAULT_MANIFEST_JSON = JSON.stringify({
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
});

/**
 * Default mock soul manifest (snake_case TS type fields).
 * Kept for backward compatibility — existing tests may reference it.
 *
 * NOTE: JSON.stringify(this) produces snake_case keys which does NOT
 * round-trip correctly through parseManifest. Use DEFAULT_MANIFEST_JSON
 * or explicit camelCase JSON for new test code.
 */
export const MOCK_SOUL_MANIFEST: SoulManifest = {
  name: "bodhisattva-coder",
  display_name: "Bodhisattva Coder",
  version: "1.0.0",
  spec_version: "0.5",
  description: "A test bodhisattva coder soul",
  author: { name: "Test Author" },
  license: "MIT",
  tags: ["coder", "bodhisattva"],
  category: "general",
  compatibility: { models: [], frameworks: [] },
  allowed_tools: [],
  recommended_skills: [],
  files: { soul: "SOUL.md" },
  deprecated: false,
  environment: "virtual",
  interaction_mode: "text",
  sensors: [],
  actuators: [],
  soul_content: "# Bodhisattva Coder\n\nA coding assistant with bodhisattva vows.",
  identity_content: "You are Bodhisattva Coder, a helpful AI assistant.",
};

// ── Internal helpers ──────────────────────────────────────────────────────────

const enoent = (method: string, path: string) =>
  new SystemError({
    module: "FileSystem",
    method,
    reason: "NotFound",
    description: "No such file or directory",
    pathOrDescriptor: path,
  });

function defaultManifestJson(name: string): string {
  return JSON.stringify({
    specVersion: "0.5",
    name,
    displayName: name,
    version: "1.0.0",
    description: "A test soul",
    author: { name: "Test Author" },
    license: "MIT",
    tags: [],
    category: "general",
    compatibility: { models: [], frameworks: [] },
    allowedTools: [],
    recommendedSkills: [],
    files: { soul: "SOUL.md" },
    deprecated: false,
    environment: "virtual",
    interactionMode: "text",
  });
}

/**
 * Standard directory skeleton for all 4 search paths + parent chains.
 * Every mock starts from this base so expandHome and loadAllSouls iteration
 * do not crash on missing directories.
 */
const BASE_DIRS: Record<string, string[]> = {
  // First search path: ~/.pi/agent/souls
  [FIRST_PATH]: [],
  [`${HOME}/.pi/agent`]: ["souls"],
  [`${HOME}/.pi`]: ["agent"],
  [HOME]: [".pi"],
  // Second search path: ~/.openclaw/souls/clawsouls
  [SECOND_PATH]: [],
  [`${HOME}/.openclaw/souls`]: ["clawsouls"],
  [`${HOME}/.openclaw`]: ["souls"],
  // Relative paths
  [REL_PATH_1]: [],
  [".pi"]: ["souls"],
  [REL_PATH_2]: [],
};

// ── Mock builder ──────────────────────────────────────────────────────────────

/**
 * Build a mock FileSystem.layerNoop from the given soul definitions.
 *
 * Every mock starts with a complete directory skeleton for all 4 search paths.
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
  // Deep-clone BASE_DIRS so multiple calls don't share state
  const dirs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(BASE_DIRS)) {
    dirs[k] = [...v];
  }

  const fileContents: Record<string, string> = {};
  const filePaths = new Set<string>();

  // If souls arg is undefined (not empty array), use a default soul (backward compat)
  const defs = souls ?? [
    {
      name: "bodhisattva-coder" as string,
      files: { "SOUL.md": MOCK_SOUL_MANIFEST.soul_content ?? "" } as Record<string, string>,
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
    fileContents[sjPath] = soul.manifestJson ?? defaultManifestJson(soul.name);
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
