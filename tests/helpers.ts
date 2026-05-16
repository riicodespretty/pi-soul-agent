import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { SoulSpecLoader } from "@/src/loader";
import type { SoulManifest } from "@/src/types";

/**
 * Default mock soul manifest — matches SoulManifest type exactly.
 * Used as fixture data for mock FileSystem layers.
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

/**
 * Create a fresh SoulSpecLoader layer (new cache per call).
 * Must be used inside each test's .pipe(Effect.provide(...)).
 */
export const freshLoaderLayer = () => Layer.fresh(SoulSpecLoader.Default);

/**
 * Known file paths in the mock filesystem.
 * Uses exact Set<string> matching — NO `path.includes()` false positives.
 */
const MOCK_PATHS = new Set([
  // soul in search path 1 (~/.pi/agent/souls)
  "/Users/test/.pi/agent/souls/bodhisattva-coder",
  "/Users/test/.pi/agent/souls/bodhisattva-coder/soul.json",
  "/Users/test/.pi/agent/souls/bodhisattva-coder/SOUL.md",
]);

/** Directories that exist and their contents */
const MOCK_DIRS: Record<string, string[]> = {
  "/Users/test/.pi/agent/souls": ["bodhisattva-coder"],
  "/Users/test/.pi/agent": ["souls"],
  "/Users/test/.pi": ["agent"],
  "/Users/test": [".pi"],
};

/** All known directory paths for exists() lookups */
const DIR_PATHS = new Set(Object.keys(MOCK_DIRS));

/**
 * Create a mock FileSystem layer using FileSystem.layerNoop.
 * Uses exact Set<string> path matching — no `path.includes()` false positives.
 *
 * @param manifestOverride - Optional partial override for the default manifest
 * @param extraPaths - Additional file paths to mark as existing
 */
export const createMockFsLayer = (
  manifestOverride?: Partial<SoulManifest>,
  extraPaths?: string[],
) => {
  const manifest = { ...MOCK_SOUL_MANIFEST, ...manifestOverride };
  const manifestJson = JSON.stringify(manifest);
  const allPaths = new Set(MOCK_PATHS);
  if (extraPaths) extraPaths.forEach((p) => allPaths.add(p));

  const enoent = (method: string, path: string) =>
    new SystemError({
      module: "FileSystem",
      method,
      reason: "NotFound",
      description: "No such file or directory",
      pathOrDescriptor: path,
    });

  return FileSystem.layerNoop({
    exists: (path: string) => Effect.succeed(allPaths.has(path) || DIR_PATHS.has(path)),
    readFileString: (path: string) => {
      if (path.endsWith("soul.json") && allPaths.has(path)) {
        return Effect.succeed(manifestJson);
      }
      if (path.endsWith("SOUL.md") && allPaths.has(path)) {
        return Effect.succeed(manifest.soul_content ?? "");
      }
      return Effect.fail(enoent("readFileString", path));
    },
    readDirectory: (path: string) => {
      const contents = MOCK_DIRS[path];
      if (contents) return Effect.succeed([...contents]);
      return Effect.fail(enoent("readDirectory", path));
    },
  });
};
