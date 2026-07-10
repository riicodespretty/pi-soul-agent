<div align="center">

# 🪷 pi-soul-agent

**SoulSpec persona management for [Pi Coding Agent](https://pi.dev) — rebuilt with [Effect TS](https://effect.website)**

[![Pi Package](https://img.shields.io/badge/pi--package-%F0%9F%93%A6-blueviolet)](https://pi.dev/packages)
[![Effect TS](https://img.shields.io/badge/Effect_TS-v3.21-purple)](https://effect.website)
[![Install](https://img.shields.io/badge/Install-pi%20install%20git-blue)](#installation)

</div>

---

A **learning-first** port of [`@vtstech/pi-soul`](https://pi.dev/packages/@vtstech/pi-soul) — the SoulSpec extension for Pi — rewritten from imperative Node.js into idiomatic **Effect TS**.

This project exists to learn:

- **Effect TS** — services, layers, `ManagedRuntime`, `Effect.gen`, schema, error handling, and structured concurrency
- **Pi extension development** — events, tools, commands, and lifecycle hooks
- **Writing Effect TS using agentic coding** — letting the agent scaffold, refactor, and iterate on Effect services while I steer; learning what prompts produce correct layers, how to verify generated Effect code, and where the agent still needs human guidance
- **Agent used** - DeepSeek V4 Flash

---

## Differences from `@vtstech/pi-soul`

| Aspect             | Original (`@vtstech/pi-soul`)                                  | This port                                                     |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------- |
| **Language**       | Imperative TypeScript (`fs.existsSync`, `JSON.parse`, classes) | Effect TS (`FileSystem`, `Schema`, `Effect.Service`, `Layer`) |
| **Error handling** | `try/catch`, `throw new Error(...)`                            | `Data.TaggedError`, `Effect.matchCause`, `Cause.pretty`       |
| **File I/O**       | `fs.readFileSync`, `fs.writeFileSync`                          | `@effect/platform` `FileSystem` service                       |
| **State**          | Module-level globals                                           | `Ref`, `Layer`-scoped services                                |
| **Persistence**    | `fs.writeFileSync` (imperative)                                | `Effect.gen` pipeline with error mapping                      |
| **Build tools**    | `tsconfig.compile.json`, esbuild                               | Vite+ (Vite + Rolldown + Oxlint)                              |
| **Heartbeat**      | Loaded into system prompt at level 3                           | Sent as periodic system reminders via `turn_end`              |

---

## Features

### SoulSpec Persona Management

- Load AI agent personas defined in the [SoulSpec](https://github.com/clawsouls/soulspec) format
- Progressive disclosure (levels 1–3): metadata → core persona → full behavior
- Auto-load persisted soul on session start
- Multiple soul search paths: `~/.pi/agent/souls/`, `~/.openclaw/souls/clawsouls/`, `.pi/souls/`, `./souls/`

### Commands

| Command                    | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `/soul <name> [--level N]` | Activate a soul with progressive disclosure level      |
| `/soul --clear`            | Deactivate current soul                                |
| `/soul --heartbeat <mode>` | Set heartbeat cadence: `off`, `lite`, `full`, or `<N>` |
| `/soul-list`               | List all available souls                               |
| `/soul-info [--full]`      | Show active soul details                               |

Tab-completion for `/soul` offers available soul names (each with its description) and, once you start typing a flag, the flags `--clear` (`-c`), `--help` (`-h`), and `--heartbeat` — including the heartbeat modes `lite`, `full`, and `off`.

### Heartbeat System Reminders

When a soul defines a `HEARTBEAT.md` file and is loaded at **level 3**, the extension sends a periodic system reminder to the agent using the heartbeat content. It fires on `turn_end`, measured from the **activation anchor** — the turn on which the soul becomes active (that turn is the zero point and does not itself fire). The `full` mode follows a Buddhist [mala](https://en.wikipedia.org/wiki/Japamala) as a **ramp-then-plateau**: frequent early grounding that tapers to a steady pulse.

| Fire # | Turn after activation | Gap | Bead     | Meaning                                            |
| ------ | --------------------- | --- | -------- | -------------------------------------------------- |
| 1      | 6                     | 6   | Senses   | Touch, taste, smell, sight, hearing, consciousness |
| 2      | 18                    | 12  | Feelings | Pleasant, unpleasant, neutral                      |
| 3      | 36                    | 18  | States   | Attached, or detached                              |
| 4      | 108                   | 72  | Times    | Past, present, future                              |
| 5      | 216                   | 108 | —        | — steady plateau, every 108 thereafter —           |

The mala factors `[6, 3, 2, 3]` are cumulative **positions** (prefix products) — 6, 18, 36, 108 — not repeating gaps: 6 × 3 × 2 × 3 = **108** beads, the total landscape of mental disturbances ([kleshas](<https://en.wikipedia.org/wiki/Kleshas_(Buddhism)>)) to overcome. After the ramp reaches 108 the schedule **plateaus**, firing every 108 turns. The schedule counts only while a soul is active and **re-anchors** (restarts from 0) whenever the active soul changes — it is not a session-long counter. The reminder is hidden from the user — the agent sees it in its message history but the TUI stays clean.

#### Heartbeat modes

Set the cadence with `/soul --heartbeat <mode>` (persisted with the active soul, so it survives across sessions):

| Mode   | Cadence                                                             |
| ------ | ------------------------------------------------------------------- |
| `off`  | Never fires — reminders disabled                                    |
| `lite` | Every 6 turns from activation (default)                             |
| `full` | The mala ramp-then-plateau above (6, 18, 36, 108, then every 108)   |
| `<N>`  | Custom: every **N** turns from activation (a positive whole number) |

A custom interval fires at N, 2N, 3N … turns after activation — e.g. `/soul --heartbeat 10` grounds every 10 turns. Mode words take precedence over the integer parse. Zero, negative, fractional, and non-numeric values are **rejected** (with the message `heartbeat must be off|lite|full or a positive whole number`), never clamped or treated as `off`. Values above 1000 are accepted but produce a warning, since reminders would then be very rare.

---

## Installation

### As a Pi package (recommended)

```bash
pi install git:github.com/riicodespretty/pi-soul-agent
```

### Manual (project-local)

Place in `.pi/extensions/soul.ts` and Pi auto-discovers it.

### Prerequisites

- [Pi Coding Agent](https://pi.dev) v0.66+
- Souls installed in one of the search paths (see [Soul Locations](#soul-locations))

---

## Installing Souls

Browse and install community souls from [clawsouls.ai/souls](https://clawsouls.ai/souls) using the ClawSouls CLI:

```bash
# Install the CLI
bun i -g clawsouls

# Or use directly via npx
bunx clawsouls install clawsouls/surgical-coder
```

Installed souls land in `~/.openclaw/souls/clawsouls/` — one of the four search paths this extension scans automatically. No additional configuration needed.

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
└── bodhisattva-coder/
    ├── soul.json       # Required: Soul manifest
    ├── SOUL.md         # Required: Core persona
    ├── IDENTITY.md     # Optional: Identity information
    ├── STYLE.md        # Optional: Style guidelines
    ├── AGENTS.md       # Optional: Agent behavior
    ├── HEARTBEAT.md    # Optional: Operational rhythm
    └── USER_TEMPLATE.md
```

### Example Manifest Format (soul.json)

The full SoulSpec schema is documented at [clawsouls/soulspec](https://github.com/clawsouls/soulspec/blob/main/soulspec/clawspec.md).

```json
{
  "specVersion": "0.5",
  "name": "bodhisattva-coder",
  "displayName": "Bodhisattva Coder 🪷",
  "version": "1.0.0",
  "description": "Surgical coder rooted in the bodhisattva vow.",
  "category": "development",
  "files": {
    "soul": "SOUL.md",
    "identity": "IDENTITY.md",
    "agents": "AGENTS.md",
    "heartbeat": "HEARTBEAT.md",
    "style": "STYLE.md"
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

| Event                                    | Handler                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| `session_start`                          | Preloads persisted active soul                                |
| `resources_discover`                     | Exposes soul directories as prompt paths                      |
| `before_agent_start`                     | Injects active soul into system prompt                        |
| `turn_end` (anchored to soul activation) | Heartbeat mala reminder at interval thresholds (level 3 only) |

---

## Development

```bash
git clone <repo>
cd pi-soul-agent
vp install
vp check        # format, lint, type-check
bun test        # or: node node_modules/vitest/vitest.mjs run
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

MIT — port of [`@vtstech/pi-soul`](https://pi.dev/packages/@vtstech/pi-soul) (MIT) by [VTSTech](https://github.com/VTSTech).
