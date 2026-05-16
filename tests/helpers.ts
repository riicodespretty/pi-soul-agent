import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, SOUL_SEARCH_PATHS } from "@/src/loader";
import { expandHome, parseManifest } from "@/src/services/soul-fs";
import type { DeepPartial, SoulFiles, SoulManifest, SoulManifestData } from "@/src/types";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Soul definition for building mock FS layers.
 * Any field from SoulManifestData can be provided; the rest get defaults.
 * Content files referenced in `files` are auto-created with empty content.
 */
export type MockSoulManifest = DeepPartial<SoulManifestData> & {
  readonly name: string;
  /** Search path to place this soul in (default: ~/.pi/agent/souls) */
  readonly soulPath?: string;
};

// ── Source of truth: typed default manifest — matches what a real soul.json looks like ──
export const DEFAULT_SOURCE: SoulManifestData = {
  specVersion: "0.5",
  name: "senior-devops-engineer",
  displayName: "Senior DevOps Engineer",
  version: "1.0.0",
  description:
    "Infrastructure-obsessed DevOps engineer with strong opinions on CI/CD, monitoring, and incident response.",
  author: {
    name: "TomLee",
    github: "TomLeeLive",
  },
  license: "Apache-2.0",
  tags: ["devops", "infrastructure", "cicd", "monitoring"],
  category: "work/devops",
  compatibility: {
    openclaw: ">=2026.2.0",
    models: ["anthropic/*", "openai/*"],
    frameworks: ["openclaw", "clawdbot", "zeroclaw", "cursor"],
  },
  allowedTools: ["browser", "exec", "web_search", "github"],
  recommendedSkills: [
    { name: "github", version: ">=1.0.0", required: false },
    { name: "healthcheck", required: true },
  ],
  files: {
    soul: "SOUL.md",
    identity: "IDENTITY.md",
    agents: "AGENTS.md",
    heartbeat: "HEARTBEAT.md",
    style: "STYLE.md",
    userTemplate: "USER_TEMPLATE.md",
    avatar: "avatar/avatar.png",
  },
  examples: {
    good: "examples/good-outputs.md",
    bad: "examples/bad-outputs.md",
  },
  disclosure: {
    summary: "Infrastructure-obsessed DevOps engineer with strong CI/CD opinions.",
  },
  deprecated: false,
  repository: "https://github.com/clawsouls/souls",
  environment: "virtual",
  interactionMode: "text",
  sensors: {},
  actuators: {},
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
 * createMockFsLayer([{ name: "my-soul", files: { soul: "SOUL.md" } }])
 * ```
 */
export function createMockFsLayer(souls: MockSoulManifest[] = [MOCK_SOUL_MANIFEST]) {
  const expand = (p: string) => Effect.runSync(Effect.provide(expandHome(p), NodePathLayer));

  // 1. Directory skeleton — all search paths as empty dirs
  const dirs: Record<string, string[]> = {};
  for (const p of SOUL_SEARCH_PATHS) dirs[expand(p)] = [];
  const mkdir = (p: string) => (dirs[p] ??= []);

  // 2. File contents (soul.json + content files) for each soul
  const fileSystem: Record<string, string> = {};

  for (const soul of souls) {
    const { soulPath, ...manifestFields } = soul;
    const merged: MockSoulManifest = {
      ...DEFAULT_SOURCE,
      ...manifestFields,
    };
    const soulName = merged.name;
    const baseDir = soulPath ?? expand(SOUL_SEARCH_PATHS[0]);
    const soulDir = `${baseDir}/${soulName}`;

    mkdir(baseDir).push(soulName);
    mkdir(soulDir);

    // Write soul.json
    fileSystem[`${soulDir}/soul.json`] = JSON.stringify(merged);

    // Auto-create content files from manifest.files entries (empty content)
    const mf = merged.files;
    if (mf) {
      (Object.keys(mf) as Array<keyof SoulFiles>).forEach((key) => {
        const path = mf[key];
        if (path) fileSystem[`${soulDir}/${path}`] = "";
      });
    }
    const examples = merged.examples;
    if (examples) {
      if (examples.good) fileSystem[`${soulDir}/${examples.good}`] = "";
      if (examples.bad) fileSystem[`${soulDir}/${examples.bad}`] = "";
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
