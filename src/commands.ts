import { Effect } from "effect";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "./types";
import { SoulSpecLoader } from "./loader";
import { suggestSouls } from "./tools";
import { ActiveSoulPersistence } from "./persistence";
import { buildSystemPrompt } from "./system-prompt";

/**
 * Register the `/souls` command.
 * Lists all available souls via UI notification.
 */
export function registerSoulsCommand(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerCommand("souls", {
    description: "List all available SoulSpec personas",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls();
          }),
        );

        if (result.length === 0) {
          ctx.ui.notify("No souls found. Create a souls/ directory with soul.json files.", "info");
          return;
        }

        let message = "Available souls:\n\n";
        for (const soul of result) {
          try {
            const manifest = await runtime.runPromise(
              Effect.gen(function* () {
                const loader = yield* SoulSpecLoader;
                return yield* loader.load(soul, 1);
              }),
            );
            message += `• **${manifest.display_name}** (${soul})\n`;
            message += `  ${manifest.description}\n`;
            if (manifest.disclosure?.summary) {
              message += `  ${manifest.disclosure.summary}\n`;
            }
            message += "\n";
          } catch {
            message += `• **${soul}** (Error: unable to load)\n\n`;
          }
        }

        ctx.ui.notify(message, "info");
      } catch (error) {
        ctx.ui.notify(`Error listing souls: ${String(error)}`, "error");
      }
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
      try {
        const souls = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls();
          }),
        );

        return souls
          .filter((s: string) => s.startsWith(prefix))
          .map((s: string) => ({
            value: s,
            label: s,
            description: `Load soul: ${s}`,
          }));
      } catch {
        return null;
      }
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
        try {
          await runtime.runPromise(
            Effect.gen(function* () {
              const persistence = yield* ActiveSoulPersistence;
              yield* persistence.clear();
            }),
          );
          ctx.ui.notify("Soul deactivated. No soul will auto-load in future sessions.", "info");
        } catch (error) {
          ctx.ui.notify(`Error deactivating soul: ${String(error)}`, "error");
        }
        return;
      }

      // Activate
      if (!parsed.soulName) {
        const souls = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls();
          }),
        );
        let msg = "Usage: /soul <soul-name>\n\nAvailable souls:\n";
        for (const s of souls) {
          msg += `\n  • **${s}**`;
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
            return { manifest, systemPrompt };
          }),
        );

        ctx.ui.notify(
          `Now using soul: ${result.manifest.display_name} (level ${parsed.level}). This soul will auto-load in future sessions.`,
          "info",
        );

        // Inject system message via pi.sendMessage (imperative, outside Effect.gen)
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
      } catch (error) {
        // Provide error suggestions (matching reference behavior)
        const errMsg = String(error);
        if (errMsg.includes("not found") || errMsg.includes("SoulNotFoundError")) {
          const suggestions = await suggestSouls(runtime, parsed.soulName!);
          if (suggestions) {
            if (suggestions.matches.length > 0) {
              ctx.ui.notify(
                `No exact match found for "${parsed.soulName}". Did you mean one of these?\n\n${suggestions.matches.slice(0, 5).join(", ")}\n\nTry one of these exact names, or use a more specific pattern.`,
                "warning",
              );
              return;
            }

            if (suggestions.all.length > 0) {
              ctx.ui.notify(
                `No soul found matching "${parsed.soulName}".\n\nAvailable souls:\n\n${suggestions.all.slice(0, 10).join(", ")}\n\nUse /souls to see all available souls.`,
                "warning",
              );
              return;
            }
          }
        }

        ctx.ui.notify(`Error activating soul: ${errMsg}`, "error");
      }
    },
  });
}
