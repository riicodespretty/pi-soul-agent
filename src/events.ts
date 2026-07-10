import { Cause, Effect, Option, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime } from "./types";
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
 * _heartbeatCoordinator is an insurance policy against multiple closures (Pi
 * loads extensions via jiti with moduleCache:false, creating separate closures
 * each with independent counters). Only the first closure to reach a given
 * activation-anchored beat sends the heartbeat; the rest skip. The key is the
 * activation identity plus the beat's turn-count — NOT a session-absolute turn —
 * so it stays correct as the schedule re-anchors on each activation.
 */
const _heartbeatCoordinator = { servicedKey: null as string | null };

/**
 * The cadence gap lists, prefix-summed from the Activation anchor to get the
 * beats (count 0 = activation, no fire). Only the anchor point and `full`'s
 * shape changed (ADR-0001); `off`/`lite` are as before.
 *
 * `off` never fires. `lite` fires every 6 turns. `full` is a ramp-then-plateau:
 * the mala factors [6, 3, 2, 3] are cumulative POSITIONS (prefix products)
 * 6, 18, 36, 108 — NOT repeating gaps — so the gap list is [6, 12, 18, 72, 108];
 * after the ramp the schedule holds at a steady +108 pulse (108 = 6 × 3 × 2 × 3,
 * the full klesha count). Frequent early grounding tapering to a calm plateau.
 *
 * The plateau is produced by CLAMPING the advance at the last gap (see below),
 * so the final entry (108) repeats forever. A single-entry list (`lite`) is the
 * degenerate case: it clamps immediately and repeats that one gap. A custom
 * positive integer mode N is the same degenerate shape — the gap list is [N],
 * so it fires every N turns from the Activation anchor.
 */
const HEARTBEAT_INTERVALS: Record<"off" | "lite" | "full", readonly number[]> = {
  off: [],
  lite: [6],
  full: [6, 12, 18, 72, 108],
};

/**
 * Register the `turn_end` event handler for the heartbeat reminder.
 *
 * Every cadence is measured from the Activation anchor — the turn on which a
 * Soul becomes active — not from session start (ADR-0001). Each turn the handler
 * reads the Active Soul identity (`soul` + `updatedAt`); when it changes, the
 * turn count resets to 0 and the schedule restarts. The activation turn is
 * count 0 and does not itself fire; the first `lite` beat lands 6 turns later.
 *
 * Nothing counts while no Soul is active, so a scheduled turn reached while
 * inactive can no longer freeze the schedule — the session-long wedge of
 * issue #1 is structurally impossible, not merely patched. This supersedes the
 * session-absolute counter and the tick-while-inactive workaround (c8b46f9).
 *
 * Changing a Soul's level or heartbeat mode bumps `updatedAt`, re-anchoring the
 * schedule (a deliberate "re-onboard" from the next turn). Reminders fire only
 * for an active, Level-3 Soul with heartbeat content, and stay hidden from the
 * visible conversation.
 */
export function registerHeartbeatReminderHandler(pi: ExtensionAPI, runtime: AppRuntime): void {
  // Activation-anchored scheduler state. `currentIdentity` is the Active Soul
  // identity we are anchored to (null = none active); `count` is turns since the
  // anchor (0 = the activation turn); `intervalIndex`/`nextTurnAt` walk the beats.
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
      // Activation identity: the Soul name plus its updatedAt. Any level or
      // heartbeat-mode change bumps updatedAt, so identity change re-anchors.
      const identity = `${soul.soul}@${soul.updatedAt}`;
      const mode = soul.heartbeatMode ?? ("lite" as const);

      // The Level-3 + content gate. Disabled, below Level 3, or with no
      // heartbeat content, the Soul is present (it still anchors the schedule)
      // but has nothing to send.
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

    // Advance to the next beat, CLAMPING the index at the last gap so the final
    // entry repeats forever: `full` ramps (6, 12, 18, 72) then holds at +108;
    // `lite` (one entry) repeats its single gap. Runs whether or not we actually
    // send, keeping the cadence ticking.
    intervalIndex = Math.min(intervalIndex + 1, intervals.length - 1);
    nextTurnAt += intervals[intervalIndex];

    // Only an active, Level-3 Soul with heartbeat content actually sends.
    if (result.content === null) return;

    // Module-level dedup: if a sibling closure already serviced this exact
    // activation-anchored beat, skip the send. Keyed on identity + count (not a
    // session-absolute turn), and recorded only AFTER an actual send.
    const beatKey = `${result.identity}#${count}`;
    if (_heartbeatCoordinator.servicedKey === beatKey) return;
    _heartbeatCoordinator.servicedKey = beatKey;

    // No deliverAs option: when the agent is idle (not streaming), this appends
    // immediately to agent.state.messages and persists to the session, rather
    // than queueing in _pendingNextTurnMessages to be flushed on the next user
    // message. Wrap in XML tags so the LLM can distinguish this as an automatic
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
