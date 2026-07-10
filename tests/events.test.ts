import { describe, it, expect } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, HeartbeatMode } from "../src/types";

// ═══════════════════════════════════════════════════════════════════════════
// registerHeartbeatReminderHandler — activation-anchored regression harness
// ═══════════════════════════════════════════════════════════════════════════
//
// The scheduler state (currentIdentity / count / nextTurnAt) lives in a closure
// created inside registerHeartbeatReminderHandler and is reachable only through
// the pi.on("turn_end", ...) callback — there is no exported pure unit. So we
// drive the REAL handler: a fake `pi` records handlers and captures sendMessage,
// and a fake `runtime` scripts runPromise's final result shape per turn. This
// exercises the true closure/bug site.
//
// Model under test (ADR-0001): every cadence is measured from the Activation
// anchor, not session start. Each turn the handler reads the Active Soul
// identity (soul + updatedAt); when it changes, the count resets to 0 (the
// activation turn does NOT fire) and the schedule restarts. Nothing counts while
// inactive, so a scheduled turn reached while inactive can no longer wedge the
// session (issue #1 is structurally impossible, not merely patched).
//
// The handler also consults a MODULE-LEVEL singleton (`_heartbeatCoordinator`)
// that is not exported and cannot be reset from outside. We therefore reset the
// module registry and re-import the handler for each test to get a fresh
// coordinator. This is the sanctioned "module loading boundary" exception to the
// static-import rule (the source intentionally exposes no reset seam).

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

/** The members of ExtensionAPI.sendMessage's payload we assert on. */
interface SentMessage {
  customType?: string;
  content?: string;
  display?: boolean;
}

/** Signature of the export under test — re-imported fresh per test (see header). */
type RegisterHeartbeat = (pi: ExtensionAPI, runtime: AppRuntime) => void;

let registerHeartbeatReminderHandler: RegisterHeartbeat;

beforeEach(async () => {
  vi.resetModules();
  // Test-case exception to the static-import rule (ts-no-dynamic-import): we need
  // a FRESH module instance per test to reset the module-level
  // _heartbeatCoordinator singleton, for which the source intentionally exposes
  // no reset seam. The specifier is a literal; the type comes from the static
  // `import type` above.
  const mod = await import("../src/events");
  registerHeartbeatReminderHandler = mod.registerHeartbeatReminderHandler;
});

/** The Active Soul as persistence would report it on a given turn (null = none). */
interface SoulState {
  soul: string;
  updatedAt: number;
  level: number;
  mode: HeartbeatMode;
}

/**
 * Build the final runPromise result shape for a per-turn soul state. It is a
 * SUPERSET consumed by both schedulers, so the same fixture drives the pre-rework
 * (session-absolute) closure through its REAL logic and the reworked
 * (activation-anchored) closure through its real logic — the RED run then shows
 * the old scheduler firing at the wrong TURNS, not a shape mismatch:
 *   - `active` + `mode` + `content` — read by the session-absolute closure.
 *   - `present` + `identity` + `mode` + `content` — read by the activation-anchored closure.
 * A soul is "fireable" (has content) only when Level-3 with a cadence set — the
 * Level-3 + content gate common to both.
 */
function resultFor(s: SoulState | null) {
  if (s === null) {
    return { _tag: "success" as const, present: false as const, active: false as const };
  }
  const identity = `${s.soul}@${s.updatedAt}`;
  const fireable = s.mode !== "off" && s.level >= 3;
  return {
    _tag: "success" as const,
    present: true as const,
    active: fireable,
    identity,
    mode: s.mode,
    content: fireable ? "HB" : null,
  };
}

/**
 * Register the real handler with fakes, drive `turns` turn_end events feeding the
 * per-turn soul state, and record which turns emitted a heartbeat. Boundary casts
 * (`as unknown as T`) hand the closure minimal fakes satisfying only the members
 * it touches (pi.on / pi.sendMessage ; runtime.runPromise).
 */
async function drive(
  turns: number,
  stateAt: (turn: number) => SoulState | null,
): Promise<{ firedAt: number[]; sent: SentMessage[] }> {
  const handlers: Record<string, Handler[]> = {};
  const sent: SentMessage[] = [];
  let current: SoulState | null = null;

  const fakePi = {
    on(event: string, handler: Handler) {
      (handlers[event] ??= []).push(handler);
    },
    sendMessage(msg: SentMessage) {
      sent.push(msg);
    },
  };

  const fakeRuntime = {
    // Ignore the passed Effect; return the controlled final result for the turn
    // currently being driven.
    runPromise(_effect: unknown) {
      return Promise.resolve(resultFor(current));
    },
  };

  registerHeartbeatReminderHandler(
    fakePi as unknown as ExtensionAPI,
    fakeRuntime as unknown as AppRuntime,
  );

  const ctx = { hasUI: false };
  const turnEnd = handlers["turn_end"] ?? [];
  const firedAt: number[] = [];
  for (let t = 1; t <= turns; t++) {
    current = stateAt(t);
    const before = sent.length;
    for (const h of turnEnd) await h({}, ctx);
    if (sent.length > before) firedAt.push(t);
  }

  return { firedAt, sent };
}

/**
 * Drive TWO handler closures that SHARE the module-level _heartbeatCoordinator
 * (it is module-scoped, so both registrations see the same object). Both see the
 * same active soul (shared persistence in reality) and reach the same
 * activation-anchored beat together. Exercises the dedup: exactly one send per
 * beat, keyed on identity+count rather than a session-absolute turn.
 */
async function driveSiblings(turns: number): Promise<{ firedAt: number[]; totalSends: number }> {
  const sent: SentMessage[] = [];
  const turnEndA: Handler[] = [];
  const turnEndB: Handler[] = [];

  const makePi = (bucket: Handler[]) => ({
    on(event: string, handler: Handler) {
      if (event === "turn_end") bucket.push(handler);
    },
    sendMessage(msg: SentMessage) {
      sent.push(msg);
    },
  });

  const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
  const makeRuntime = () => ({
    runPromise(_effect: unknown) {
      return Promise.resolve(resultFor(soul));
    },
  });

  // A and B both register at module load; both share the coordinator.
  registerHeartbeatReminderHandler(
    makePi(turnEndA) as unknown as ExtensionAPI,
    makeRuntime() as unknown as AppRuntime,
  );
  registerHeartbeatReminderHandler(
    makePi(turnEndB) as unknown as ExtensionAPI,
    makeRuntime() as unknown as AppRuntime,
  );

  const ctx = { hasUI: false };
  const firedAt: number[] = [];
  for (let t = 1; t <= turns; t++) {
    const before = sent.length;
    for (const h of turnEndA) await h({}, ctx);
    for (const h of turnEndB) await h({}, ctx);
    if (sent.length > before) firedAt.push(t);
  }
  return { firedAt, totalSends: sent.length };
}

describe("registerHeartbeatReminderHandler — activation-anchored scheduler", () => {
  it("fires lite exactly 6 turns AFTER a mid-session activation, not the activation turn", async () => {
    // No soul for turns 1–6 (browse), then a Level-3 lite soul activates at turn
    // 7. The activation turn (7) is count 0 and does NOT fire; the first lite
    // beat lands 6 turns later at turn 13. (Session-absolute code fired at 12.)
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
    const { firedAt, sent } = await drive(15, (t) => (t >= 7 ? soul : null));
    expect(firedAt).toEqual([13]);
    // The reminder is hidden from the visible conversation and XML-wrapped.
    expect(sent).toHaveLength(1);
    expect(sent[0].display).toBe(false);
    expect(sent[0].customType).toBe("soul-heartbeat-reminder");
    expect(sent[0].content).toContain("<soul-heartbeat-reminder");
  });

  it("still fires when a soul activates well past the old turn-6 wedge point (issue #1 cannot recur)", async () => {
    // Activate at turn 10 — long after turn 6. In the session-absolute model a
    // turn 6 reached while inactive froze the schedule for the whole session;
    // here nothing counts until activation, so it fires 6 turns after → turn 16.
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
    const { firedAt } = await drive(20, (t) => (t >= 10 ? soul : null));
    expect(firedAt).toEqual([16]);
  });

  it("fires lite on cadence when active from the first turn (control)", async () => {
    // Active from turn 1: turn 1 is the activation anchor (count 0, no fire),
    // then a beat every 6 → turns 7 and 13.
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
    const { firedAt } = await drive(15, () => soul);
    expect(firedAt).toEqual([7, 13]);
  });

  it("preserves the full mala cadence anchored to activation (control)", async () => {
    // full shape unchanged [6, 3, 2, 3]; anchored to activation at turn 1
    // (count 0) → counts 6, 9, 11, 14 → turns 7, 10, 12, 15.
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "full" };
    const { firedAt } = await drive(15, () => soul);
    expect(firedAt).toEqual([7, 10, 12, 15]);
  });

  it("re-anchors and restarts the schedule when the active-soul identity changes", async () => {
    // Soul X (updatedAt 100) active from turn 1 → first beat at turn 7. At turn 8
    // the identity changes (bumped updatedAt = 200, as a level/heartbeat change
    // would do) → count resets to 0 at turn 8 (no fire) → next beat 6 turns later
    // at turn 14.
    const x: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
    const y: SoulState = { soul: "zen", updatedAt: 200, level: 3, mode: "lite" };
    const { firedAt } = await drive(15, (t) => (t >= 8 ? y : x));
    expect(firedAt).toEqual([7, 14]);
  });

  it("does not double-send across sibling closures sharing the coordinator", async () => {
    // Two closures (jiti moduleCache:false) see the same active soul and reach
    // the same activation-anchored beat at turn 7. The coordinator lets exactly
    // one send through; keyed on identity+count, not a session-absolute turn.
    const { firedAt, totalSends } = await driveSiblings(8);
    expect(firedAt).toEqual([7]);
    expect(totalSends).toBe(1);
  });
});
