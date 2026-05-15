import { Cause, Effect, Option } from "effect";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "@/src/types";
import { SoulSpecLoader } from "@/src/loader";
import { ActiveSoulPersistence } from "@/src/persistence";
import { expandHome } from "@/src/services/soul-fs";
import { buildSystemPrompt } from "@/src/system-prompt";

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

    await runtime.runPromise(
      Effect.gen(function* () {
        const persistence = yield* ActiveSoulPersistence;
        const activeSoul = yield* persistence.load();

        if (Option.isSome(activeSoul)) {
          const soul = activeSoul.value;
          const soulName = soul.soul;
          const level = soul.level;

          // Preload the persisted active soul
          const loader = yield* SoulSpecLoader;
          yield* loader.load(soulName, level);

          if (ctx.hasUI) {
            ctx.ui.notify(`Soul auto-loaded: ${soulName}`, "info");
          }
        } else {
          // No active soul — check if any souls are available
          const loader = yield* SoulSpecLoader;
          const souls = yield* loader.getAllSouls();
          if (souls.length > 0 && event.reason === "startup" && ctx.hasUI) {
            ctx.ui.notify(
              `🪷 Souls available (${souls.length}). Use /soul <name> to activate one.`,
              "info",
            );
          }
        }
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() =>
            console.debug(`[events] Error in session_start: ${Cause.pretty(cause)}`),
          ),
        ),
      ),
    );
  });
}

/**
 * Register the `resources_discover` event handler.
 * Returns soul directories as prompt paths for resource discovery.
 */
export function registerResourcesDiscoverHandler(pi: ExtensionAPI, _runtime: AppRuntime): void {
  pi.on("resources_discover", async (_event, _ctx) => {
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
  });
}

/**
 * Register the `before_agent_start` event handler.
 * Injects active soul prompt appended to the base system prompt.
 */
export function registerBeforeAgentStartHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.on("before_agent_start", async (event, _ctx) => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const persistence = yield* ActiveSoulPersistence;
        const activeSoul = yield* persistence.load();

        if (!Option.isSome(activeSoul)) return;

        const soul = activeSoul.value;
        const soulName = soul.soul;
        const level = soul.level;
        const loader = yield* SoulSpecLoader;
        const manifest = yield* loader.load(soulName, level);
        const systemPrompt = buildSystemPrompt(manifest, level);

        // Append soul prompt to base system prompt (matching reference behavior)
        const enhancedPrompt = event.systemPrompt
          ? `${event.systemPrompt}\n\n---\n${systemPrompt}`
          : systemPrompt;

        return { systemPrompt: enhancedPrompt };
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() =>
            console.debug(`[events] Error in before_agent_start: ${Cause.pretty(cause)}`),
          ),
        ),
      ),
    );
    return result;
  });
}
