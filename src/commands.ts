import { Cause, Effect, Option, pipe } from "effect";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, HeartbeatMode, ParsedSoulCommand, SoulManifest } from "./types";
import { SoulSpecLoader } from "./loader";
import { ActiveSoulPersistence } from "./persistence";
import { buildSystemPrompt } from "./system-prompt";
import { notifyUI } from "./helpers/notify-ui";

export function parseSoulCommandArgs(args: string): ParsedSoulCommand {
  const trimmed = args.trim();

  if (trimmed === "--help" || trimmed === "-h") {
    return { action: "help" };
  }

  if (trimmed === "--clear" || trimmed === "-c") {
    return { action: "deactivate" };
  }

  const hbMatch = /^--heartbeat\s+(\S+)$/i.exec(trimmed);
  if (hbMatch) {
    const arg = hbMatch[1].toLowerCase();
    if (arg === "off" || arg === "lite" || arg === "full") {
      return { action: "heartbeat", mode: arg };
    }
    if (/^\d+$/.test(arg)) {
      const n = Number.parseInt(arg, 10);
      if (n >= 1) {
        return n > 1000
          ? {
              action: "heartbeat",
              mode: n,
              warning: `Heartbeat interval ${n} is very large (> 1000 turns); reminders will be rare.`,
            }
          : { action: "heartbeat", mode: n };
      }
    }
    return {
      action: "error",
      message: "heartbeat must be off|lite|full or a positive whole number",
    };
  }

  // Parse optional --level flag using Option (match can return null)
  const level = pipe(
    Option.fromNullable(/--level\s*=\s*(\d+)/i.exec(trimmed) ?? /--level\s+(\d+)/i.exec(trimmed)),
    Option.map((m) => Math.max(1, Math.min(3, Number.parseInt(m[1], 10)))),
    Option.getOrElse(() => 2),
  );

  // Strip --level flag to get soul name
  const soulName = trimmed.replace(/--level\s*[= ]\s*\d+/i, "").trim();

  return { action: "activate", soulName, level };
}

// ═══════════════════════════════════════════════════════════════════════════
// Heartbeat Level-3 gate notice
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide whether setting `mode` on a soul currently at `level` warrants a
 * "needs Level 3" notice. Heartbeat content only loads at Level 3, so a cadence
 * (`lite` | `full` | custom `N`) set below Level 3 persists but cannot fire until
 * the soul is loaded at Level 3. `off` never warns (nothing was going to fire).
 * Returns the notice string, or `undefined` when no notice is warranted.
 */
export function heartbeatLevelNotice(mode: HeartbeatMode, level: number): string | undefined {
  if (mode === "off" || level >= 3) return undefined;
  return "Heartbeat needs level 3 to send reminders; will activate when this soul is loaded at level 3.";
}

function soulLineParts(soul: SoulManifest): { namePart: string; summary: string } {
  const summary = soul.disclosure?.summary ?? soul.description ?? "";
  const namePart =
    soul.displayName === soul.name ? soul.name : `${soul.name} — ${soul.displayName}`;
  return { namePart, summary };
}

// ═══════════════════════════════════════════════════════════════════════════
// Command: /soul-list
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register the `/soul-list` command.
 * Lists all available SoulSpec personas by name (level 1 metadata).
 */
export function registerSoulListCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul-list", {
    description: "List all available SoulSpec personas",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const listSoulsPipeline = Effect.gen(function* () {
        const loader = yield* SoulSpecLoader;
        return yield* loader.listSouls();
      });

      const result = await runtime.runPromise(
        Effect.matchCause(listSoulsPipeline, {
          onSuccess: (souls) => ({ _tag: "success" as const, souls }),
          onFailure: (cause) => ({
            _tag: "error" as const,
            message: `Error listing souls: ${Cause.pretty(cause)}`,
          }),
        }),
      );

      if (result._tag === "error") {
        notifyUI(ctx, result.message, "error");
        return;
      }

      if (result.souls.length === 0) {
        notifyUI(ctx, "No souls found. Create a souls/ directory with soul.json files.", "error");
        return;
      }

      const lines = result.souls.map((s) => {
        const { namePart, summary } = soulLineParts(s);
        return summary ? `${namePart}\n  ${summary}` : namePart;
      });

      notifyUI(ctx, lines.join("\n"), "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Command: /soul
// ═══════════════════════════════════════════════════════════════════════════

export function activateSoulPipeline(soulName: string, level: number) {
  return Effect.gen(function* () {
    const loader = yield* SoulSpecLoader;
    const persistence = yield* ActiveSoulPersistence;

    const manifest = yield* loader.getSoul(soulName, level);
    const systemPrompt = buildSystemPrompt(manifest, level);
    yield* persistence.save(manifest.name, level);
    return { manifest, systemPrompt } as const;
  });
}

/**
 * Register the `/soul` command.
 * Activate, deactivate, or get info about a soul.
 */
export function registerSoulCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul", {
    description:
      "Activate a soul (/soul <name> [--level N]) or deactivate (/soul --clear, -c). Use /soul --help for details.",
    getArgumentCompletions: async (prefix: string) => {
      // Only suggest --heartbeat flags when user is typing a flag (starts with --)
      if (prefix.startsWith("-")) {
        const flagCompletions = [];

        // Suggest --clear (deactivate)
        if ("--clear".startsWith(prefix) || "-c".startsWith(prefix)) {
          flagCompletions.push({
            value: "--clear",
            label: "--clear, -c",
            description: "Deactivate current soul",
          });
        }

        // Suggest --help
        if ("--help".startsWith(prefix) || "-h".startsWith(prefix)) {
          flagCompletions.push({
            value: "--help",
            label: "--help, -h",
            description: "Show soul command help",
          });
        }

        // Suggest --heartbeat flags
        if (
          "--heartbeat ".startsWith(prefix) ||
          "--heartbeat ".toLowerCase().startsWith(prefix.toLowerCase())
        ) {
          flagCompletions.push(
            {
              value: "--heartbeat lite",
              label: "lite",
              description: "Every 6 turns",
            },
            {
              value: "--heartbeat full",
              label: "full",
              description: "Ramp then plateau: 6, 18, 36, 108, then every 108",
            },
            {
              value: "--heartbeat off",
              label: "off",
              description: "Disable heartbeat reminders",
            },
          );
        }

        return flagCompletions;
      }

      const listSoulsPipeline = Effect.gen(function* () {
        const loader = yield* SoulSpecLoader;
        return yield* loader.listSouls();
      });

      const result = await runtime.runPromise(
        Effect.matchCause(listSoulsPipeline, {
          onSuccess: (souls) => souls,
          onFailure: (): SoulManifest[] => [],
        }),
      );
      return result
        .filter((s) => s.name.startsWith(prefix))
        .map((s) => ({
          value: s.name,
          label: s.displayName,
          description: s.disclosure?.summary ?? s.description ?? "",
        }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseSoulCommandArgs(args);

      if (parsed.action === "help") {
        const helpMsg = [
          "Usage: /soul <name> [--level N]",
          "       /soul --clear (or -c)",
          "       /soul --heartbeat off|lite|full|<N>",
          "",
          "Load and activate a SoulSpec persona.",
          "  --level N    Progressive disclosure level (1-3, default 2)",
          "",
          "Heartbeat mode:",
          "  --heartbeat off    Disable heartbeat reminders",
          "  --heartbeat lite   Every 6 turns (default)",
          "  --heartbeat full   Mala ramp: fires 6, 18, 36, 108, then every 108 (from activation)",
          "  --heartbeat <N>    Custom: every N turns from activation (positive whole number)",
          "",
          "Tab-completion shows available souls with descriptions.",
          "",
          "Examples:",
          "  /soul developer",
          "  /soul developer --level 3  (full disclosure)",
          "  /soul --clear, -c          (deactivate current soul)",
          "  /soul --heartbeat lite     (reduce heartbeat frequency)",
          "  /soul --heartbeat full     (mala ramp-then-plateau)",
          "  /soul --heartbeat 10       (custom: every 10 turns)",
        ].join("\n");
        notifyUI(ctx, helpMsg, "info");
        return;
      }

      if (parsed.action === "error") {
        notifyUI(ctx, parsed.message, "error");
        return;
      }

      if (parsed.action === "heartbeat") {
        const updateHeartbeatPipeline = Effect.gen(function* () {
          const persistence = yield* ActiveSoulPersistence;
          yield* persistence.updateHeartbeatMode(parsed.mode);
          // Rationale [2] → git notes docs-code-rationale: docs/rationale/commands.md
          const active = yield* persistence.load();
          return Option.isSome(active) ? active.value.level : undefined;
        });

        const result = await runtime.runPromise(
          Effect.matchCause(updateHeartbeatPipeline, {
            onSuccess: (level) => ({ _tag: "success" as const, level }),
            onFailure: (cause) => ({
              _tag: "error" as const,
              message: `Error updating heartbeat mode: ${Cause.pretty(cause)}`,
            }),
          }),
        );

        if (result._tag === "error") {
          notifyUI(ctx, result.message, "error");
          return;
        }

        if (parsed.warning) {
          notifyUI(ctx, parsed.warning, "warning");
        }

        // Persist-and-warn: the setting is saved above; if the target soul is
        // below the Level-3 content gate, tell the user it won't fire until then.
        const levelNotice =
          result.level === undefined ? undefined : heartbeatLevelNotice(parsed.mode, result.level);
        if (levelNotice) {
          notifyUI(ctx, levelNotice, "warning");
        }

        // Rationale [3] → git notes docs-code-rationale: docs/rationale/commands.md
        const settingMsg =
          parsed.mode === "off"
            ? "Heartbeat reminders disabled."
            : levelNotice
              ? `Heartbeat mode set to ${parsed.mode}.`
              : `Heartbeat mode set to ${parsed.mode}. Takes effect on the next turn.`;
        notifyUI(ctx, settingMsg, "info");
        return;
      }

      if (parsed.action === "deactivate") {
        const deactivateSoulPipeline = Effect.gen(function* () {
          const persistence = yield* ActiveSoulPersistence;
          return yield* persistence.clear();
        });

        const result = await runtime.runPromise(
          Effect.matchCause(deactivateSoulPipeline, {
            onSuccess: () => ({ _tag: "success" as const }),
            onFailure: (cause) => ({
              _tag: "error" as const,
              message: `Error deactivating soul: ${Cause.pretty(cause)}`,
            }),
          }),
        );

        if (result._tag === "error") {
          notifyUI(ctx, result.message, "error");
          return;
        }

        notifyUI(ctx, "Soul deactivated. No soul will auto-load in future sessions.", "info");
        return;
      }

      // No soul name provided — show usage
      if (!parsed.soulName) {
        const listSoulsPipeline = Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          return yield* loader.listSouls();
        });

        const result = await runtime.runPromise(
          Effect.matchCause(listSoulsPipeline, {
            onSuccess: (souls) => ({ _tag: "success" as const, souls }),
            onFailure: (cause) => ({
              _tag: "error" as const,
              message: `Error listing souls: ${Cause.pretty(cause)}`,
            }),
          }),
        );

        if (result._tag === "error") {
          notifyUI(ctx, result.message, "error");
          return;
        }

        let msg = "Usage: /soul <soul-name>\n\nAvailable souls:\n";
        for (const s of result.souls) {
          const { namePart, summary } = soulLineParts(s);
          msg += `\n  \u2022 **${namePart}**`;
          if (summary) msg += `\n    ${summary}`;
        }
        msg += "\n\nUse /soul --clear (or -c) to deactivate the active soul.";
        notifyUI(ctx, msg, "error");
        return;
      }

      // Activate
      const result = await runtime.runPromise(
        Effect.matchCause(activateSoulPipeline(parsed.soulName, parsed.level), {
          onSuccess: ({ manifest, systemPrompt }) => ({
            _tag: "success" as const,
            manifest,
            systemPrompt,
          }),
          onFailure: (cause) => ({
            _tag: "error" as const,
            message: `Error activating soul: ${Cause.pretty(cause)}`,
          }),
        }),
      );

      if (result._tag === "error") {
        notifyUI(ctx, result.message, "error");
        return;
      }

      notifyUI(
        ctx,
        `Now using soul: ${result.manifest.displayName} (level ${parsed.level}). This soul will auto-load in future sessions.`,
        "info",
      );

      pi.sendMessage(
        {
          customType: "soulspec",
          content: result.systemPrompt,
          display: false,
          details: {
            soul: result.manifest.name,
            prompt: result.systemPrompt,
            level: parsed.level,
          },
        },
        {
          deliverAs: "steer",
        },
      );
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Command: /soul-info
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register the `/soul-info` command.
 * Shows active soul details and optionally the full system prompt.
 */
export function registerSoulInfoCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul-info", {
    description:
      "Show active soul info: name, summary, path, level. Add --full (or -f) for the full system prompt.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const showFull = args.trim() === "--full" || args.trim() === "-f";

      const describeSoulPipeline = Effect.gen(function* () {
        const persistence = yield* ActiveSoulPersistence;
        const loaded = yield* persistence.load();
        if (loaded._tag === "None") {
          return { _tag: "inactive" as const };
        }

        const active = loaded.value;
        const loader = yield* SoulSpecLoader;
        const soulPath = yield* loader.resolveSoulPath(active.soul);
        const manifest = yield* loader.getSoul(active.soul, active.level);
        const systemPrompt = showFull ? buildSystemPrompt(manifest, active.level) : null;

        return {
          _tag: "active" as const,
          manifest,
          soulPath,
          level: active.level,
          systemPrompt,
        };
      });

      const result = await runtime.runPromise(
        Effect.matchCause(describeSoulPipeline, {
          onSuccess: (data) => data,
          onFailure: (cause) => ({
            _tag: "error" as const,
            message: `Error getting soul info: ${Cause.pretty(cause)}`,
          }),
        }),
      );

      if (result._tag === "error") {
        notifyUI(ctx, result.message, "error");
        return;
      }

      if (result._tag === "inactive") {
        notifyUI(ctx, "No active soul. Use /soul <name> to activate one.", "info");
        return;
      }

      const { manifest, soulPath, level, systemPrompt } = result;
      const { namePart, summary } = soulLineParts(manifest);

      let msg = `Active soul: ${namePart}`;
      if (summary) msg += `\n  ${summary}`;
      msg += `\nPath: ${soulPath}`;
      msg += `\nLevel: ${level}`;

      if (systemPrompt) {
        msg += `\n\n${systemPrompt}`;
      }

      notifyUI(ctx, msg, "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Command: /soul-heartbeat
// ═══════════════════════════════════════════════════════════════════════════

export type SoulHeartbeatResult =
  | { readonly _tag: "send"; readonly content: string }
  | { readonly _tag: "no-active-soul" }
  | { readonly _tag: "level-too-low"; readonly level: number }
  | { readonly _tag: "no-heartbeat-content" };

export function soulHeartbeatPipeline() {
  return Effect.gen(function* () {
    const persistence = yield* ActiveSoulPersistence;
    const active = yield* persistence.load();
    if (Option.isNone(active)) {
      return { _tag: "no-active-soul" } satisfies SoulHeartbeatResult;
    }

    const soul = active.value;
    if (soul.level < 3) {
      return { _tag: "level-too-low", level: soul.level } satisfies SoulHeartbeatResult;
    }

    const loader = yield* SoulSpecLoader;
    const manifest = yield* loader.getSoul(soul.soul, soul.level);
    const content = Option.fromNullable(manifest.heartbeatContent);
    if (Option.isNone(content)) {
      return { _tag: "no-heartbeat-content" } satisfies SoulHeartbeatResult;
    }

    return { _tag: "send", content: content.value } satisfies SoulHeartbeatResult;
  });
}

/**
 * Register the `/soul-heartbeat` command.
 * Injects the active soul's heartbeat grounding on demand, reusing the
 * scheduler's hidden reminder payload. Ignores heartbeat mode; gated only by an
 * active, Level-3 soul with heartbeat content.
 */
export function registerSoulHeartbeatCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul-heartbeat", {
    description:
      "Ground the active soul now: inject its heartbeat content on demand (independent of heartbeat mode).",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const result = await runtime.runPromise(
        Effect.matchCause(soulHeartbeatPipeline(), {
          onSuccess: (data) => data,
          onFailure: (cause) => ({
            _tag: "error" as const,
            message: `Error running manual heartbeat: ${Cause.pretty(cause)}`,
          }),
        }),
      );

      if (result._tag === "error") {
        notifyUI(ctx, result.message, "error");
        return;
      }

      if (result._tag === "no-active-soul") {
        notifyUI(ctx, "No active soul. Use /soul <name> to activate one.", "info");
        return;
      }

      if (result._tag === "level-too-low") {
        notifyUI(
          ctx,
          `Heartbeat content loads at Level 3; the active soul is at Level ${result.level}. Re-activate with /soul <name> --level 3 to enable it.`,
          "info",
        );
        return;
      }

      if (result._tag === "no-heartbeat-content") {
        notifyUI(ctx, "This soul has no heartbeat content.", "info");
        return;
      }

      pi.sendMessage({
        customType: "soul-heartbeat-reminder",
        content: `<soul-heartbeat-reminder type="grounding" no-response>\n${result.content}\n</soul-heartbeat-reminder>`,
        display: false,
      });
      notifyUI(ctx, "Heartbeat sent. The active soul has been re-grounded.", "info");
    },
  });
}
