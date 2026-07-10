import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, SOUL_SEARCH_PATHS } from "../src/loader";
import { expandHome, parseManifest } from "../src/services/soul-fs";
import type { DeepPartial, SoulFiles, SoulManifest, SoulManifestData } from "../src/types";

export type MockSoulManifest = DeepPartial<SoulManifestData> & {
  readonly name: string;
  readonly soulPath?: string;
};

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

export const MOCK_SOUL_MANIFEST: SoulManifest = parseManifest(DEFAULT_SOURCE);

const enoent = (method: string, path: string) =>
  new SystemError({
    module: "FileSystem",
    method,
    reason: "NotFound",
    description: "No such file or directory",
    pathOrDescriptor: path,
  });

export function createMockFsLayer(souls: MockSoulManifest[] = [MOCK_SOUL_MANIFEST]) {
  const expand = (p: string) => Effect.runSync(Effect.provide(expandHome(p), NodePathLayer));

  const dirs: Record<string, string[]> = {};
  for (const p of SOUL_SEARCH_PATHS) dirs[expand(p)] = [];
  const mkdir = (p: string) => (dirs[p] ??= []);

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

  // 3. Writable storage for runtime writes (e.g. persistence files)
  const writableFs: Record<string, string> = {};

  // 4. Helper: check existence across all stores
  const existsInMock = (path: string) => path in dirs || path in fileSystem || path in writableFs;

  // 5. Build the layer
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(existsInMock(path)),
    readFileString: (path) => {
      if (path in writableFs) return Effect.succeed(writableFs[path]);
      if (path in fileSystem) return Effect.succeed(fileSystem[path]);
      return Effect.fail(enoent("readFileString", path));
    },
    readDirectory: (path) => {
      const c = dirs[path];
      if (c !== undefined) return Effect.succeed([...c]);
      return Effect.fail(enoent("readDirectory", path));
    },
    makeDirectory: (_path: string, _options?: { readonly recursive?: boolean }) =>
      Effect.succeed(undefined),
    writeFileString: (path: string, content: string) =>
      Effect.sync(() => {
        writableFs[path] = content;
      }),
    remove: (path: string) =>
      Effect.sync(() => {
        delete writableFs[path];
      }),
  });
}

// ── Legacy helpers ────────────────────────────────────────────────────────────

/**
 * Create a fresh SoulSpecLoader layer (new cache per call).
 * @deprecated Use `Layer.fresh(SoulSpecLoader.Default)` directly.
 */
export const freshLoaderLayer = () => Layer.fresh(SoulSpecLoader.Default);
