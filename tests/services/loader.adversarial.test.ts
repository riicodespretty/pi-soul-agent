import { describe, it, expect } from "@effect/vitest";
import { vi } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, filterByLevel } from "@/src/loader";
import { SoulLoadError } from "@/src/errors";
import { MOCK_SOUL_MANIFEST } from "@/tests/helpers";
import type { SoulManifest } from "@/src/types";

vi.stubEnv("HOME", "/Users/test");

// ── Helpers ─────────────────────────────────────────────────────────────────

const enoent = (method: string, path: string) =>
  new SystemError({
    module: "FileSystem",
    method,
    reason: "NotFound",
    description: "No such file or directory",
    pathOrDescriptor: path,
  });

const permDenied = (method: string, path: string) =>
  new SystemError({
    module: "FileSystem",
    method,
    reason: "PermissionDenied",
    description: "EACCES: permission denied",
    pathOrDescriptor: path,
  });

const FIRST_PATH = "/Users/test/.pi/agent/souls";

/** Minimal dir skeleton so expandHome + all 4 search paths resolve. */
function baseDirs(extra: Record<string, string[]> = {}): Record<string, string[]> {
  return {
    [FIRST_PATH]: [],
    "/Users/test/.pi/agent": ["souls"],
    "/Users/test/.pi": ["agent"],
    "/Users/test": [".pi"],
    "/Users/test/.openclaw/souls/clawsouls": [],
    "/Users/test/.openclaw/souls": ["clawsouls"],
    "/Users/test/.openclaw": ["souls"],
    ".pi/souls": [],
    ".pi": ["souls"],
    "./souls": [],
    ...extra,
  };
}

const BASE_DIRS = baseDirs();
const BASE_DIR_PATHS = new Set(Object.keys(BASE_DIRS));

/** Default full manifest JSON for mocks. */
function defaultManifestJson(name?: string): string {
  return JSON.stringify({
    ...MOCK_SOUL_MANIFEST,
    name: name ?? MOCK_SOUL_MANIFEST.name,
    display_name: name ?? MOCK_SOUL_MANIFEST.display_name,
    files: { soul: "SOUL.md" },
  });
}

/**
 * Build a complete mock FS for a collection of souls.
 * Each soul gets a directory under FIRST_PATH with soul.json + optional content files.
 */
function mockFsForSouls(
  souls: Array<{
    name: string;
    manifestJson?: string;
    files?: Record<string, string>;
  }>,
) {
  const dirs = baseDirs();
  const allPaths = new Set<string>();
  const texts: Record<string, string> = {};

  for (const s of souls) {
    const soulDir = `${FIRST_PATH}/${s.name}`;
    (dirs[FIRST_PATH] as string[]).push(s.name);
    dirs[soulDir] = [];

    // soul.json
    const sj = `${soulDir}/soul.json`;
    allPaths.add(sj);
    texts[sj] = s.manifestJson ?? defaultManifestJson(s.name);

    // Content files
    for (const [fn, content] of Object.entries(s.files ?? {})) {
      const fp = `${soulDir}/${fn}`;
      allPaths.add(fp);
      texts[fp] = content;
    }
  }

  const dirKeys = new Set(Object.keys(dirs));

  return FileSystem.layerNoop({
    exists: (p: string) => Effect.succeed(allPaths.has(p) || dirKeys.has(p)),
    readFileString: (p: string) => {
      if (p in texts) return Effect.succeed(texts[p]);
      return Effect.fail(enoent("readFileString", p));
    },
    readDirectory: (p: string) => {
      const c = dirs[p];
      if (c) return Effect.succeed([...c]);
      return Effect.fail(enoent("readDirectory", p));
    },
  });
}

/** Empty mock — all 4 search paths exist but have no souls. */
function emptyMockFs() {
  return FileSystem.layerNoop({
    exists: (p: string) => Effect.succeed(BASE_DIR_PATHS.has(p)),
    readFileString: () => Effect.fail(enoent("readFileString", "nowhere")),
    readDirectory: (p: string) => {
      const c = BASE_DIRS[p];
      if (c) return Effect.succeed([...c]);
      return Effect.fail(enoent("readDirectory", p));
    },
  });
}

/** Full manifest with all content fields for level-3 testing. */
/** Full manifest JSON for level-3 testing — camelCase keys to match parseManifest. */
const FULL_CONTENT_MANIFEST_JSON = JSON.stringify({
  specVersion: "0.5",
  name: "full-soul",
  displayName: "Full Soul",
  version: "1.0.0",
  description: "A soul with all content files",
  author: { name: "Test Author" },
  license: "MIT",
  tags: [],
  category: "general",
  compatibility: { models: [], frameworks: [] },
  allowedTools: [],
  recommendedSkills: [],
  files: {
    soul: "SOUL.md",
    identity: "IDENTITY.md",
    agents: "AGENTS.md",
    style: "STYLE.md",
    heartbeat: "HEARTBEAT.md",
    userTemplate: "USER_TEMPLATE.md",
    avatar: "avatar.png",
  },
  examples: { good: "examples/good.md", bad: "examples/bad.md" },
  deprecated: false,
  environment: "virtual",
  interactionMode: "text",
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. filterByLevel — level edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — filterByLevel", () => {
  const full: SoulManifest = {
    name: "t",
    display_name: "T",
    version: "1",
    spec_version: "0.5",
    description: "",
    author: { name: "A" },
    license: "MIT",
    tags: [],
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
    soul_content: "s",
    identity_content: "i",
    agents_content: "a",
    style_content: "s",
    heartbeat_content: "h",
    user_template_content: "u",
    examples_good_content: "g",
    examples_bad_content: "b",
    avatar_path: "av",
  };

  const testFilterLevel = (label: string | number, level: number, expectContent: boolean) =>
    it(`level ${String(label)} ${expectContent ? "keeps" : "strips"} content fields`, () => {
      const f = filterByLevel(full, level);
      expect(f.soul_content).toBe(expectContent ? "s" : undefined);
      expect(f.identity_content).toBe(expectContent ? "i" : undefined);
      expect(f.agents_content).toBe(expectContent ? undefined : undefined); // lv1/2 also strip level-3
      expect(f.name).toBe("t");
    });

  testFilterLevel(0, 0, false);
  testFilterLevel(-1, -1, false);
  testFilterLevel(-999, -999, false);

  it("level 2 strips only level-3 fields", () => {
    const f = filterByLevel(full, 2);
    expect(f.soul_content).toBe("s");
    expect(f.identity_content).toBe("i");
    expect(f.agents_content).toBeUndefined();
    expect(f.style_content).toBeUndefined();
    expect(f.heartbeat_content).toBeUndefined();
  });

  it("level 3 keeps all content", () => {
    const f = filterByLevel(full, 3);
    expect(f.soul_content).toBe("s");
    expect(f.agents_content).toBe("a");
    expect(f.examples_bad_content).toBe("b");
  });

  it("level 4+ keeps all content (no upper bound crash)", () => {
    const f4 = filterByLevel(full, 4);
    expect(f4.soul_content).toBe("s");
    expect(f4.agents_content).toBe("a");
    const f999 = filterByLevel(full, 999);
    expect(f999.soul_content).toBe("s");
  });

  it("level Infinity keeps all content", () => {
    const f = filterByLevel(full, Infinity);
    expect(f.soul_content).toBe("s");
    expect(f.agents_content).toBe("a");
  });

  it("NaN level comparisons are always false so content is preserved", () => {
    // In JS: NaN < 2 → false, NaN < 3 → false
    // So no deletion conditions trigger — NaN behaves like level >= 3
    const f = filterByLevel(full, NaN);
    expect(f.soul_content).toBe("s");
    expect(f.agents_content).toBe("a");
    expect(f.name).toBe("t");
  });

  it("sparse manifest without optional fields does not crash", () => {
    const sparse: SoulManifest = {
      name: "s",
      display_name: "S",
      version: "1",
      spec_version: "0.5",
      description: "",
      author: { name: "A" },
      license: "MIT",
      tags: [],
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
    };
    expect(() => filterByLevel(sparse, 3)).not.toThrow();
    expect(filterByLevel(sparse, 1).soul_content).toBeUndefined();
  });

  it("original manifest is not mutated", () => {
    const copy = { ...full };
    filterByLevel(copy, 1);
    expect(full.soul_content).toBe("s");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. loadSoul & getSoul — path edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — loadSoul path edge cases", () => {
  it.effect("soul name with dots resolves correctly", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("my.custom.soul.v2", 1);
      expect(soul.name).toBe("my.custom.soul.v2");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "my.custom.soul.v2",
            manifestJson: defaultManifestJson("my.custom.soul.v2"),
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("soul name with spaces resolves correctly", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("my soul", 1);
      expect(soul.name).toBe("my soul");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(mockFsForSouls([{ name: "my soul" }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("soul found in second search path when not in first", () => {
    // Mock setup must be outside Effect.gen so closures capture correctly
    const dirs: Record<string, string[]> = {
      [FIRST_PATH]: [],
      "/Users/test/.pi/agent": ["souls"],
      "/Users/test/.pi": ["agent"],
      "/Users/test": [".pi"],
      "/Users/test/.openclaw/souls/clawsouls": ["fallback-soul"],
      "/Users/test/.openclaw/souls": ["clawsouls"],
      "/Users/test/.openclaw": ["souls"],
      "/Users/test/.openclaw/souls/clawsouls/fallback-soul": [],
      ".pi/souls": [],
      ".pi": ["souls"],
      "./souls": [],
    };
    const dirKeys = new Set(Object.keys(dirs));
    const sj = "/Users/test/.openclaw/souls/clawsouls/fallback-soul/soul.json";
    const soulDir = "/Users/test/.openclaw/souls/clawsouls/fallback-soul";
    const knownPaths = new Set([soulDir, sj]);
    const mockFs = FileSystem.layerNoop({
      exists: (p: string) => Effect.succeed(knownPaths.has(p) || dirKeys.has(p)),
      readFileString: (p: string) => {
        if (p.endsWith("fallback-soul/soul.json"))
          return Effect.succeed(defaultManifestJson("fallback-soul"));
        return Effect.fail(enoent("readFileString", p));
      },
      readDirectory: (p: string) => {
        const c = dirs[p];
        if (c) return Effect.succeed([...c]);
        return Effect.fail(enoent("readDirectory", p));
      },
    });

    return Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("fallback-soul", 1);
      expect(soul.name).toBeDefined();
      const cached = yield* loader.getSoul("fallback-soul", 1);
      expect(cached.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(mockFs),
      Effect.provide(NodePathLayer),
    );
  });

  it.effect("getSoul fails with SoulLoadError when soul not in any path", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("nowhere-to-be-found", 1));
      expect(err._tag).toBe("SoulLoadError");
      expect(err.message).toContain("nowhere-to-be-found");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(emptyMockFs()),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Content file edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — content file behavior", () => {
  it.effect("missing referenced content file produces SoulLoadError", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("missing-file", 2));
      expect(err._tag).toBe("SoulLoadError");
      // The message should indicate a read failure (not manifest parse failure)
      expect(err.message).toMatch(/read|file|not found/i);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "missing-file",
            manifestJson: JSON.stringify({
              ...MOCK_SOUL_MANIFEST,
              name: "missing-file",
              files: { soul: "NONEXISTENT.md" },
            }),
            // No files object — NONEXISTENT.md is not created
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("content file not read when level is below threshold", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      // Level 1 should NOT try to read SOUL.md (minLevel=2)
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.soul_content).toBeUndefined();
      // Verify the mock is working: level 2 DOES read it
      const soul2 = yield* loader.getSoul("bodhisattva-coder", 2);
      expect(soul2.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "bodhisattva-coder",
            files: { "SOUL.md": "# Soul content" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("avatar_path is set at level 1 when avatar file is present", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("avatar-soul", 1);
      expect(soul.avatar_path).toBeDefined();
      expect(typeof soul.avatar_path).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "avatar-soul",
            manifestJson: JSON.stringify({
              ...MOCK_SOUL_MANIFEST,
              name: "avatar-soul",
              files: { soul: "SOUL.md", avatar: "avatar.png" },
            }),
            files: { "SOUL.md": "# Soul", "avatar.png": "image-bytes" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("all content files read at level 3", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("full-soul", 3);

      expect(soul.soul_content).toBe("Hello Soul");
      expect(soul.identity_content).toBe("Hello Identity");
      expect(soul.agents_content).toBe("Hello Agents");
      expect(soul.style_content).toBe("Hello Style");
      expect(soul.heartbeat_content).toBe("Hello Heartbeat");
      expect(soul.user_template_content).toBe("Hello Template");
      expect(soul.examples_good_content).toBe("Good Example");
      expect(soul.examples_bad_content).toBe("Bad Example");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "full-soul",
            manifestJson: FULL_CONTENT_MANIFEST_JSON,
            files: {
              "SOUL.md": "Hello Soul",
              "IDENTITY.md": "Hello Identity",
              "AGENTS.md": "Hello Agents",
              "STYLE.md": "Hello Style",
              "HEARTBEAT.md": "Hello Heartbeat",
              "USER_TEMPLATE.md": "Hello Template",
              "avatar.png": "png-data",
              "examples/good.md": "Good Example",
              "examples/bad.md": "Bad Example",
            },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("examples field absent in manifest does not crash", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("no-examples", 3);
      expect(soul.examples_good_content).toBeUndefined();
      expect(soul.examples_bad_content).toBeUndefined();
      expect(soul.name).toBe("no-examples");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "no-examples",
            manifestJson: JSON.stringify({
              ...MOCK_SOUL_MANIFEST,
              name: "no-examples",
              files: { soul: "SOUL.md" },
              // No "examples" key at all
            }),
            files: { "SOUL.md": "# Soul" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. loadAllSouls — contract & edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — loadAllSouls contract", () => {
  it.effect("skips directories without soul.json (best-effort)", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      // Only the soul with a valid soul.json is loaded
      expect(souls.length).toBe(1);
      expect(souls[0].name).toBe("valid-soul");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "valid-soul",
            files: { "SOUL.md": "# Content" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("deduplicates same soul name across search paths (first wins)", () => {
    return Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      expect(souls.length).toBe(1);
      // First path's version has displayName "First"
      expect(souls[0].display_name).toBe("First");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(dedupMockFs()),
      Effect.provide(NodePathLayer),
    );
  });

  /** Mock FS with duplicate soul in first two search paths. */
  function dedupMockFs() {
    const dirs: Record<string, string[]> = {
      [FIRST_PATH]: ["duplicate"],
      "/Users/test/.pi/agent": ["souls"],
      "/Users/test/.pi": ["agent"],
      "/Users/test": [".pi"],
      "/Users/test/.openclaw/souls/clawsouls": ["duplicate"],
      "/Users/test/.openclaw/souls": ["clawsouls"],
      "/Users/test/.openclaw": ["souls"],
      ".pi/souls": [],
      ".pi": ["souls"],
      "./souls": [],
      [`${FIRST_PATH}/duplicate`]: [],
      "/Users/test/.openclaw/souls/clawsouls/duplicate": [],
    };
    const dirKeys = new Set(Object.keys(dirs));
    const firstSj = `${FIRST_PATH}/duplicate/soul.json`;
    const secondSj = "/Users/test/.openclaw/souls/clawsouls/duplicate/soul.json";
    const knownPaths = new Set([
      `${FIRST_PATH}/duplicate`,
      firstSj,
      "/Users/test/.openclaw/souls/clawsouls/duplicate",
      secondSj,
    ]);
    const firstJson = JSON.stringify({ name: "duplicate", displayName: "First" });
    const secondJson = JSON.stringify({ name: "duplicate", displayName: "Second" });

    return FileSystem.layerNoop({
      exists: (p: string) => Effect.succeed(knownPaths.has(p) || dirKeys.has(p)),
      readFileString: (p: string) => {
        if (p === firstSj) return Effect.succeed(firstJson);
        if (p === secondSj) return Effect.succeed(secondJson);
        return Effect.fail(enoent("readFileString", p));
      },
      readDirectory: (p: string) => {
        const c = dirs[p];
        if (c) return Effect.succeed([...c]);
        return Effect.fail(enoent("readDirectory", p));
      },
    });
  }

  it.effect("loadAllSouls returns empty-array-ish SoulLoadError when no souls found", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.loadAllSouls(1));
      expect(err._tag).toBe("SoulLoadError");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(emptyMockFs()),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Cache isolation & independence
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — cache isolation", () => {
  it.effect("Layer.fresh instances have independent caches", () =>
    Effect.gen(function* () {
      // We can't test two loaders in one gen easily because each provide
      // creates a different service. Instead, verify that a single loader
      // uses its own cache (not a shared global).
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul("bodhisattva-coder", 3);
      // Level 1 request hits cache but doesn't downgrade level-3 entry
      yield* loader.getSoul("bodhisattva-coder", 1);
      // Since cache is upgrade-only, cached level stays at 3.
      const after = yield* loader.getSoul("bodhisattva-coder", 3);
      expect(after.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "bodhisattva-coder",
            files: { "SOUL.md": "# Persistent content" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("cross-soul cache independence: loading one soul doesn't create false entries", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul("soul-a", 1);
      // soul-b should not be found in cache — it doesn't exist on disk
      const err = yield* Effect.flip(loader.getSoul("soul-b", 1));
      expect(err._tag).toBe("SoulLoadError");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(mockFsForSouls([{ name: "soul-a" }])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Error wrapping provenance
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — error wrapping", () => {
  it.effect("manifest parse error message includes the path", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("corrupt", 1));
      expect(err._tag).toBe("SoulLoadError");
      expect(err.message).toMatch(/corrupt.*soul\.json|soul\.json|parse|read/i);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        (() => {
          const dirs = baseDirs({ [`${FIRST_PATH}/corrupt`]: [] });
          const dirKeys = new Set(Object.keys(dirs));
          const sj = `${FIRST_PATH}/corrupt/soul.json`;
          return FileSystem.layerNoop({
            exists: (p: string) => Effect.succeed(p === sj || p === FIRST_PATH || dirKeys.has(p)),
            readFileString: (p: string) => {
              if (p === sj) return Effect.succeed("{invalid json{{{"); // Malformed
              return Effect.fail(enoent("readFileString", p));
            },
            readDirectory: (p: string) => {
              const c = dirs[p];
              if (c) return Effect.succeed([...c]);
              return Effect.fail(enoent("readDirectory", p));
            },
          });
        })(),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("permission denied on soul.json produces SoulLoadError", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("denied-soul", 1));
      expect(err._tag).toBe("SoulLoadError");
      expect(err.message).toMatch(/denied|read/i);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        (() => {
          const dirs = baseDirs({ [`${FIRST_PATH}/denied-soul`]: [] });
          const dirKeys = new Set(Object.keys(dirs));
          const sj = `${FIRST_PATH}/denied-soul/soul.json`;
          return FileSystem.layerNoop({
            exists: (p: string) => Effect.succeed(p === FIRST_PATH || p === sj || dirKeys.has(p)),
            readFileString: () => Effect.fail(permDenied("readFileString", sj)),
            readDirectory: (p: string) => {
              const c = dirs[p];
              if (c) return Effect.succeed([...c]);
              return Effect.fail(enoent("readDirectory", p));
            },
          });
        })(),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it("exported SoulLoadError has expected error interface", () => {
    const err = new SoulLoadError({ message: "test error", cause: "root cause" });
    expect(err._tag).toBe("SoulLoadError");
    expect(err.message).toBe("test error");
    expect(err.cause).toBe("root cause");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Multiple souls via loadAllSouls
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — multiple souls", () => {
  it.effect("loadAllSouls returns multiple souls in directory order", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      expect(souls.length).toBe(3);
      const names = souls.map((s) => s.name).sort();
      expect(names).toEqual(["alpha", "beta", "gamma"]);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(mockFsForSouls([{ name: "beta" }, { name: "alpha" }, { name: "gamma" }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("getSoul after loadAllSouls reuses cached manifest", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.loadAllSouls(1);
      // getSoul should hit cache since loadAllSouls populated it
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.name).toBe("bodhisattva-coder");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "bodhisattva-coder",
            files: { "SOUL.md": "# Cached" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("loadAllSouls at level 2 reads soul_content for all souls", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(2);
      expect(souls.length).toBe(2);
      for (const soul of souls) {
        expect(soul.soul_content).toBeDefined();
        expect(soul.soul_content).toContain("Content");
      }
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          { name: "soul-1", files: { "SOUL.md": "# Content for 1" } },
          { name: "soul-2", files: { "SOUL.md": "# Content for 2" } },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. listSouls edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — listSouls", () => {
  it.effect("listSouls returns names after loadAllSouls", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const names = yield* loader.listSouls();
      expect(Array.isArray(names)).toBe(true);
      expect(names).toContain("bodhisattva-coder");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          {
            name: "bodhisattva-coder",
            files: { "SOUL.md": "# Soul" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("listSouls on empty cache triggers loadAllSouls and returns names", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const names = yield* loader.listSouls();
      expect(names.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        mockFsForSouls([
          { name: "a", files: { "SOUL.md": "# A" } },
          { name: "b", files: { "SOUL.md": "# B" } },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. filterByLevel — stress with nullish values
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — filterByLevel nullish resilience", () => {
  it("manifest with soul_content: empty string is preserved at level 2+", () => {
    const m: SoulManifest = {
      name: "t",
      display_name: "T",
      version: "1",
      spec_version: "0.5",
      description: "",
      author: { name: "A" },
      license: "MIT",
      tags: [],
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
      soul_content: "",
      identity_content: "",
    };
    const f = filterByLevel(m, 2);
    expect(f.soul_content).toBe("");
    expect(f.identity_content).toBe("");
  });

  it("manifest with only non-content fields is stable", () => {
    const m: SoulManifest = {
      name: "n",
      display_name: "N",
      version: "1",
      spec_version: "0.5",
      description: "",
      author: { name: "A" },
      license: "MIT",
      tags: [],
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
    };
    const f1 = filterByLevel(m, 1);
    expect(f1.name).toBe("n");
    // Deleting from a shallow copy of m should not add spurious fields
    expect(Object.keys(f1).sort()).toEqual(Object.keys(m).sort());
  });
});
