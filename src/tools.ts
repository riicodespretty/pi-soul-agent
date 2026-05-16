import { Cause, Effect } from "effect";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "@/src/types";
import { SoulSpecLoader } from "@/src/loader";
import { buildSystemPrompt } from "@/src/system-prompt";

/**
 * Register the `load_soul` tool.
 * Loads a SoulSpec persona and builds its system prompt.
 */
export function registerLoadSoulTool(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerTool({
    name: "load_soul",
    label: "Load Soul",
    description: "Load a SoulSpec persona and build system prompt. Supports partial matching.",
    parameters: Type.Object({
      soul_name: Type.String({
        description:
          "Name of the soul to load (directory name or path). Supports partial matching: 'dev' matches 'developer'",
      }),
      level: Type.Optional(
        Type.Number({
          description: "Progressive disclosure level (1-3, default 2)",
          default: 2,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      return await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const soul = yield* loader.load(params.soul_name, params.level ?? 2);
          const systemPrompt = buildSystemPrompt(soul, params.level ?? 2);
          return {
            content: [
              {
                type: "text" as const,
                text: `Soul "${soul.displayName}" loaded successfully.\n\nSystem Prompt:\n${systemPrompt}`,
              },
            ],
            details: {
              soul: soul.name,
              prompt: systemPrompt,
              level: params.level ?? 2,
            },
          };
        }).pipe(
          // SoulLoadError.message already contains user-friendly text with suggestions
          Effect.catchTag("SoulLoadError", (e) => {
            console.debug(`[tools] Error in load_soul: ${e.message}`);
            return Effect.succeed({
              content: [{ type: "text" as const, text: e.message }],
              details: {},
              isError: true,
            });
          }),
          Effect.catchAllCause((cause) => {
            if (Cause.isDieType(cause)) {
              console.error(`[tools] Defect in load_soul: ${Cause.pretty(cause)}`);
            } else {
              console.debug(`[tools] Error in load_soul: ${Cause.pretty(cause)}`);
            }
            return Effect.succeed({
              content: [{ type: "text" as const, text: "Error loading soul: Unexpected error" }],
              details: {},
              isError: true,
            });
          }),
        ),
        { signal },
      );
    },
  });
}

/**
 * Register the `list_souls` tool.
 * Lists all available SoulSpec personas with descriptions.
 */
export function registerListSoulsTool(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerTool({
    name: "list_souls",
    label: "List Souls",
    description: "List all available SoulSpec personas",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      return await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const entries = yield* loader.enumerateSouls();

          if (entries.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No souls found. Create a souls/ directory with soul.json files.",
                },
              ],
              details: { souls: [] },
            };
          }

          let response = "Available souls:\n\n";
          for (const entry of entries) {
            if (entry._tag === "loaded") {
              response += `- **${entry.manifest.displayName}** (${entry.name})\n`;
              response += `  ${entry.manifest.description}\n`;
              if (entry.manifest.disclosure?.summary) {
                response += `  ${entry.manifest.disclosure.summary}\n`;
              }
            } else {
              response += `- **${entry.name}** (Error: ${entry.reason})\n`;
            }
            response += "\n";
          }

          return {
            content: [{ type: "text" as const, text: response }],
            details: { souls: entries.map((e) => e.name) },
          };
        }),
        { signal },
      );
    },
  });
}

/**
 * Register the `soul_info` tool.
 * Gets detailed information about a soul.
 */
export function registerSoulInfoTool(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.registerTool({
    name: "soul_info",
    label: "Soul Info",
    description: "Get detailed information about a soul. Supports partial matching.",
    parameters: Type.Object({
      soul_name: Type.String({
        description:
          "Name of the soul to get info for. Supports partial matching: 'dev' matches 'developer'",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      return await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          const soul = yield* loader.load(params.soul_name, 1);

          let info = `# ${soul.displayName}\n\n`;
          info += `**Name:** ${soul.name}\n`;
          info += `**Version:** ${soul.version}\n`;
          info += `**Description:** ${soul.description}\n`;
          info += `**Author:** ${soul.author.name}\n`;
          info += `**License:** ${soul.license}\n`;
          info += `**Environment:** ${soul.environment}\n`;
          info += `**Category:** ${soul.category}\n`;
          info += `**Tags:** ${soul.tags.join(", ")}\n`;

          if (soul.disclosure?.summary) {
            info += `**Summary:** ${soul.disclosure.summary}\n`;
          }

          if (soul.recommendedSkills.length > 0) {
            info += `\n**Recommended Skills:**\n`;
            for (const skill of soul.recommendedSkills) {
              info += `- ${skill.name}${skill.required ? " (required)" : ""}\n`;
            }
          }

          if (soul.hardwareConstraints) {
            info += `\n**Hardware Constraints:**\n`;
            const hc = soul.hardwareConstraints;
            info += `- Display: ${hc.hasDisplay ? "Yes" : "No"}\n`;
            info += `- Speaker: ${hc.hasSpeaker ? "Yes" : "No"}\n`;
            info += `- Microphone: ${hc.hasMicrophone ? "Yes" : "No"}\n`;
            info += `- Camera: ${hc.hasCamera ? "Yes" : "No"}\n`;
            info += `- Mobility: ${hc.mobility}\n`;
            info += `- Manipulator: ${hc.manipulator ? "Yes" : "No"}\n`;
          }

          return {
            content: [{ type: "text" as const, text: info }],
            details: { soul },
          };
        }).pipe(
          // SoulLoadError.message already contains user-friendly text with suggestions
          Effect.catchTag("SoulLoadError", (e) => {
            console.debug(`[tools] Error in soul_info: ${e.message}`);
            return Effect.succeed({
              content: [{ type: "text" as const, text: e.message }],
              details: {},
              isError: true,
            });
          }),
          Effect.catchAllCause((cause) => {
            if (Cause.isDieType(cause)) {
              console.error(`[tools] Defect in soul_info: ${Cause.pretty(cause)}`);
            } else {
              console.debug(`[tools] Error in soul_info: ${Cause.pretty(cause)}`);
            }
            return Effect.succeed({
              content: [
                { type: "text" as const, text: "Error getting soul info: Unexpected error" },
              ],
              details: {},
              isError: true,
            });
          }),
        ),
        { signal },
      );
    },
  });
}
