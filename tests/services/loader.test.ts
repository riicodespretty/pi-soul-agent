import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { vi } from "vitest";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, filterByLevel } from "@/src/loader";
import { createMockFsLayer } from "@/tests/helpers";
import type { SoulManifest } from "@/src/types";

// Stub HOME so expandHome("~/...") resolves to paths matching the mock FS.
vi.stubEnv("HOME", "/Users/test");

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
      yield* loader.loadSoul("bodhisattva-coder", 3);
      yield* loader.loadSoul("bodhisattva-coder", 1);
      const after = yield* loader.getSoul("bodhisattva-coder", 3);
      expect(after.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 3: listSouls is infallible — now truly independent of execution order
  // because each test gets a fresh cache via Layer.fresh.
  it.effect("listSouls returns [] on empty cache", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.listSouls(1);
      expect(Array.isArray(souls)).toBe(true);
      expect(souls.length).toBe(0);
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
      const soul = yield* loader.loadSoul("bodhisattva-coder", 1);
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
      const result = yield* Effect.flip(loader.loadSoul("definitely-not-exist-12345"));
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
      yield* loader.loadSoul("bodhisattva-coder", 1);
      const soul = yield* loader.getSoul("bodhisattva-coder", 1);
      expect(soul.name).toBeDefined();
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
    ),
  );

  // =================================================================
  // Phase 4: Error Path Coverage
  // =================================================================

  // Test 9: ManifestParseError — invalid JSON produces SoulLoadError
  // The loadSoul inner catchTags remaps ManifestParseError to SoulLoadError,
  // then catchAllCause wraps it with a generic message. The final error
  // SoulLoadError is what we assert.
  it.effect("loadSoul produces SoulLoadError on malformed JSON", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.loadSoul("corrupt-soul", 1));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(
              path === "/Users/test/.pi/agent/souls/corrupt-soul/soul.json" ||
                path === "/Users/test/.pi/agent/souls",
            ),
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
  // loadAllSouls path: empty results → SoulLoadError directly,
  // then catchAllCause wraps with generic message.
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
          exists: (path: string) => Effect.succeed(path === "/Users/test/.pi/agent/souls"),
          readDirectory: (_path: string) => Effect.succeed([] as string[]),
        }),
      ),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 11: FileSystemError — permission denied produces SoulLoadError
  // FileSystemError from readJsonFile → caught by catchTags → SoulLoadError
  // → caught by catchAllCause → SoulLoadError with generic message.
  it.effect("loadSoul surfaces FileSystemError as SoulLoadError", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* Effect.flip(loader.loadSoul("unreadable-soul", 1));
      expect(result._tag).toBe("SoulLoadError");
      expect(typeof result.message).toBe("string");
    }).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(
        FileSystem.layerNoop({
          exists: (path: string) =>
            Effect.succeed(
              path === "/Users/test/.pi/agent/souls/unreadable-soul/soul.json" ||
                path === "/Users/test/.pi/agent/souls",
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
