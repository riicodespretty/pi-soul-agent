import { describe, it, expect, afterEach } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import os from "node:os";
import { resolveOsHomeDir, expandHome, parseManifest } from "../../src/services/soul-fs";
import { ManifestParseError } from "../../src/errors";
import { DEFAULT_SOURCE } from "../helpers";

describe("resolveOsHomeDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns HOME when set", () => {
    vi.stubEnv("HOME", "/home/testuser");
    expect(resolveOsHomeDir(process.env)).toBe("/home/testuser");
  });

  it("returns USERPROFILE when HOME is not set", () => {
    vi.stubEnv("HOME", undefined);
    vi.stubEnv("USERPROFILE", "/Users/testuser");
    expect(resolveOsHomeDir(process.env)).toBe("/Users/testuser");
  });

  it("prefers HOME over USERPROFILE when both are set", () => {
    vi.stubEnv("HOME", "/home/testuser");
    vi.stubEnv("USERPROFILE", "/Users/testuser");
    expect(resolveOsHomeDir(process.env)).toBe("/home/testuser");
  });

  it("falls back to os.homedir() when neither HOME nor USERPROFILE is set", () => {
    vi.stubEnv("HOME", undefined);
    vi.stubEnv("USERPROFILE", undefined);
    expect(resolveOsHomeDir(process.env)).toBe(os.homedir());
  });

  it("handles empty HOME gracefully", () => {
    vi.stubEnv("HOME", "");
    expect(resolveOsHomeDir(process.env)).toBe("");
  });
});

describe("expandHome", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.effect("returns the path unchanged when it does not start with ~/", () =>
    Effect.gen(function* () {
      const result = yield* expandHome("/foo/bar").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("/foo/bar");
    }),
  );

  it.effect("returns the path unchanged when it is exactly ~ (no slash)", () =>
    Effect.gen(function* () {
      const result = yield* expandHome("~").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("~");
    }),
  );

  it.effect("expands ~/ to the home directory joined with the suffix", () => {
    vi.stubEnv("HOME", "/home/testuser");
    return Effect.gen(function* () {
      const result = yield* expandHome("~/projects").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("/home/testuser/projects");
    });
  });

  it.effect("handles deep paths after ~/", () => {
    vi.stubEnv("HOME", "/Users/me");
    return Effect.gen(function* () {
      const result = yield* expandHome("~/a/b/c/d").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("/Users/me/a/b/c/d");
    });
  });

  it.effect("leaves paths that start with ~something (no slash) unchanged", () =>
    Effect.gen(function* () {
      const result = yield* expandHome("~other/path").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("~other/path");
    }),
  );
});

describe("parseManifest — Schema validation at the JSON boundary", () => {
  it("rejects a non-object (null) with ManifestParseError instead of crashing", () => {
    expect(() => parseManifest(null)).toThrow(ManifestParseError);
  });

  it("rejects a primitive (number) with ManifestParseError", () => {
    expect(() => parseManifest(42)).toThrow(ManifestParseError);
  });

  it("rejects a wrong-shape object (name is a number) with ManifestParseError", () => {
    expect(() => parseManifest({ ...DEFAULT_SOURCE, name: 123 })).toThrow(ManifestParseError);
  });

  it("accepts a well-formed manifest object", () => {
    const manifest = parseManifest(DEFAULT_SOURCE);
    expect(manifest.name).toBe(DEFAULT_SOURCE.name);
  });
});
