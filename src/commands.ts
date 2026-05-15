import { Cause, Effect } from "effect";
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
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const souls = yield* loader.getAllSouls();

          if (souls.length === 0) {
            return { _tag: "empty" as const };
          }

          let message = "Available souls:\n\n";
          for (const soul of souls) {
            const manifest = yield* loader
              .load(soul, 1)
              .pipe(Effect.catchAllCause(() => Effect.succeed(null)));
            if (manifest) {
              message += `• **${manifest.display_name}** (${soul})\n`;
              message += `  ${manifest.description}\n`;
              if (manifest.disclosure?.summary) {
                message += `  ${manifest.disclosure.summary}\n`;
              }
            } else {
              message += `• **${soul}** (Error: unable to load)\n\n`;
            }
            message += "\n";
          }

          return { _tag: "souls" as const, message };
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              console.debug(`[commands] Error in /souls: ${Cause.pretty(cause)}`),
            ).pipe(
              Effect.andThen(
                Effect.succeed({
                  _tag: "error" as const,
                  message: `Error listing souls: Unexpected error`,
                }),
              ),
            ),
          ),
        ),
      );

      switch (result._tag) {
        case "empty":
          ctx.ui.notify("No souls found. Create a souls/ directory with soul.json files.", "info");
          break;
        case "souls":
          ctx.ui.notify(result.message, "info");
          break;
        case "error":
          ctx.ui.notify(result.message, "error");
          break;
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
      return await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const souls = yield* loader.getAllSouls();
          return souls
            .filter((s: string) => s.startsWith(prefix))
            .map((s: string) => ({
              value: s,
              label: s,
              description: `Load soul: ${s}`,
            }));
        }).pipe(Effect.catchAllCause(() => Effect.succeed(null))),
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
            Effect.catchAllCause((cause) =>
              Effect.sync(() =>
                console.debug(`[commands] Error deactivating soul: ${Cause.pretty(cause)}`),
              ).pipe(
                Effect.andThen(
                  Effect.succeed({
                    _tag: "error" as const,
                    message: `Error deactivating soul: Unexpected error`,
                  }),
                ),
              ),
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
            return yield* loader.getAllSouls();
          }).pipe(Effect.catchAllCause(() => Effect.succeed([]))),
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
            return { _tag: "success" as const, manifest, systemPrompt };
          }).pipe(
            Effect.catchTag("SoulNotFoundError", (_error) =>
              Effect.gen(function* () {
                const suggestions = yield* Effect.promise(() =>
                  suggestSouls(runtime, parsed.soulName!),
                );
                if (suggestions) {
                  if (suggestions.matches.length > 0) {
                    return {
                      _tag: "suggest" as const,
                      message: `No exact match found for "${parsed.soulName}". Did you mean one of these?\n\n${suggestions.matches.slice(0, 5).join(", ")}\n\nTry one of these exact names, or use a more specific pattern.`,
                    };
                  }
                  if (suggestions.all.length > 0) {
                    return {
                      _tag: "suggest" as const,
                      message: `No soul found matching "${parsed.soulName}".\n\nAvailable souls:\n\n${suggestions.all.slice(0, 10).join(", ")}\n\nUse /souls to see all available souls.`,
                    };
                  }
                }
                return {
                  _tag: "suggest" as const,
                  message: `No soul found matching "${parsed.soulName}".`,
                };
              }),
            ),
            Effect.catchAllCause((cause) =>
              Effect.sync(() =>
                console.debug(`[commands] Error activating soul: ${Cause.pretty(cause)}`),
              ).pipe(
                Effect.andThen(
                  Effect.succeed({
                    _tag: "error" as const,
                    message: `Error activating soul: Unexpected error`,
                  }),
                ),
              ),
            ),
          ),
        );

        switch (result._tag) {
          case "success":
            ctx.ui.notify(
              `Now using soul: ${result.manifest.display_name} (level ${parsed.level}). This soul will auto-load in future sessions.`,
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
          case "suggest":
            ctx.ui.notify(result.message, "warning");
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
