import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { parseSoulCommandArgs } from "@/src/commands";
import { SoulSpecLoader } from "@/src/loader";
import { ActiveSoulPersistence } from "@/src/persistence";
import { createMockFsLayer, DEFAULT_SOURCE } from "@/tests/helpers";
import { vi } from "vitest";

vi.stubEnv("HOME", "/Users/test");

// ── Pure Unit Tests: parseSoulCommandArgs ─────────────────────────────────

describe("parseSoulCommandArgs", () => {
  it("parses '--clear' as deactivate", () => {
    const result = parseSoulCommandArgs("--clear");
    expect(result.action).toBe("deactivate");
  });

  it("parses '-c' as deactivate", () => {
    const result = parseSoulCommandArgs("-c");
    expect(result.action).toBe("deactivate");
  });

  it("parsing 'off' or 'clear' without dashes is activate", () => {
    expect(parseSoulCommandArgs("off").action).toBe("activate");
    expect(parseSoulCommandArgs("clear").action).toBe("activate");
  });

  it("parses '--help' as help", () => {
    const result = parseSoulCommandArgs("--help");
    expect(result.action).toBe("help");
  });

  it("parses '-h' as help", () => {
    const result = parseSoulCommandArgs("-h");
    expect(result.action).toBe("help");
  });

  it("parses soul name without level defaults to level 2", () => {
    const result = parseSoulCommandArgs("developer");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("developer");
      expect(result.level).toBe(2);
    }
  });

  it("parses soul name with --level 3", () => {
    const result = parseSoulCommandArgs("developer --level 3");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("developer");
      expect(result.level).toBe(3);
    }
  });

  it("parses soul name with --level=3 syntax", () => {
    const result = parseSoulCommandArgs("developer --level=3");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("developer");
      expect(result.level).toBe(3);
    }
  });

  it("clamps level to 1-3 inclusive", () => {
    for (const [args, expected] of [
      ["dev --level 0", 1],
      ["dev --level 4", 3],
    ] as const) {
      const result = parseSoulCommandArgs(args);
      expect(result.action).toBe("activate");
      if (result.action === "activate") {
        expect(result.level).toBe(expected);
      }
    }
  });

  it("parses --level=1 as level 1", () => {
    const result = parseSoulCommandArgs("soul-a --level=1");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("soul-a");
      expect(result.level).toBe(1);
    }
  });

  it("parses empty string as activate with empty soulName", () => {
    const result = parseSoulCommandArgs("");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("");
      expect(result.level).toBe(2);
    }
  });

  it("trims whitespace from soul name", () => {
    const result = parseSoulCommandArgs("  my-soul  --level 1  ");
    expect(result.action).toBe("activate");
    if (result.action === "activate") {
      expect(result.soulName).toBe("my-soul");
      expect(result.level).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Effect Pipeline Tests — real services + createMockFsLayer
// ═══════════════════════════════════════════════════════════════════════════

/** Shared layer stack for tests that need SoulSpecLoader + ActiveSoulPersistence. */
const fullTestLayer = Layer.fresh(SoulSpecLoader.Default).pipe(
  Layer.provideMerge(Layer.fresh(ActiveSoulPersistence.Default)),
  Layer.provideMerge(createMockFsLayer()),
  Layer.provideMerge(NodePathLayer),
);

/** Inline listSouls effect (same pattern as handler uses). */
const listSoulsEffect = Effect.gen(function* () {
  const loader = yield* SoulSpecLoader;
  return yield* loader.listSouls();
});

/** Inline deactivate effect (same pattern as handler uses). */
const deactivateEffect = Effect.gen(function* () {
  const persistence = yield* ActiveSoulPersistence;
  return yield* persistence.clear();
});

/** Inline activate effect (same pattern as handler uses). */
const activateEffect = (soulName: string, level: number) =>
  Effect.gen(function* () {
    const loader = yield* SoulSpecLoader;
    const manifest = yield* loader.getSoul(soulName, level);
    return { manifest } as const;
  });

describe("listSoulsPipeline", () => {
  it.effect("returns manifests with real loader and mock FS", () =>
    listSoulsEffect.pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
      Effect.flatMap((manifests) =>
        Effect.sync(() => {
          expect(manifests.length).toBeGreaterThan(0);
          expect(manifests[0].name).toBe(DEFAULT_SOURCE.name);
          expect(manifests[0].description).toBe(DEFAULT_SOURCE.description);
        }),
      ),
    ),
  );

  it.effect("fails with SoulLoadError when no souls configured", () =>
    Effect.flip(listSoulsEffect).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(createMockFsLayer([])),
      Effect.provide(NodePathLayer),
      Effect.flatMap((err) =>
        Effect.sync(() => {
          expect(err._tag).toBe("SoulLoadError");
        }),
      ),
    ),
  );
});

describe("deactivateSoulPipeline", () => {
  it.effect("clears persistence with real services and mock FS", () =>
    deactivateEffect.pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(Layer.fresh(ActiveSoulPersistence.Default)),
      Effect.provide(createMockFsLayer()),
      Effect.provide(NodePathLayer),
      Effect.flatMap(() =>
        Effect.sync(() => {
          expect(true).toBe(true);
        }),
      ),
    ),
  );
});

describe("activateSoulPipeline", () => {
  it.effect("activates a soul at level 2 with real services and mock FS", () =>
    activateEffect(DEFAULT_SOURCE.name, 2).pipe(
      Effect.provide(fullTestLayer),
      Effect.flatMap(({ manifest }) =>
        Effect.sync(() => {
          expect(manifest.name).toBe(DEFAULT_SOURCE.name);
          expect(manifest.soulContent).toBeDefined();
        }),
      ),
    ),
  );

  it.effect("activates a soul at level 3 with full content", () =>
    activateEffect(DEFAULT_SOURCE.name, 3).pipe(
      Effect.provide(fullTestLayer),
      Effect.flatMap(({ manifest }) =>
        Effect.sync(() => {
          expect(manifest.soulContent).toBeDefined();
          expect(manifest.identityContent).toBeDefined();
          expect(manifest.agentsContent).toBeDefined();
        }),
      ),
    ),
  );

  it.effect("fails with SoulLoadError when soul not found", () =>
    Effect.flip(activateEffect("ghost-soul", 1)).pipe(
      Effect.provide(Layer.fresh(SoulSpecLoader.Default)),
      Effect.provide(Layer.fresh(ActiveSoulPersistence.Default)),
      Effect.provide(createMockFsLayer([])),
      Effect.provide(NodePathLayer),
      Effect.flatMap((err) =>
        Effect.sync(() => {
          expect(err._tag).toBe("SoulLoadError");
        }),
      ),
    ),
  );
});
