import { Effect, Option } from "effect";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "./types";
import { SoulSpecLoader } from "./loader";
import { ActiveSoulPersistence } from "./persistence";
import { expandHome } from "./services/soul-fs";
import { buildSystemPrompt } from "./system-prompt";

/** Local type since ResourcesDiscoverResult is not re-exported from pi-coding-agent */
interface ResourcesDiscoverResult {
  promptPaths?: string[];
}

/**
 * Register the `session_start` event handler.
 * Checks for a persisted active soul and preloads it on startup/new sessions.
 */
export function registerSessionStartHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.on("session_start", async (event, ctx) => {
    // Only preload on fresh sessions (matching reference behavior)
    if (event.reason !== "startup" && event.reason !== "new") return;

    try {
      const activeSoul = await runtime.runPromise(
        Effect.gen(function* () {
          const persistence = yield* ActiveSoulPersistence;
          return yield* persistence.load();
        }),
      );

      if (Option.isSome(activeSoul)) {
        const soul = activeSoul.value;
        const soulName = soul.soul;
        const level = soul.level;

        // Preload the persisted active soul
        await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            yield* loader.load(soulName, level);
          }),
        );

        if (ctx.hasUI) {
          ctx.ui.notify(`Soul auto-loaded: ${soulName}`, "info");
        }
      } else {
        // No active soul — check if any souls are available
        const souls = await runtime.runPromise(
          Effect.gen(function* () {
            const loader = yield* SoulSpecLoader;
            return yield* loader.getAllSouls();
          }),
        );
        if (souls.length > 0 && event.reason === "startup" && ctx.hasUI) {
          ctx.ui.notify(
            `🪷 Souls available (${souls.length}). Use /soul <name> to activate one.`,
            "info",
          );
        }
      }
    } catch (error) {
      console.debug(`[events] Error in session_start: ${String(error)}`);
    }
  });
}

/**
 * Register the `resources_discover` event handler.
 * Returns soul directories as prompt paths for resource discovery.
 */
export function registerResourcesDiscoverHandler(pi: ExtensionAPI, _runtime: AppRuntime): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    try {
      // Order matches reference: project-local first, then global
      const result: ResourcesDiscoverResult = {
        promptPaths: [
          ".pi/souls",
          "./souls",
          expandHome("~/.pi/agent/souls"),
          expandHome("~/.openclaw/souls/clawsouls"),
        ],
      };
      return result;
    } catch (error) {
      console.debug(`[events] Error in resources_discover: ${String(error)}`);
      return { promptPaths: [] };
    }
  });
}

/**
 * Register the `before_agent_start` event handler.
 * Injects active soul prompt appended to the base system prompt.
 */
export function registerBeforeAgentStartHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.on("before_agent_start", async (event, _ctx) => {
    try {
      const activeSoul = await runtime.runPromise(
        Effect.gen(function* () {
          const persistence = yield* ActiveSoulPersistence;
          return yield* persistence.load();
        }),
      );

      if (!Option.isSome(activeSoul)) return;

      const soul = activeSoul.value;
      const soulName = soul.soul;
      const level = soul.level;

      const manifest = await runtime.runPromise(
        Effect.gen(function* () {
          const loader = yield* SoulSpecLoader;
          return yield* loader.load(soulName, level);
        }),
      );

      const systemPrompt = buildSystemPrompt(manifest, level);

      // Append soul prompt to base system prompt (matching reference behavior)
      const enhancedPrompt = event.systemPrompt
        ? `${event.systemPrompt}\n\n---\n${systemPrompt}`
        : systemPrompt;

      return {
        systemPrompt: enhancedPrompt,
      };
    } catch (error) {
      console.debug(`[events] Error in before_agent_start: ${String(error)}`);
      return;
    }
  });
}
