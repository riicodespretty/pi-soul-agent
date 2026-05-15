import { Effect } from "effect";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "./types";
import { SoulSpecLoader } from "./loader";
import { buildSystemPrompt } from "./system-prompt";

/**
 * Shared helper: query suggestion data when a soul is not found.
 */
export async function suggestSouls(
  runtime: AppRuntime,
  soulName: string,
): Promise<{ matches: string[]; all: string[] } | null> {
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const loader = yield* SoulSpecLoader;
        const matches = yield* loader.findMatchingSouls(new RegExp(soulName, "i"));
        const all = yield* loader.getAllSouls();
        return { matches, all };
      }),
    );
  } catch {
    return null;
  }
}

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
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            const soul = yield* loader.load(params.soul_name, params.level ?? 2);
            const systemPrompt = buildSystemPrompt(soul, params.level ?? 2);
            return { soul, systemPrompt };
          }),
          { signal },
        );

        return {
          content: [
            {
              type: "text",
              text: `Soul "${result.soul.display_name}" loaded successfully.\n\nSystem Prompt:\n${result.systemPrompt}`,
            },
          ],
          details: {
            soul: result.soul.name,
            prompt: result.systemPrompt,
            level: params.level ?? 2,
          },
        };
      } catch (error) {
        const errMsg = String(error);
        const soulName = params.soul_name;

        if (errMsg.includes("not found") || errMsg.includes("SoulNotFoundError")) {
          const suggestions = await suggestSouls(runtime, soulName);
          if (suggestions) {
            if (suggestions.matches.length > 0) {
              const matchList = suggestions.matches.slice(0, 5).join(", ");
              const hint =
                suggestions.matches.length > 5
                  ? ` (showing first 5 of ${suggestions.matches.length})`
                  : "";
              return {
                content: [
                  {
                    type: "text",
                    text: `No exact match found for "${soulName}". Did you mean one of these?\n\n${matchList}${hint}\n\nTry one of these exact names, or use a more specific pattern.`,
                  },
                ],
                details: {},
                isError: true,
              };
            }

            if (suggestions.all.length > 0) {
              const soulList = suggestions.all.slice(0, 10).join(", ");
              return {
                content: [
                  {
                    type: "text",
                    text: `No soul found matching "${soulName}".\n\nAvailable souls:\n\n${soulList}\n\nUse /souls to see all available souls, or try a partial match like 'dev' or 'assist'.`,
                  },
                ],
                details: {},
                isError: true,
              };
            }
          }
        }

        return {
          content: [{ type: "text", text: `Error loading soul: ${errMsg}` }],
          details: {},
          isError: true,
        };
      }
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
      try {
        const souls = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls();
          }),
          { signal },
        );

        if (souls.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No souls found. Create a souls/ directory with soul.json files.",
              },
            ],
            details: { souls: [] },
          };
        }

        // Build rich response with soul info
        let response = "Available souls:\n\n";
        for (const soulName of souls) {
          try {
            const manifest = await runtime.runPromise(
              Effect.gen(function* () {
                const loader = yield* SoulSpecLoader;
                return yield* loader.load(soulName, 1);
              }),
            );
            response += `- **${manifest.display_name}** (${soulName})\n`;
            response += `  ${manifest.description}\n`;
            if (manifest.disclosure?.summary) {
              response += `  ${manifest.disclosure.summary}\n`;
            }
            response += "\n";
          } catch {
            response += `- **${soulName}** (Error loading info)\n\n`;
          }
        }

        return {
          content: [{ type: "text", text: response }],
          details: { souls },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing souls: ${String(error)}` }],
          details: {},
          isError: true,
        };
      }
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
      try {
        const soul = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.load(params.soul_name, 1);
          }),
          { signal },
        );

        let info = `# ${soul.display_name}\n\n`;
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

        if (soul.recommended_skills.length > 0) {
          info += `\n**Recommended Skills:**\n`;
          for (const skill of soul.recommended_skills) {
            info += `- ${skill.name}${skill.required ? " (required)" : ""}\n`;
          }
        }

        if (soul.hardware_constraints) {
          info += `\n**Hardware Constraints:**\n`;
          const hc = soul.hardware_constraints;
          info += `- Display: ${hc.has_display ? "Yes" : "No"}\n`;
          info += `- Speaker: ${hc.has_speaker ? "Yes" : "No"}\n`;
          info += `- Microphone: ${hc.has_microphone ? "Yes" : "No"}\n`;
          info += `- Camera: ${hc.has_camera ? "Yes" : "No"}\n`;
          info += `- Mobility: ${hc.mobility}\n`;
          info += `- Manipulator: ${hc.manipulator ? "Yes" : "No"}\n`;
        }

        return {
          content: [{ type: "text", text: info }],
          details: { soul },
        };
      } catch (error) {
        const errMsg = String(error);

        if (errMsg.includes("not found") || errMsg.includes("SoulNotFoundError")) {
          const suggestions = await suggestSouls(runtime, params.soul_name);
          if (suggestions && suggestions.matches.length > 0) {
            const matchList = suggestions.matches.slice(0, 5).join(", ");
            return {
              content: [
                {
                  type: "text",
                  text: `No exact match found for "${params.soul_name}". Did you mean one of these?\n\n${matchList}\n\nTry one of these exact names, or use a more specific pattern.`,
                },
              ],
              details: {},
              isError: true,
            };
          }
        }

        return {
          content: [{ type: "text", text: `Error getting soul info: ${errMsg}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
