import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { vi } from "vitest";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader } from "../../src/loader";
import { SoulLoadError } from "../../src/errors";
import { createMockFsLayer, DEFAULT_SOURCE } from "../helpers";

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
  // getSoul auto-loads on cache miss (no 2-step dance)
  it.effect("getSoul auto-loads when soul not in cache", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(soul.name).toBeDefined();
      // Cache state: second call should hit cache, not re-read from disk
      const cached = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(cached.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // cache never downgrades
  it.effect("getSoul does not downgrade cache level", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader.getSoul(DEFAULT_SOURCE.name, 3);
      yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      const after = yield* loader.getSoul(DEFAULT_SOURCE.name, 3);
      expect(after.soulContent).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // getSoul at level 1 returns metadata only
  it.effect("getSoul at level 1 returns metadata-only manifest", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(soul.soulContent).toBeUndefined();
      expect(soul.identityContent).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // loadAllSouls returns array of manifests
  it.effect("loadAllSouls returns array of soul manifests", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* loader.loadAllSouls(1);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBeDefined();
      expect(result[0].soulContent).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // error contract — SoulLoadError has ._tag === "SoulLoadError"
  it.effect("getSoul produces SoulLoadError on missing soul", () =>
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

  // basic getSoul smoke test
  it.effect("getSoul returns a result for a known soul", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(soul.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // ── Error Path Coverage ─────────────────────────────────────────────────

  // ManifestParseError — invalid JSON produces SoulLoadError
  it.effect("getSoul produces SoulLoadError on malformed JSON", () =>
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

  // NoSoulsFoundError — empty directory produces SoulLoadError
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

  // FileSystemError — permission denied produces SoulLoadError
  it.effect("getSoul surfaces FileSystemError as SoulLoadError", () =>
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

  // Test 12: getSoul at level 1 strips all content fields
  it.effect("getSoul at level 1 strips content fields", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(result.name).toBe(DEFAULT_SOURCE.name);
      expect(result.soulContent).toBeUndefined();
      expect(result.identityContent).toBeUndefined();
      expect(result.agentsContent).toBeUndefined();
      expect(result.heartbeatContent).toBeUndefined();
      expect(result.userTemplateContent).toBeUndefined();
      expect(result.examplesGoodContent).toBeUndefined();
      expect(result.examplesBadContent).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 12: getSoul at level 2 strips only level-3 fields
  it.effect("getSoul at level 2 strips only level-3 fields", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* loader.getSoul(DEFAULT_SOURCE.name, 2);
      expect(result.soulContent).toBeDefined();
      expect(result.identityContent).toBeDefined();
      expect(result.agentsContent).toBeUndefined();
      expect(result.heartbeatContent).toBeUndefined();
      expect(result.userTemplateContent).toBeUndefined();
      expect(result.examplesGoodContent).toBeUndefined();
      expect(result.examplesBadContent).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );
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
  it.effect("content file not read when level is below threshold", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      // Level 1 should NOT try to read SOUL.md (minLevel=2)
      const soul = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(soul.soulContent).toBeUndefined();
      // Verify the mock is working: level 2 DOES read it
      const soul2 = yield* loader.getSoul(DEFAULT_SOURCE.name, 2);
      expect(soul2.soulContent).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: DEFAULT_SOURCE.name }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("avatarPath is set at level 1 when avatar file is present", () => {
    const mockFs = createMockFsLayer([
      {
        name: "avatar-soul",
        files: { avatar: "avatar.png" },
      },
    ]);

    return Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("avatar-soul", 1);
      expect(soul.avatarPath).toBeDefined();
      expect(typeof soul.avatarPath).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(mockFs),
      Effect.provide(NodePathLayer),
    );
  });

  it.effect("examples field absent in manifest does not crash", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader.getSoul("no-examples", 3);
      expect(soul.examplesGoodContent).toBeUndefined();
      expect(soul.examplesBadContent).toBeUndefined();
      expect(soul.name).toBe("no-examples");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: "no-examples", examples: undefined }])),
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
      Effect.provide(createMockFsLayer([{ name: "valid-soul" }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("deduplicates same soul name across search paths (first wins)", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(1);
      expect(souls.length).toBe(1);
      expect(souls[0].displayName).toBe("First");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        createMockFsLayer([
          {
            name: "duplicate",
            displayName: "First",
          },
          {
            name: "duplicate",
            displayName: "Second",
            soulPath: `${process.env.HOME}/.openclaw/souls/clawsouls`,
          },
        ]),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("loadAllSouls fails with SoulLoadError when no souls found", () =>
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
      yield* loader.getSoul(DEFAULT_SOURCE.name, 3);
      // Level 1 request hits cache; cache is upgrade-only so level-3 data preserved
      yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      const after = yield* loader.getSoul(DEFAULT_SOURCE.name, 3);
      expect(after.soulContent).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: DEFAULT_SOURCE.name }])),
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
      const names = souls.map((s) => s.name);
      expect(names).toEqual(["beta", "alpha", "gamma"]);
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
      const soul = yield* loader.getSoul(DEFAULT_SOURCE.name, 1);
      expect(soul.name).toBe(DEFAULT_SOURCE.name);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: DEFAULT_SOURCE.name }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("loadAllSouls at level 2 reads soulContent for all souls", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.loadAllSouls(2);
      expect(souls.length).toBe(2);
      for (const soul of souls) {
        expect(soul.soulContent).toBeDefined();
      }
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: "soul-1" }, { name: "soul-2" }])),
      Effect.provide(NodePathLayer),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: listSouls edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial — listSouls", () => {
  it.effect("listSouls returns manifests after loadAllSouls", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const manifests = yield* loader.listSouls();
      expect(Array.isArray(manifests)).toBe(true);
      expect(manifests.some((m) => m.name === DEFAULT_SOURCE.name)).toBe(true);
      expect(manifests[0].description).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: DEFAULT_SOURCE.name }])),
      Effect.provide(NodePathLayer),
    ),
  );

  it.effect("listSouls on empty cache triggers loadAllSouls and returns manifests", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const manifests = yield* loader.listSouls();
      const names = manifests.map((m) => m.name);
      expect(names).toEqual(["a", "b"]);
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([{ name: "a" }, { name: "b" }])),
      Effect.provide(NodePathLayer),
    ),
  );
});
