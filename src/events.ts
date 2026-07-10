import { Cause, Effect, Option, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "./types";
import { SOUL_SEARCH_PATHS, SoulSpecLoader } from "./loader";
import { ActiveSoulPersistence } from "./persistence";
import { expandHome } from "./services/soul-fs";
import { buildSystemPrompt } from "./system-prompt";
import { notifyUI } from "./helpers/notify-ui";

interface ResourcesDiscoverResult {
  promptPaths?: string[];
}

const _heartbeatCoordinator = { servicedKey: null as string | null };

const HEARTBEAT_INTERVALS: Record<"off" | "lite" | "full", readonly number[]> = {
  off: [],
  lite: [6],
  full: [6, 12, 18, 72, 108],
};

export function registerHeartbeatReminderHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  let currentIdentity: string | null = null;
  let count = 0;
  let intervalIndex = 0;
  let nextTurnAt = 0;

  pi.on("turn_end", async (_event, ctx) => {
    const heartbeatPipeline = Effect.gen(function* () {
      const persistence = yield* ActiveSoulPersistence;
      const activeSoul = yield* persistence.load();
      if (!Option.isSome(activeSoul)) return { present: false as const };

      const soul = activeSoul.value;
      const identity = `${soul.soul}@${soul.updatedAt}`;
      const mode = soul.heartbeatMode ?? ("lite" as const);

      // Rationale [2] → git notes docs-code-rationale: docs/rationale/events.md
      if (mode === "off" || soul.level < 3) {
        return { present: true as const, identity, mode, content: null };
      }

      const loader = yield* SoulSpecLoader;
      const manifest = yield* loader.getSoul(soul.soul, soul.level);
      const content = Option.fromNullable(manifest.heartbeatContent);

      return {
        present: true as const,
        identity,
        mode,
        content: Option.isNone(content) ? null : content.value,
      };
    });

    const result = await runtime.runPromise(
      Effect.matchCause(heartbeatPipeline, {
        onSuccess: (value) => ({ _tag: "success" as const, ...value }),
        onFailure: (cause) => ({
          _tag: "error" as const,
          message: `Heartbeat reminder error: ${Cause.pretty(cause)}`,
        }),
      }),
    );

    if (result._tag === "error") {
      notifyUI(ctx, result.message, "warning");
      return;
    }

    // No active Soul: nothing counts. Drop the anchor so the next activation
    // starts a fresh schedule from count 0.
    if (!result.present) {
      currentIdentity = null;
      return;
    }

    // New activation identity → re-anchor: the activation turn is count 0 (no
    // fire) and the schedule restarts at the first beat.
    if (result.identity !== currentIdentity) {
      currentIdentity = result.identity;
      count = 0;
      intervalIndex = 0;
      // A custom integer mode N is the degenerate gap list [N]; mode words look up
      // their prefix-summed beats.
      const intervals =
        typeof result.mode === "number" ? [result.mode] : HEARTBEAT_INTERVALS[result.mode];
      nextTurnAt = intervals.length > 0 ? intervals[0] : 0;
      return;
    }

    // Same activation: advance the count and act only on a scheduled beat.
    count++;
    const intervals =
      typeof result.mode === "number" ? [result.mode] : HEARTBEAT_INTERVALS[result.mode];
    if (intervals.length === 0 || count !== nextTurnAt) return;

    // Rationale [3] → git notes docs-code-rationale: docs/rationale/events.md
    intervalIndex = Math.min(intervalIndex + 1, intervals.length - 1);
    nextTurnAt += intervals[intervalIndex];

    // Only an active, Level-3 Soul with heartbeat content actually sends.
    if (result.content === null) return;

    // Rationale [4] → git notes docs-code-rationale: docs/rationale/events.md
    const beatKey = `${result.identity}#${count}`;
    if (_heartbeatCoordinator.servicedKey === beatKey) return;
    _heartbeatCoordinator.servicedKey = beatKey;

    // Rationale [5] → git notes docs-code-rationale: docs/rationale/events.md
    pi.sendMessage({
      customType: "soul-heartbeat-reminder",
      content: `<soul-heartbeat-reminder type="grounding" no-response>\n${result.content}\n</soul-heartbeat-reminder>`,
      display: false,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Start
// ═══════════════════════════════════════════════════════════════════════════

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
        notifyUI(ctx, `Soul auto-loaded: ${result.displayName}`, "info");
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
