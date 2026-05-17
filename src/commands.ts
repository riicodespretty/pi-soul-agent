import { Cause, Effect, Option, pipe } from "effect";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, ParsedSoulCommand, SoulManifest } from "./types";
import { SoulSpecLoader } from "./loader";
import { ActiveSoulPersistence } from "./persistence";
import { buildSystemPrompt } from "./system-prompt";
import { notifyUI } from "./helpers/notify-ui";

// ═══════════════════════════════════════════════════════════════════════════
// Pure Parsing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse /soul command arguments.
 * Supports: soulname, soulname --level N, --level=N, --help, off|clear|none|default
 * Returns a discriminated union — each action variant has only its relevant fields.
 */

export function parseSoulCommandArgs(args: string): ParsedSoulCommand {
  const trimmed = args.trim();

  // Help
  if (trimmed === "--help" || trimmed === "-h") {
    return { action: "help" };
  }

  // Deactivate (--clear or -c flag)
  if (trimmed === "--clear" || trimmed === "-c") {
    return { action: "deactivate" };
  }

  // Heartbeat mode (--heartbeat lite|full)
  const hbMatch = /^--heartbeat\s+(lite|full)$/i.exec(trimmed);
  if (hbMatch) {
    return { action: "heartbeat", mode: hbMatch[1].toLowerCase() as "lite" | "full" };
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
        const summary = s.disclosure?.summary ?? s.description ?? "";
        const namePart = s.displayName === s.name ? s.name : `${s.name} — ${s.displayName}`;
        return summary ? `${namePart}\n  ${summary}` : namePart;
      });

      notifyUI(ctx, lines.join("\n"), "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Command: /soul
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register the `/soul` command.
 * Activate, deactivate, or get info about a soul.
 */
export function registerSoulCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul", {
    description:
      "Activate a soul (/soul <name> [--level N]) or deactivate (/soul --clear, -c). Use /soul --help for details.",
    getArgumentCompletions: async (prefix: string) => {
      // Suggest --heartbeat flags
      if (
        "--heartbeat ".startsWith(prefix) ||
        "--heartbeat ".toLowerCase().startsWith(prefix.toLowerCase())
      ) {
        return [
          {
            value: "--heartbeat lite",
            label: "lite",
            description: "Every 6 turns",
          },
          {
            value: "--heartbeat full",
            label: "full",
            description: "Full mala cycle (Every 6→3→2→3 turns)",
          },
        ];
      }

      const listSoulsPipeline = Effect.gen(function* () {
        const loader = yield* SoulSpecLoader;
        return yield* loader.listSouls();
      });

      const result = await runtime.runPromise(
        Effect.matchCause(listSoulsPipeline, {
          onSuccess: (souls) => souls,
          onFailure: () => [] as SoulManifest[],
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
          "       /soul --heartbeat lite|full",
          "",
          "Load and activate a SoulSpec persona.",
          "  --level N    Progressive disclosure level (1-3, default 2)",
          "",
          "Heartbeat mode:",
          "  --heartbeat lite   Every 6 turns (default, ~2.4 tok/turn)",
          "  --heartbeat full   Full mala cycle 6→3→2→3 (~3.5 avg, ~6.9 tok/turn)",
          "",
          "Tab-completion shows available souls with descriptions.",
          "",
          "Examples:",
          "  /soul developer",
          "  /soul developer --level 3  (full disclosure)",
          "  /soul --clear, -c          (deactivate current soul)",
          "  /soul --heartbeat lite     (reduce heartbeat frequency)",
          "  /soul --heartbeat full     (full mala cycle)",
        ].join("\n");
        notifyUI(ctx, helpMsg, "info");
        return;
      }

      if (parsed.action === "heartbeat") {
        const updateHeartbeatPipeline = Effect.gen(function* () {
          const persistence = yield* ActiveSoulPersistence;
          return yield* persistence.updateHeartbeatMode(parsed.mode);
        });

        const result = await runtime.runPromise(
          Effect.matchCause(updateHeartbeatPipeline, {
            onSuccess: () => ({ _tag: "success" as const }),
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

        notifyUI(
          ctx,
          `Heartbeat mode set to ${parsed.mode}. Will take effect after restart or /reload.`,
          "info",
        );
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
          const summary = s.disclosure?.summary ?? s.description ?? "";
          const namePart = s.displayName === s.name ? s.name : `${s.name} — ${s.displayName}`;
          msg += `\n  \u2022 **${namePart}**`;
          if (summary) msg += `\n    ${summary}`;
        }
        msg += "\n\nUse /soul --clear (or -c) to deactivate the active soul.";
        notifyUI(ctx, msg, "error");
        return;
      }

      // Activate
      const activateSoulPipeline = Effect.gen(function* () {
        const loader = yield* SoulSpecLoader;
        const persistence = yield* ActiveSoulPersistence;

        // Preserve existing heartbeat mode when switching souls
        const existing = yield* persistence.load();
        const heartbeatMode = Option.isSome(existing) ? existing.value.heartbeatMode : undefined;

        const manifest = yield* loader.getSoul(parsed.soulName, parsed.level);
        const systemPrompt = buildSystemPrompt(manifest, parsed.level);
        yield* persistence.save(manifest.name, parsed.level, heartbeatMode);
        return { manifest, systemPrompt } as const;
      });

      const result = await runtime.runPromise(
        Effect.matchCause(activateSoulPipeline, {
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
      const summary = manifest.disclosure?.summary ?? manifest.description ?? "";
      const namePart =
        manifest.displayName !== manifest.name
          ? `${manifest.name} — ${manifest.displayName}`
          : manifest.name;

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
