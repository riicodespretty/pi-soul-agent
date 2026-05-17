import { Cause, Effect, Option, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "@/src/types";
import { SOUL_SEARCH_PATHS, SoulSpecLoader } from "@/src/loader";
import { ActiveSoulPersistence } from "@/src/persistence";
import { expandHome } from "@/src/services/soul-fs";
import { buildSystemPrompt } from "@/src/system-prompt";
import { notifyUI } from "@/src/helpers/notify-ui";

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
    if (event.reason !== "startup" && event.reason !== "new") return;

    const preloadPipeline = Effect.gen(function* () {
      const persistence = yield* ActiveSoulPersistence;
      const activeSoul = yield* persistence.load();

      if (Option.isSome(activeSoul)) {
        const soul = activeSoul.value;
        const loader = yield* SoulSpecLoader;
        const result = yield* loader.getSoul(soul.soul, soul.level);
        notifyUI(ctx, `Soul auto-loaded: ${result.name}`, "info");
      } else {
        const loader = yield* SoulSpecLoader;
        const souls = yield* loader.listSouls();
        pipe(
          souls,
          Option.liftPredicate((s) => s.length > 0),
          Option.match({
            onNone: () =>
              notifyUI(
                ctx,
                "No souls found. Create a souls/ directory with soul.json files.",
                "error",
              ),
            onSome: (s) =>
              notifyUI(
                ctx,
                `Souls available (${s.length}). Use /soul <name> to activate one.`,
                "info",
              ),
          }),
        );
      }
    });

    const result = await runtime.runPromise(
      Effect.matchCause(preloadPipeline, {
        onSuccess: () => ({ _tag: "success" as const }),
        onFailure: (cause) => ({
          _tag: "error" as const,
          message: `Error in session_start: ${Cause.pretty(cause)}`,
        }),
      }),
    );

    if (result._tag === "error") {
      notifyUI(ctx, result.message, "error");
    }
  });
}

/**
 * Register the `resources_discover` event handler.
 * Returns soul directories as prompt paths for resource discovery.
 */
export function registerResourcesDiscoverHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.on("resources_discover", async (_event, ctx) => {
    const discoverResourcesPipeline = Effect.gen(function* () {
      const fs = yield* FileSystem;
      const promptPaths = [];

      for (const base of SOUL_SEARCH_PATHS) {
        const resolvedBase = yield* expandHome(base);
        const exists = yield* fs.exists(resolvedBase);
        if (exists) promptPaths.push(resolvedBase);
      }

      return promptPaths;
    });

    const result = await runtime.runPromise(
      Effect.matchCause(discoverResourcesPipeline, {
        onSuccess: (promptPaths) => ({ _tag: "success" as const, promptPaths }),
        onFailure: (cause) => ({
          _tag: "error" as const,
          message: `Error injecting soul prompt: ${Cause.pretty(cause)}`,
        }),
      }),
    );

    if (result._tag === "error") {
      notifyUI(ctx, result.message, "error");
      return;
    }

    const resources: ResourcesDiscoverResult = {
      promptPaths: result.promptPaths,
    };

    return resources;
  });
}

/**
 * Register the `before_agent_start` event handler.
 * Injects active soul prompt appended to the base system prompt.
 */
export function registerBeforeAgentStartHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const beforeAgentPipeline = Effect.gen(function* () {
      const persistence = yield* ActiveSoulPersistence;
      const activeSoul = yield* persistence.load();
      if (!Option.isSome(activeSoul)) return { systemPrompt: event.systemPrompt };

      const soul = activeSoul.value;
      const loader = yield* SoulSpecLoader;
      const manifest = yield* loader.getSoul(soul.soul, soul.level);

      const systemPrompt = buildSystemPrompt(manifest, soul.level);
      return {
        systemPrompt: event.systemPrompt
          ? `${event.systemPrompt}\n\n---\n${systemPrompt}`
          : systemPrompt,
      };
    });

    const result = await runtime.runPromise(
      Effect.matchCause(beforeAgentPipeline, {
        onSuccess: ({ systemPrompt }) => ({ _tag: "success" as const, systemPrompt }),
        onFailure: (cause) => ({
          _tag: "error" as const,
          message: `Error injecting soul prompt: ${Cause.pretty(cause)}`,
        }),
      }),
    );

    if (result._tag === "error") {
      notifyUI(ctx, result.message, "error");
      return;
    }

    return { systemPrompt: result.systemPrompt };
  });
}
