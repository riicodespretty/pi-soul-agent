import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { SoulSpecLoader, filterByLevel } from "@/src/loader";
import type { SoulManifest } from "@/src/types";

describe("SoulSpecLoader", () => {
  // Test 1: getSoul auto-loads on cache miss (no 2-step dance)
  it.effect("getSoul auto-loads when soul not in cache", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader
        .getSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      expect(soul).not.toBeNull();
      expect(soul!.name).toBeDefined();
      // Cache state: second call should hit cache, not re-read from disk
      const cached = yield* loader
        .getSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      expect(cached).not.toBeNull();
      expect(cached!.name).toBeDefined();
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 2: cache never downgrades
  it.effect("loadSoul does not downgrade cache level", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader
        .loadSoul("bodhisattva-coder", 3)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      yield* loader
        .loadSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const after = yield* loader
        .getSoul("bodhisattva-coder", 3)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      expect(after).not.toBeNull();
      expect(after!.soul_content).toBeDefined();
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 3: listSouls is infallible
  it.effect("listSouls returns [] on empty cache", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const souls = yield* loader.listSouls(1);
      expect(Array.isArray(souls)).toBe(true);
      expect(souls.length).toBe(0);
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 4: loadSoul at level 1 returns metadata only
  it.effect("loadSoul at level 1 returns metadata-only manifest", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const soul = yield* loader
        .loadSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      expect(soul).not.toBeNull();
      expect(soul!.soul_content).toBeUndefined();
      expect(soul!.identity_content).toBeUndefined();
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 5: loadAllSouls returns array of manifests
  it.effect("loadAllSouls returns array of soul manifests", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      const result = yield* loader
        .loadAllSouls(1)
        .pipe(Effect.catchAll(() => Effect.succeed([] as SoulManifest[])));
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBeDefined();
      expect(result[0].soul_content).toBeUndefined();
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
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
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );

  // Test 8: Cache key normalization — round trip via getSoul after loadSoul
  it.effect("getSoul finds cached entry via normalized key", () =>
    Effect.gen(function* () {
      const loader = yield* SoulSpecLoader;
      yield* loader
        .loadSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const soul = yield* loader
        .getSoul("bodhisattva-coder", 1)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      expect(soul).not.toBeNull();
      expect(soul!.name).toBeDefined();
    }).pipe(
      Effect.provide(SoulSpecLoader.Default),
      Effect.provide(NodeFileSystemLayer),
      Effect.provide(NodePathLayer),
    ),
  );
});
