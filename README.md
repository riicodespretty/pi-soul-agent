<div align="center">

# 🪷 pi-soul-agent

**SoulSpec persona management for [Pi Coding Agent](https://pi.dev) — rebuilt with [Effect TS](https://effect.website)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pi Package](https://img.shields.io/badge/pi--package-%F0%9F%93%A6-blueviolet)](https://pi.dev/packages)
[![Effect TS](https://img.shields.io/badge/Effect_TS-v3.21-purple)](https://effect.website)
[![Install](https://img.shields.io/badge/Install-pi%20install%20git-blue)](#installation)

</div>

---

A **learning-first** fork of [`@vtstech/pi-soul`](https://pi.dev/packages/@vtstech/pi-soul) — the SoulSpec extension for Pi — rewritten from imperative Node.js into idiomatic **Effect TS**.

This project exists to learn:

- **Effect TS** — services, layers, `ManagedRuntime`, `Effect.gen`, schema, error handling, and structured concurrency
- **Pi extension development** — events, tools, commands, and lifecycle hooks
- **Writing Effect TS for agents** — patterns for bridging Effect pipelines into Pi's async callback world

---

## Differences from `@vtstech/pi-soul`

| Aspect             | Original (`@vtstech/pi-soul`)                                  | This fork                                                     |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------- |
| **Language**       | Imperative TypeScript (`fs.existsSync`, `JSON.parse`, classes) | Effect TS (`FileSystem`, `Schema`, `Effect.Service`, `Layer`) |
| **Error handling** | `try/catch`, `throw new Error(...)`                            | `Schema.TaggedError`, `Effect.matchCause`, `Cause.pretty`     |
| **File I/O**       | `fs.readFileSync`, `fs.writeFileSync`                          | `@effect/platform` `FileSystem` service                       |
| **State**          | Module-level globals                                           | `Ref`, `Layer`-scoped services                                |
| **Persistence**    | `fs.writeFileSync` (imperative)                                | `Effect.gen` pipeline with error mapping                      |
| **Build tools**    | `tsconfig.compile.json`, esbuild                               | Vite+ (Vite + Rolldown + Oxlint)                              |
| **Heartbeat**      | Loaded into system prompt at level 3                           | Loaded plus periodic **mala reminder** via `turn_end`         |

---

## Features

### SoulSpec Persona Management

- Load AI agent personas defined in the [SoulSpec](https://github.com/clawsouls/soulspec) format
- Progressive disclosure (levels 1–3): metadata → core persona → full behavior
- Auto-load persisted soul on session start
- Multiple soul search paths: `~/.pi/agent/souls/`, `.pi/souls/`, `./souls/`

### Commands

| Command                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `/soul <name> [--level N]` | Activate a soul with progressive disclosure level |
| `/soul --clear`            | Deactivate current soul                           |
| `/soul-list`               | List all available souls                          |
| `/soul-info [--full]`      | Show active soul details                          |

### Tools

| Tool         | Description                                     |
| ------------ | ----------------------------------------------- |
| `load_soul`  | Load a SoulSpec persona and build system prompt |
| `list_souls` | List all available souls                        |
| `soul_info`  | Get detailed information about a soul           |

### Heartbeat Mala 🪷

When a soul is activated at **level 3** and defines heartbeat content, a periodic reminder is injected via `pi.sendMessage` on every 3rd `turn_end`, following a Buddhist mala cycle:

| Turn | Bead       | Meaning                                            |
| ---- | ---------- | -------------------------------------------------- |
| 6    | 6 Senses   | Touch, taste, smell, sight, hearing, consciousness |
| 9    | 3 Feelings | Pleasant, unpleasant, neutral                      |
| 11   | 2 States   | Attached or free                                   |
| 14   | 3 Times    | Past, present, future                              |
| 20   | 6 Senses   | — cycle repeats —                                  |

The intervals (6 × 3 × 2 × 3) multiply to **108**, the classic Buddhist mala count. The counter persists across the full session (reset on `session_start`).

---

## Installation

### As a Pi package (recommended)

```bash
pi install git:github.com/<your-org>/pi-soul-agent
```

### Manual (project-local)

Place in `.pi/extensions/soul.ts` and Pi auto-discovers it.

### Prerequisites

- [Pi Coding Agent](https://pi.dev) v0.66+
- Souls installed in one of the search paths (see [Soul Locations](#soul-locations))

---

## Soul Locations

The extension searches for souls in the following directories (first match wins):

1. `~/.pi/agent/souls/` — Global souls directory
2. `~/.openclaw/souls/clawsouls/` — ClawSouls CLI registry
3. `.pi/souls/` — Project-local souls directory
4. `./souls/` — Current directory souls

### Soul Structure

```
~/.pi/agent/souls/
└── my-persona/
    ├── soul.json       # Required: Soul manifest
    ├── SOUL.md         # Required: Core persona
    ├── IDENTITY.md     # Optional: Identity information
    ├── STYLE.md        # Optional: Style guidelines
    ├── AGENTS.md       # Optional: Agent behavior
    ├── HEARTBEAT.md    # Optional: Operational rhythm
    └── USER_TEMPLATE.md
```

### Manifest Format (soul.json)

```json
{
  "specVersion": "0.5",
  "name": "my-persona",
  "displayName": "My Persona",
  "description": "A helpful coding assistant",
  "files": {
    "soul": "SOUL.md",
    "identity": "IDENTITY.md",
    "heartbeat": "HEARTBEAT.md"
  },
  "disclosure": {
    "summary": "Friendly coding assistant"
  }
}
```

---

## Progressive Disclosure

| Level | Content                                                        |
| ----- | -------------------------------------------------------------- |
| 1     | Metadata only (soul.json)                                      |
| 2     | Core persona (SOUL.md + IDENTITY.md)                           |
| 3     | Full behavior (all files including heartbeat, style, examples) |

---

## Architecture

The extension uses Effect TS throughout:

```
Runtime (ManagedRuntime)
  ├── SoulSpecLoader         — discovers, parses, caches souls
  ├── ActiveSoulPersistence  — persists active soul to disk
  ├── FileSystem             — @effect/platform
  ├── NodePath               — @effect/platform-node
  └── LoggerLayer            — structured logging
```

Each Pi event handler runs an `Effect.gen` pipeline, bridges it to Pi's callback world via `runtime.runPromise(Effect.matchCause(...))`, and surfaces errors using the project's tagged-union pattern.

### Event Handlers

| Event                        | Handler                                  |
| ---------------------------- | ---------------------------------------- |
| `session_start`              | Preloads persisted active soul           |
| `resources_discover`         | Exposes soul directories as prompt paths |
| `before_agent_start`         | Injects active soul into system prompt   |
| `session_start` / `turn_end` | Heartbeat mala reminder (level 3 only)   |

---

## Development

```bash
git clone <repo>
cd pi-soul-agent
vp install
vp check
vp test
```

### Project Structure

```
pi-soul-agent/
├── package.json              # Pi manifest + deps
├── .pi/extensions/soul.ts    # Extension entry point
├── src/
│   ├── commands.ts           # /soul, /soul-list, /soul-info
│   ├── events.ts             # session_start, resources_discover, before_agent_start, heartbeat
│   ├── loader.ts             # SoulSpecLoader (Effect service)
│   ├── persistence.ts        # ActiveSoulPersistence (Effect service)
│   ├── system-prompt.ts      # System prompt builder
│   ├── types.ts              # SoulSpec schemas (Effect Schema)
│   ├── errors.ts             # Tagged error types
│   ├── logger.ts             # Structured logging layer
│   ├── helpers/notify-ui.ts  # UI notification helper
│   └── services/soul-fs.ts   # File system helpers
└── .git/info/exclude         # Local-only ignores
```

---

## License

MIT — fork of [`@vtstech/pi-soul`](https://pi.dev/packages/@vtstech/pi-soul) (MIT) by [VTSTech](https://github.com/VTSTech).
