import { describe, it, expect, afterEach } from "@effect/vitest";
import { Effect } from "effect";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import os from "node:os";
import { resolveOsHomeDir, expandHome } from "@/src/services/soul-fs";

// ---------------------------------------------------------------------------
// resolveOsHomeDir — pure function, no Effect context needed
// ---------------------------------------------------------------------------

describe("resolveOsHomeDir", () => {
  const ORIGINAL_HOME = process.env.HOME;
  const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  });

  it("returns HOME when set", () => {
    process.env.HOME = "/home/testuser";
    expect(resolveOsHomeDir(process.env)).toBe("/home/testuser");
  });

  it("returns USERPROFILE when HOME is not set", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = "/Users/testuser";
    expect(resolveOsHomeDir(process.env)).toBe("/Users/testuser");
  });

  it("prefers HOME over USERPROFILE when both are set", () => {
    process.env.HOME = "/home/testuser";
    process.env.USERPROFILE = "/Users/testuser";
    expect(resolveOsHomeDir(process.env)).toBe("/home/testuser");
  });

  it("falls back to os.homedir() when neither HOME nor USERPROFILE is set", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(resolveOsHomeDir(process.env)).toBe(os.homedir());
  });

  it("handles empty HOME gracefully", () => {
    process.env.HOME = "";
    // Empty string is not null, so it's returned as-is
    expect(resolveOsHomeDir(process.env)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// expandHome — Effect that uses Path service
// ---------------------------------------------------------------------------

describe("expandHome", () => {
  const ORIGINAL_HOME = process.env.HOME;

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
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
    process.env.HOME = "/home/testuser";
    return Effect.gen(function* () {
      const result = yield* expandHome("~/projects").pipe(Effect.provide(NodePathLayer));
      expect(result).toBe("/home/testuser/projects");
    });
  });

  it.effect("handles deep paths after ~/", () => {
    process.env.HOME = "/Users/me";
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
