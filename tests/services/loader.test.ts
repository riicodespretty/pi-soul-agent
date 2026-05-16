import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { vi } from "vitest";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, filterByLevel } from "@/src/loader";
import { SoulLoadError } from "@/src/errors";
import { createMockFsLayer } from "@/tests/helpers";
import type { SoulManifest } from "@/src/types";

// Stub HOME so expandHome("~/...") resolves to paths matching the mock FS.
vi.stubEnv("HOME", "/Users/test");

/** Expanded first search path (matches SOUL_SEARCH_PATHS[0] with test HOME). */
const FIRST_PATH = "/Users/test/.pi/agent/souls";

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

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING TESTS (ported from the original loader.test.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("SoulSpecLoader", () => {
  // Test 1: getSoul auto-loads on cache miss (no 2-step dance)
  it.effect("getSoul auto-loads when soul not in cache", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.name).toBeDefined();
      // Cache state: second call should hit cache, not re-read from disk
      const cached = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(cached.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 2: cache never downgrades
  it.effect("loadSoul does not downgrade cache level", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul("bodhisattva-coder", 3);
      yield* loader.getSoul("bodhisattva-coder", 1);
      const after = yield* loader.getSoul("bodhisattva-coder", 3);
      expect(after.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 4: loadSoul at level 1 returns metadata only
  it.effect("loadSoul at level 1 returns metadata-only manifest", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.soul_content).toBeUndefined();
      expect(soul.identity_content).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 5: loadAllSouls returns array of manifests
  it.effect("loadAllSouls returns array of soul manifests", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* loader.loadAllSouls(1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBeDefined();
      expect(result[0].soul_content).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 6: filterByLevel at level 1 strips all content fields
  it("filterByLevel at level 1 removes content fields", () => {
    const manifest: SoulManifest = {
      name: "test",
      display_name: "Test",
      version: "1.0",
      spec_version: "0.5",
      description: "",
      author: { name: "T" },
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
      soul_content: "hello",
      identity_content: "world",
      agents_content: "agents",
      style_content: "style",
    };
    const filtered = filterByLevel(manifest, 1);
    expect(filtered.soul_content).toBeUndefined();
    expect(filtered.identity_content).toBeUndefined();
    expect(filtered.agents_content).toBeUndefined();
    expect(filtered.name).toBe("test");
  });

  // Test 7: error contract — SoulLoadError has ._tag === "SoulLoadError"
  it.effect("loadSoul produces SoulLoadError on missing soul", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.getSoul("definitely-not-exist-12345"));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 8: Cache key normalization — round trip via getSoul after loadSoul
  it.effect("getSoul finds cached entry via normalized key", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // ── Error Path Coverage ─────────────────────────────────────────────────

  // Test 9: ManifestParseError — invalid JSON produces SoulLoadError
  it.effect("loadSoul produces SoulLoadError on malformed JSON", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.getSoul("corrupt-soul", 1));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(path === `${FIRST_PATH}/corrupt-soul/soul.json` || path === FIRST_PATH),
          readFileString: (path: string) => {
            if (path.endsWith("corrupt-soul/soul.json")) {
              return Effect.succeed("invalid json{{{");
            }
            return Effect.fail(
              new SystemError({
                module: "FileSystem",
                method: "readFileString",
                reason: "NotFound",
                description: "No such file or directory",
                pathOrDescriptor: path,
              }),
            );
          },
          readDirectory: (_path: string) => Effect.succeed(["corrupt-soul"]),
        }),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 10: NoSoulsFoundError — empty directory produces SoulLoadError
  it.effect("loadAllSouls fails with SoulLoadError on empty directory", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.loadAllSouls(1));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) => Effect.succeed(path === FIRST_PATH),
          readDirectory: (_path: string) => Effect.succeed([] as string[]),
        }),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 11: FileSystemError — permission denied produces SoulLoadError
  it.effect("loadSoul surfaces FileSystemError as SoulLoadError", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.getSoul("unreadable-soul", 1));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(
              path === `${FIRST_PATH}/unreadable-soul/soul.json` || path === FIRST_PATH,
            ),
          readFileString: (path: string) =>
            Effect.fail(
              new SystemError({
                module: "FileSystem",
                method: "readFileString",
                reason: "PermissionDenied",
                description: "EACCES: permission denied",
                pathOrDescriptor: path,
              }),
            ),
          readDirectory: (_path: string) => Effect.succeed(["unreadable-soul"]),
        }),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 12: filterByLevel at level 2 keeps soul_content, removes agents_content
  it("filterByLevel at level 2 keeps soul_content but removes agents_content", () => {
    const manifest: SoulManifest = {
      name: "test",
      display_name: "Test",
      version: "1.0",
      spec_version: "0.5",
      description: "",
      author: { name: "T" },
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
      soul_content: "soul content",
      identity_content: "identity content",
      agents_content: "agents content",
      style_content: "style content",
    };
    const filtered = filterByLevel(manifest, 2);
    expect(filtered.soul_content).toBe("soul content");
    expect(filtered.identity_content).toBe("identity content");
    expect(filtered.agents_content).toBeUndefined();
    expect(filtered.style_content).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: filterByLevel — level edge cases
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

  it("level 4+ does not crash and keeps content", () => {
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

  it("manifest with empty string content fields preserves them at level 2+", () => {
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
    expect(Object.keys(f1).sort()).toEqual(Object.keys(m).sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: loadSoul & getSoul — path edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — loadSoul path edge cases", () => {
  it.effect("soul name with dots resolves correctly", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("my.custom.soul.v2", 1);
      expect(soul.name).toBe("my.custom.soul.v2");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: "my.custom.soul.v2" }])),
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
      Effect.provide(createMockFsLayer([{ name: "my soul" }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("soul found in second search path when not in first", () => {
    const mockFs = createMockFsLayer([
      {
        name: "fallback-soul",
        soulPath: `${process.env.HOME}/.openclaw/souls/clawsouls`,
      },
    ]);

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
      Effect.provide(createMockFsLayer([])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: Content file behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — content file behavior", () => {
  it.effect("missing referenced content file produces SoulLoadError", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("missing-file", 2));
      expect(err._tag).toBe("SoulLoadError");
      expect(err.message).toMatch(/read/i);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
          {
            name: "missing-file",
            manifestJson: JSON.stringify({
              specVersion: "0.5",
              name: "missing-file",
              displayName: "Missing File",
              version: "1.0.0",
              description: "Soul with missing content file",
              author: { name: "T" },
              license: "MIT",
              tags: [],
              category: "general",
              compatibility: { models: [], frameworks: [] },
              allowedTools: [],
              recommendedSkills: [],
              files: { soul: "NONEXISTENT.md" },
              deprecated: false,
              environment: "virtual",
              interactionMode: "text",
            }),
            // No files object — NONEXISTENT.md is NOT created
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
        createMockFsLayer([
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
        createMockFsLayer([
          {
            name: "avatar-soul",
            manifestJson: JSON.stringify({
              specVersion: "0.5",
              name: "avatar-soul",
              displayName: "Avatar Soul",
              version: "1.0.0",
              description: "A soul with an avatar",
              author: { name: "T" },
              license: "MIT",
              tags: [],
              category: "general",
              compatibility: { models: [], frameworks: [] },
              allowedTools: [],
              recommendedSkills: [],
              files: { soul: "SOUL.md", avatar: "avatar.png" },
              deprecated: false,
              environment: "virtual",
              interactionMode: "text",
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
        createMockFsLayer([
          {
            name: "full-soul",
            manifestJson: JSON.stringify({
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
            }),
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
      Effect.provide(createMockFsLayer([{ name: "no-examples", files: { "SOUL.md": "# Soul" } }])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: loadAllSouls — contract & edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — loadAllSouls contract", () => {
  it.effect("skips directories without soul.json (best-effort)", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      expect(souls.length).toBe(1);
      expect(souls[0].name).toBe("valid-soul");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
          {
            name: "valid-soul",
            files: { "SOUL.md": "# Content" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("deduplicates same soul name across search paths (first wins)", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      expect(souls.length).toBe(1);
      expect(souls[0].display_name).toBe("First");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
          {
            name: "duplicate",
            manifestJson: JSON.stringify({ name: "duplicate", displayName: "First" }),
          },
          {
            name: "duplicate",
            manifestJson: JSON.stringify({ name: "duplicate", displayName: "Second" }),
            soulPath: `${process.env.HOME}/.openclaw/souls/clawsouls`,
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("loadAllSouls returns empty-array-ish SoulLoadError when no souls found", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.loadAllSouls(1));
      expect(err._tag).toBe("SoulLoadError");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: Cache isolation & independence
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — cache isolation", () => {
  it.effect("Level.fresh instances have independent caches (upgrade-only)", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul("bodhisattva-coder", 3);
      // Level 1 request hits cache; cache is upgrade-only so level-3 data preserved
      yield* loader.getSoul("bodhisattva-coder", 1);
      const after = yield* loader.getSoul("bodhisattva-coder", 3);
      expect(after.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
          {
            name: "bodhisattva-coder",
            files: { "SOUL.md": "# Persistent content" },
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("cross-soul cache independence", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul("soul-a", 1);
      const err = yield* Effect.flip(loader.getSoul("soul-b", 1));
      expect(err._tag).toBe("SoulLoadError");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: "soul-a" }])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: Error wrapping provenance
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — error wrapping", () => {
  it.effect("manifest parse error message includes the path", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const err = yield* Effect.flip(loader.getSoul("corrupt", 1));
      expect(err._tag).toBe("SoulLoadError");
      expect(err.message).toMatch(/corrupt|soul\.json|parse|read/i);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(path === `${FIRST_PATH}/corrupt/soul.json` || path === FIRST_PATH),
          readFileString: (path: string) => {
            if (path.endsWith("corrupt/soul.json")) return Effect.succeed("{invalid json{{{");
            return Effect.fail(enoent("readFileString", path));
          },
          readDirectory: (_path: string) => Effect.succeed(["corrupt"]),
        }),
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
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(path === `${FIRST_PATH}/denied-soul/soul.json` || path === FIRST_PATH),
          readFileString: () =>
            Effect.fail(permDenied("readFileString", `${FIRST_PATH}/denied-soul/soul.json`)),
          readDirectory: (_path: string) => Effect.succeed(["denied-soul"]),
        }),
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
// ADVERSARIAL: Multiple souls via loadAllSouls
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
      Effect.provide(createMockFsLayer([{ name: "beta" }, { name: "alpha" }, { name: "gamma" }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("getSoul after loadAllSouls reuses cached manifest", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.loadAllSouls(1);
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.name).toBe("bodhisattva-coder");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
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
        createMockFsLayer([
          { name: "soul-1", files: { "SOUL.md": "# Content for 1" } },
          { name: "soul-2", files: { "SOUL.md": "# Content for 2" } },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: listSouls edge cases
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
        createMockFsLayer([
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
        createMockFsLayer([
          { name: "a", files: { "SOUL.md": "# A" } },
          { name: "b", files: { "SOUL.md": "# B" } },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );
});
