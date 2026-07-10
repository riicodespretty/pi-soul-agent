import { describe, it, expect } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, HeartbeatMode } from "../src/types";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

interface SentMessage {
  customType?: string;
  content?: string;
  display?: boolean;
}

type RegisterHeartbeat = (pi: ExtensionAPI, runtime: AppRuntime) => void;

let registerHeartbeatReminderHandler: RegisterHeartbeat;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../src/events");
  registerHeartbeatReminderHandler = mod.registerHeartbeatReminderHandler;
});

interface SoulState {
  soul: string;
  updatedAt: number;
  level: number;
  mode: HeartbeatMode;
}

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
    // Rationale [3] → git notes docs-code-rationale: docs/rationale/events.test.md
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
    // Rationale [4] → git notes docs-code-rationale: docs/rationale/events.test.md
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

  it("fires full as a ramp-then-plateau anchored to activation (control)", async () => {
    // Rationale [5] → git notes docs-code-rationale: docs/rationale/events.test.md
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "full" };
    const { firedAt } = await drive(217, () => soul);
    expect(firedAt).toEqual([7, 19, 37, 109, 217]);
    // Ramp gaps taper (12, 18, 72) then the schedule PLATEAUS: the 5th fire lands
    // a constant 108 turns after the 4th, and holds there thereafter.
    expect(firedAt[3] - firedAt[2]).toBe(72);
    expect(firedAt[4] - firedAt[3]).toBe(108);
  });

  it("re-anchors and restarts the schedule when the active-soul identity changes", async () => {
    // Rationale [6] → git notes docs-code-rationale: docs/rationale/events.test.md
    const x: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: "lite" };
    const y: SoulState = { soul: "zen", updatedAt: 200, level: 3, mode: "lite" };
    const { firedAt } = await drive(15, (t) => (t >= 8 ? y : x));
    expect(firedAt).toEqual([7, 14]);
  });

  it("fires a custom integer mode N every N turns from activation", async () => {
    // Rationale [7] → git notes docs-code-rationale: docs/rationale/events.test.md
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: 4 };
    const { firedAt, sent } = await drive(15, () => soul);
    expect(firedAt).toEqual([5, 9, 13]);
    expect(sent[0].display).toBe(false);
    expect(sent[0].customType).toBe("soul-heartbeat-reminder");
  });

  it("anchors a custom integer mode to a mid-session activation", async () => {
    // Custom N=3 activates at turn 5. The activation turn (5) is count 0 and does
    // NOT fire; the schedule restarts and beats land every 3 → turns 8, 11, 14.
    const soul: SoulState = { soul: "zen", updatedAt: 100, level: 3, mode: 3 };
    const { firedAt } = await drive(15, (t) => (t >= 5 ? soul : null));
    expect(firedAt).toEqual([8, 11, 14]);
  });

  it("does not double-send across sibling closures sharing the coordinator", async () => {
    // Rationale [8] → git notes docs-code-rationale: docs/rationale/events.test.md
    const { firedAt, totalSends } = await driveSiblings(8);
    expect(firedAt).toEqual([7]);
    expect(totalSends).toBe(1);
  });
});
