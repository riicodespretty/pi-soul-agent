import { Cause, Effect, Option, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, HeartbeatMode } from "./types";
import { SOUL_SEARCH_PATHS, SoulSpecLoader } from "./loader";
import { ActiveSoulPersistence } from "./persistence";
import { expandHome } from "./services/soul-fs";
import { buildSystemPrompt } from "./system-prompt";
import { notifyUI } from "./helpers/notify-ui";

/** Local type since ResourcesDiscoverResult is not re-exported from pi-coding-agent */
interface ResourcesDiscoverResult {
  promptPaths?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Heartbeat Reminder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * _heartbeatCoordinator is an insurance policy against multiple closures
 * (Pi loads extensions via jiti with moduleCache:false, creating separate
 * closures each with independent counters). Only the first closure to
 * reach a matching turn sends the heartbeat; the rest skip.
 */
const _heartbeatCoordinator = { servicedAtTurn: -1 };

/**
 * Register event handlers for the heartbeat reminder.
 *
 * Injects the active soul's heartbeat content as a reminder at intervals
 * following a Buddhist mala: 6 (senses) → 3 (feelings) → 2 (states) → 3 (times),
 * cycling across the full session.
 *
 * The mala cycles through 6 Senses → 3 Feelings → 2 States → 3 Times,
 * which together multiply to 108 — the classic Buddhist mala count.
 * The counter persists across the full session (reset on `session_start`),
 * so each turn throughout the conversation advances the mala.
 *
 * First heartbeat at turn 6 — spacious enough to ground into the work
 * before the first check-in arrives.
 */
export function registerHeartbeatReminderHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  let intervalIndex = 0;
  let nextTurnAt = 6;
  let totalTurns = 0;

  pi.on("session_start", async () => {
    intervalIndex = 0;
    nextTurnAt = 6;
    totalTurns = 0;
  });

  pi.on("turn_end", async (_event, ctx) => {
    totalTurns++;
    if (totalTurns !== nextTurnAt) return;

    // Module-level dedup: if another closure already sent a heartbeat
    // at this turn, skip. The coordinator is shared across ALL closures.
    if (_heartbeatCoordinator.servicedAtTurn >= totalTurns) return;
    _heartbeatCoordinator.servicedAtTurn = totalTurns;

    const heartbeatPipeline = Effect.gen(function* () {
      const persistence = yield* ActiveSoulPersistence;
      const activeSoul = yield* persistence.load();
      if (!Option.isSome(activeSoul)) return { active: false as const };

      const soul = activeSoul.value;

      // Eager exit: if heartbeat is disabled in persistence, skip entirely
      if (soul.heartbeatMode === "off") return { active: false as const };

      // heartbeatContent is only available at level >= 3
      if (soul.level < 3) return { active: false as const };

      const loader = yield* SoulSpecLoader;
      const manifest = yield* loader.getSoul(soul.soul, soul.level);

      const content = Option.fromNullable(manifest.heartbeatContent);
      if (Option.isNone(content)) return { active: false as const };

      return {
        active: true as const,
        content: content.value,
        // Use heartbeat mode from persisted settings (default "lite" = single interval)
        mode: soul.heartbeatMode ?? ("lite" as const),
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

    if (!result.active) return;

    // Advance the mala based on heartbeat mode
    // lite: single 6-interval (every 6 turns)
    // full: full mala cycle [6, 3, 2, 3]
    const HEARTBEAT_INTERVALS: Record<HeartbeatMode, readonly number[]> = {
      off: [],
      lite: [6],
      full: [6, 3, 2, 3],
    };
    const intervals = HEARTBEAT_INTERVALS[result.mode];
    if (intervals.length === 0) return; // off mode — no heartbeat
    intervalIndex = (intervalIndex + 1) % intervals.length;
    nextTurnAt += intervals[intervalIndex];

    // No deliverAs option: when the agent is idle (not streaming), this
    // appends immediately to agent.state.messages and persists to the session,
    // rather than queueing in _pendingNextTurnMessages to be flushed on the
    // next user message.
    // Wrap in XML tags so the LLM can distinguish this as an automatic
    // system reminder rather than a direct user message.
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
