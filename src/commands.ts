import { Cause, Effect } from "effect";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "@/src/types";
import { SoulSpecLoader } from "@/src/loader";
import { ActiveSoulPersistence } from "@/src/persistence";
import { buildSystemPrompt } from "@/src/system-prompt";

/**
 * Register the `/souls` command.
 * Lists all available souls via UI notification.
 */
export function registerSoulsCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("souls", {
    description: "List all available SoulSpec personas",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify("Loading souls...", "info");

      const entries = await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          return yield* loader.enumerateSouls();
        }),
      );

      if (entries.length === 0) {
        ctx.ui.notify("No souls found. Create a souls/ directory with soul.json files.", "error");
        return;
      }

      let message = "Available souls:\n\n";
      for (const entry of entries) {
        if (entry._tag === "loaded") {
          message += `\u2022 **${entry.manifest.displayName}** (${entry.name})\n`;
          message += `  ${entry.manifest.description}\n`;
          if (entry.manifest.disclosure?.summary) {
            message += `  ${entry.manifest.disclosure.summary}\n`;
          }
        } else {
          message += `\u2022 **${entry.name}** (Error: ${entry.reason})\n`;
        }
        message += "\n";
      }

      ctx.ui.notify(message, "info");
    },
  });
}

/**
 * Parse /soul command arguments.
 * Supports: soulname, soulname --level N, --level=N, --help, off|clear|none|default
 */
function parseSoulCommandArgs(args: string): {
  action: "activate" | "deactivate" | "help";
  soulName?: string;
  level: number;
} {
  const trimmed = args.trim();

  // Help
  if (trimmed === "--help" || trimmed === "-h") {
    return { action: "help", level: 2 };
  }

  // Deactivate
  if (["off", "clear", "none", "default"].includes(trimmed)) {
    return { action: "deactivate", level: 2 };
  }

  // Parse --level from args (support both "--level 3" and "--level=3")
  let soulArgs = trimmed;
  let level = 2;
  const levelMatch = soulArgs.match(/--level\s*=\s*(\d+)/i) || soulArgs.match(/--level\s+(\d+)/i);
  if (levelMatch) {
    level = parseInt(levelMatch[1], 10);
    level = Math.max(1, Math.min(3, level)); // Clamp to 1-3
    soulArgs = soulArgs.replace(/--level\s*[= ]\s*\d+/i, "").trim();
  }

  // Soul name only
  return {
    action: "activate",
    soulName: soulArgs,
    level,
  };
}

/**
 * Register the `/soul` command.
 * Activate, deactivate, or get info about a soul.
 */
export function registerSoulCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("soul", {
    description:
      "Activate a soul (/soul <name> [--level N]) or deactivate (/soul off|clear|none|default). Use /soul --help for details.",
    getArgumentCompletions: async (prefix: string) => {
      return await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const souls = yield* loader.getAllSouls().pipe(
            Effect.catchAll((e) => {
              console.debug(`[commands] Error in soul completions: ${e.message}`);
              return Effect.succeed([] as string[]);
            }),
          );
          return souls
            .filter((s: string) => s.startsWith(prefix))
            .map((s: string) => ({
              value: s,
              label: s,
              description: `Load soul: ${s}`,
            }));
        }),
      );
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseSoulCommandArgs(args);

      if (parsed.action === "help") {
        const helpMsg = [
          "Usage: /soul <name> [--level N]",
          "       /soul off|clear|none|default",
          "",
          "Load and activate a SoulSpec persona.",
          "  --level N    Progressive disclosure level (1-3, default 2)",
          "",
          "Examples:",
          "  /soul developer",
          "  /soul developer --level 3  (full disclosure)",
          "  /soul off                   (deactivate current soul)",
        ].join("\n");
        ctx.ui.notify(helpMsg, "info");
        return;
      }

      if (parsed.action === "deactivate") {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const persistence = yield* ActiveSoulPersistence;
            yield* persistence.clear();
            return { _tag: "success" as const };
          }).pipe(
            Effect.catchAllCause(() =>
              Effect.succeed({
                _tag: "error" as const,
                message: `Error deactivating soul: Unexpected error`,
              }),
            ),
          ),
        );

        if (result._tag === "success") {
          ctx.ui.notify("Soul deactivated. No soul will auto-load in future sessions.", "info");
        } else {
          ctx.ui.notify(result.message, "error");
        }
        return;
      }

      // Activate
      if (!parsed.soulName) {
        const souls = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls().pipe(
              Effect.catchAll((e) => {
                console.debug(`[commands] Error getting souls: ${e.message}`);
                return Effect.succeed([] as string[]);
              }),
            );
          }),
        );
        let msg = "Usage: /soul <soul-name>\n\nAvailable souls:\n";
        for (const s of souls) {
          msg += `\n  \u2022 **${s}**`;
        }
        msg += "\n\nUse /soul off to clear the active soul.";
        ctx.ui.notify(msg, "error");
        return;
      }

      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            const persistence = yield* ActiveSoulPersistence;
            const manifest = yield* loader.load(parsed.soulName!, parsed.level);
            const systemPrompt = buildSystemPrompt(manifest, parsed.level);
            yield* persistence.save(manifest.name, parsed.level);
            return { _tag: "success" as const, manifest, systemPrompt };
          }).pipe(
            Effect.catchTag("SoulLoadError", (e) => {
              // SoulLoadError.message already contains suggestions for not-found cases
              console.debug(`[commands] Error loading soul: ${e.message}`);
              return Effect.succeed({
                _tag: "error" as const,
                message: e.message,
              });
            }),
            Effect.catchAllCause((cause) => {
              console.error(`[commands] Defect activating soul: ${Cause.pretty(cause)}`);
              return Effect.succeed({
                _tag: "error" as const,
                message: "Error activating soul: Unexpected error",
              });
            }),
          ),
        );

        switch (result._tag) {
          case "success":
            ctx.ui.notify(
              `Now using soul: ${result.manifest.displayName} (level ${parsed.level}). This soul will auto-load in future sessions.`,
              "info",
            );
            pi.sendMessage(
              {
                customType: "soulspec",
                content: result.systemPrompt,
                display: true,
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
            break;
          case "error":
            ctx.ui.notify(result.message, "error");
            break;
        }
      } catch (error) {
        // Keep this outer catch as safety net for non-Effect failures (pi.sendMessage, etc.)
        ctx.ui.notify(`Error activating soul: ${String(error)}`, "error");
      }
    },
  });
}
