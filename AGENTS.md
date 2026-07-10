<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->

# Project Guide (pi-soul-agent)

A Pi coding-agent extension: activates a "SoulSpec" persona and injects it into the agent system prompt. An Effect-TS learning port of `@vtstech/pi-soul` — match Effect idiom (services, layers, `Schema`, tagged errors, `ManagedRuntime`); it is a stated goal, not incidental.

## Design docs live in git notes, NOT the working tree

The #1 gotcha. `docs/` is git-ignored agent scratch; canonical design docs are git notes anchored to the ROOT commit.

```sh
ROOT=$(git rev-list --max-parents=0 HEAD | tail -1)
git notes --ref=docs show $ROOT              # manifest / index of all areas
git notes --ref=docs-domain show $ROOT       # CONTEXT.md glossary (Soul, Manifest, Level, Heartbeat, Mala, Environment…)
git notes --ref=docs-architecture show $ROOT # module map, handler bridge, error model, findings
```

Area refs: `docs` (manifest), `docs-domain`, `docs-architecture`, `docs-history-port`, `docs-history-loader`, `docs-history-testing`, `docs-reviews`.
First checkout, fetch them once: `git config --add remote.origin.fetch '+refs/notes/*:refs/notes/*' && git fetch origin '+refs/notes/*:refs/notes/*'`.

## Commands

- Test (works today): `node node_modules/vitest/vitest.mjs run` — also `npm test` / `vp test` (59 tests, 3 files).
- `vp check` = format + lint + typecheck. `build` script = `tsc && vp build`. `vp dev` = dev server.

## Architecture — module map

| File                                        | Role                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.pi/extensions/soul.ts`                    | Entry: builds `ManagedRuntime`, wires layers (Loader / Persistence / Logger over NodeFileSystem + NodePath), registers commands + handlers |
| `src/commands.ts`                           | Commands `soul`, `soul-list`, `soul-info` (registered without `/` prefix)                                                                  |
| `src/events.ts`                             | Handlers: `session_start`, `resources_discover`, `before_agent_start`, `turn_end` (heartbeat)                                              |
| `src/loader.ts`                             | `SoulSpecLoader` service — discover / parse / filter / cache (upgrade-only cache)                                                          |
| `src/persistence.ts`                        | `ActiveSoulPersistence` → `~/.pi/agent/.active-soul.json`                                                                                  |
| `src/system-prompt.ts`                      | pure `buildSystemPrompt(manifest, level = 2)`                                                                                              |
| `src/types.ts`                              | Effect `Schema` — SOURCE OF TRUTH for every soul.json shape                                                                                |
| `src/errors.ts`                             | 5 tagged errors; only `SoulLoadError` escapes the loader                                                                                   |
| `src/services/soul-fs.ts`                   | `expandHome`, `parseManifest`, `readJsonFile`, `readTextFile`                                                                              |
| `src/logger.ts`, `src/helpers/notify-ui.ts` | `LoggerLayer` + `log{Debug,Info,Warning,Error}`; safe `ctx.ui.notify` wrapper                                                              |

### Event-handler bridge (the repeated seam)

Each handler builds an `Effect.gen` pipeline, runs it via `runtime.runPromise(Effect.matchCause(pipeline, { onSuccess, onFailure }))`, maps the tagged result back to Pi's callback world, then calls `notifyUI(ctx, msg, level)`.

## Gotchas

- `tsconfig` sets `erasableSyntaxOnly: true` ⇒ **no `enum`**. Enums are `S.Enums({ … } as const)` in `src/types.ts`.
- Souls load from 4 ordered search paths, **first match wins**: `~/.pi/agent/souls`, `~/.openclaw/souls/clawsouls`, `.pi/souls`, `./souls` (`SOUL_SEARCH_PATHS` in `src/loader.ts`).
- Loader has 4 internal tagged errors (`SoulNotFoundError`, `NoSoulsFoundError`, `ManifestParseError`, `FileSystemError`); all are caught + re-mapped to the single public `SoulLoadError`.

## Testing pattern

`@effect/vitest` + `Layer.fresh(SoulSpecLoader.Default)` (fresh cache per test) provided over `createMockFsLayer(...)` — a mock `FileSystem` layer built from typed soul definitions. See `tests/helpers.ts` and `tests/services/*.test.ts`.
