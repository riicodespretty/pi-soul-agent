import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, SOUL_SEARCH_PATHS } from "@/src/loader";
import { expandHome, parseManifest } from "@/src/services/soul-fs";
import type { DeepPartial, SoulManifest, SoulManifestData } from "@/src/types";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Soul definition for building mock FS layers.
 *
 * The `manifest` captures everything.
 * Content files referenced in `manifest.files` and `manifest.examples`
 * are auto-created with empty content. Use `fileContents` to override.
 */
export interface MockSoulDef {
  /** Partial manifest to merge with auto-generated defaults. */
  readonly manifest?: DeepPartial<SoulManifestData>;
  /** Content overrides for mock FS files: filename → content string. */
  readonly fileContents?: Record<string, string>;
  /** Search path to place this soul in (default: ~/.pi/agent/souls) */
  readonly soulPath?: string;
}

// ── Source of truth: typed default manifest — matches what a real soul.json looks like ──

const DEFAULT_SOURCE: SoulManifestData = {
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
  sensors: [],
  actuators: [],
};

/**
 * Derived SoulManifest via parseManifest.
 * NOTE: Content fields (soulContent, identityContent, etc.) are not included
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
 *   - A `soul.json` file (auto-generated + merged with explicit manifest)
 *   - Content files auto-created from `manifest.files` + `manifest.examples`
 *
 * @example
 * ```ts
 * createMockFsLayer([{ manifest: { name: "my-soul", files: { soul: "SOUL.md" } } }])
 * ```
 */
export function createMockFsLayer(souls?: MockSoulDef[]) {
  const expand = (p: string) => Effect.runSync(Effect.provide(expandHome(p), NodePathLayer));

  // 1. Directory skeleton — all search paths as empty dirs
  const dirs: Record<string, string[]> = {};
  for (const p of SOUL_SEARCH_PATHS) dirs[expand(p)] = [];
  const mkdir = (p: string) => (dirs[p] ??= []);

  // 2. File contents (soul.json + content files) for each soul
  const fileSystem: Record<string, string> = {};

  const defaultDef = (): MockSoulDef => ({
    manifest: { name: "bodhisattva-coder" },
  });
  const defs = souls ?? [defaultDef()];
  for (const soul of defs) {
    const merged = {
      ...DEFAULT_SOURCE,
      ...soul.manifest,
      name: soul.manifest?.name ?? DEFAULT_SOURCE.name,
    };
    const soulName = merged.name;
    const baseDir = soul.soulPath ?? expand(SOUL_SEARCH_PATHS[0]);
    const soulDir = `${baseDir}/${soulName}`;

    mkdir(baseDir).push(soulName);
    mkdir(soulDir);

    // Write soul.json
    fileSystem[`${soulDir}/soul.json`] = JSON.stringify(merged);

    // Write explicitly provided content files only
    for (const [fp, content] of Object.entries(soul.fileContents ?? {})) {
      fileSystem[`${soulDir}/${fp}`] = content;
    }
  }

  // 3. Build the layer
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path in dirs || path in fileSystem),
    readFileString: (path) => {
      if (path in fileSystem) return Effect.succeed(fileSystem[path]);
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
