import { describe, it, expect } from "@effect/vitest";
import { beforeEach, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppRuntime, HeartbeatMode } from "../src/types";

// ═══════════════════════════════════════════════════════════════════════════
// registerHeartbeatReminderHandler — registration-level regression harness
// ═══════════════════════════════════════════════════════════════════════════
//
// The scheduler state (intervalIndex / nextTurnAt / totalTurns) lives in a
// closure created inside registerHeartbeatReminderHandler and is reachable only
// through the pi.on("turn_end" | "session_start", ...) callbacks — there is no
// exported pure unit. So we drive the REAL handler: a fake `pi` records handlers
// and captures sendMessage, and a fake `runtime` scripts runPromise's final
// { _tag, active, content?, mode? } shape per turn. This exercises the true
// closure/bug site (issue #1: the mala schedule freezing on an inactive turn).
//
// The handler also consults a MODULE-LEVEL singleton (`_heartbeatCoordinator`)
// that is not exported and cannot be reset from outside. Every scenario begins
// firing at turn 6, so a serviced-turn value leaking from a previous test would
// falsely suppress the next. We therefore reset the module registry and
// re-import the handler for each test to get a fresh coordinator. This is the
// sanctioned "module loading boundary" exception to the static-import rule: a
// static import binds one shared coordinator for the whole file and cannot be
// reset (the source intentionally exposes no reset seam, and refactoring it for
// testability is out of scope for this fix).

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

/** The single member of ExtensionAPI.sendMessage's payload we assert on. */
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
  // Runtime-selected only in the sense that we need a FRESH module instance per
  // test to reset the module-level _heartbeatCoordinator; the specifier itself
  // is a literal and the type comes from the static `import type` above.
  const mod = await import("../src/events");
  registerHeartbeatReminderHandler = mod.registerHeartbeatReminderHandler;
});

interface ScenarioConfig {
  /** Number of turn_end events to drive. */
  turns: number;
  /** Turn from which the fake pipeline starts returning active:true. */
  activeFrom: number;
  /** Heartbeat mode the fake pipeline reports while active. */
  mode: HeartbeatMode;
}

interface ScenarioResult {
  /** Total heartbeat messages captured across the run. */
  heartbeatsSent: number;
  /** Turn number of the first heartbeat, or null if none fired. */
  firstAt: number | null;
  /** Every turn at which a heartbeat fired, in order. */
  firedAt: number[];
}

/**
 * Register the real handler with fakes, drive `turns` turn_end events, and
 * record which turns emitted a heartbeat. Boundary casts (`as unknown as T`)
 * hand the closure minimal fakes satisfying only the members it touches
 * (pi.on / pi.sendMessage ; runtime.runPromise) — no project code is reimplemented.
 */
async function runScenario(cfg: ScenarioConfig): Promise<ScenarioResult> {
  const handlers: Record<string, Handler[]> = {};
  const sent: SentMessage[] = [];
  // Mutable flag the fake runtime consults each turn (models persistence state).
  const state = { active: false };

  const fakePi = {
    on(event: string, handler: Handler) {
      (handlers[event] ??= []).push(handler);
    },
    sendMessage(msg: SentMessage) {
      sent.push(msg);
    },
  };

  const fakeRuntime = {
    // Ignore the passed Effect; return the controlled final result shape the
    // closure destructures: { _tag, active, content?, mode? }.
    runPromise(_effect: unknown) {
      if (state.active) {
        return Promise.resolve({
          _tag: "success" as const,
          active: true as const,
          content: "HB",
          mode: cfg.mode,
        });
      }
      return Promise.resolve({ _tag: "success" as const, active: false as const });
    },
  };

  registerHeartbeatReminderHandler(
    fakePi as unknown as ExtensionAPI,
    fakeRuntime as unknown as AppRuntime,
  );

  const ctx = { hasUI: false };

  // Reset counters exactly as Pi would at a session boundary.
  for (const h of handlers["session_start"] ?? []) await h({ reason: "startup" }, ctx);

  const turnEnd = handlers["turn_end"] ?? [];
  const firedAt: number[] = [];
  for (let t = 1; t <= cfg.turns; t++) {
    state.active = t >= cfg.activeFrom;
    const before = sent.length;
    for (const h of turnEnd) await h({}, ctx);
    if (sent.length > before) firedAt.push(t);
  }

  return {
    heartbeatsSent: sent.length,
    firstAt: firedAt.length > 0 ? firedAt[0] : null,
    firedAt,
  };
}

/**
 * Drive TWO handler closures that SHARE the module-level _heartbeatCoordinator
 * (it is module-scoped, so both registrations see the same object). Closure A is
 * always inactive; closure B is always active. Both reach turn 6 together, A
 * first. Exercises the secondary defect: the coordinator must be marked serviced
 * only after an actual send, so A's inactive turn-6 must NOT suppress B's real send.
 */
async function runSiblingScenario(): Promise<{ firedAt: number[] }> {
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

  const makeRuntime = (active: boolean) => ({
    runPromise(_effect: unknown) {
      return active
        ? Promise.resolve({
            _tag: "success" as const,
            active: true as const,
            content: "HB",
            mode: "lite" as const,
          })
        : Promise.resolve({ _tag: "success" as const, active: false as const });
    },
  });

  // A registered first (inactive); B second (active). Both share the coordinator.
  registerHeartbeatReminderHandler(
    makePi(turnEndA) as unknown as ExtensionAPI,
    makeRuntime(false) as unknown as AppRuntime,
  );
  registerHeartbeatReminderHandler(
    makePi(turnEndB) as unknown as ExtensionAPI,
    makeRuntime(true) as unknown as AppRuntime,
  );

  const ctx = { hasUI: false };
  const firedAt: number[] = [];
  for (let t = 1; t <= 6; t++) {
    const before = sent.length;
    for (const h of turnEndA) await h({}, ctx); // inactive sibling first
    for (const h of turnEndB) await h({}, ctx); // active sibling second
    if (sent.length > before) firedAt.push(t);
  }
  return { firedAt };
}

describe("registerHeartbeatReminderHandler — mala scheduler", () => {
  it("recovers after mid-session activation past turn 6 (wedge regression, issue #1)", async () => {
    // Inactive through turn 6, then active from turn 7 — the user's exact path
    // (browse, then `/soul <name> --level 3` a few turns in).
    const result = await runScenario({ turns: 15, activeFrom: 7, mode: "lite" });

    // Before the fix: the schedule freezes at turn 6 (nextTurnAt never advances
    // past a turn reached while inactive) and the strict gate never matches
    // again → 0 heartbeats for the whole session. After the fix: the schedule
    // keeps ticking while inactive, so the next lite slot (turn 12) fires once
    // the soul is active.
    expect(result.heartbeatsSent).toBeGreaterThan(0);
    expect(result.firstAt).toBe(12);
  });

  it("does not let an inactive sibling closure suppress an active one (coordinator regression, issue #1)", async () => {
    // Secondary defect: the shared coordinator was marked serviced BEFORE the
    // active-check, so an inactive closure reaching turn 6 recorded "serviced"
    // and silenced a sibling that was actually active at turn 6.
    const result = await runSiblingScenario();

    // Before the fix: A (inactive) claims turn 6 → B (active) is suppressed → [].
    // After the fix: A records nothing (no send) → B fires at turn 6 → [6].
    expect(result.firedAt).toEqual([6]);
  });

  it("fires on the lite cadence (turns 6, 12) when active from turn 1", async () => {
    // Control: proves the harness can observe a send, and locks the lite cadence.
    const result = await runScenario({ turns: 15, activeFrom: 1, mode: "lite" });
    expect(result.firedAt).toEqual([6, 12]);
  });

  it("preserves the full mala cadence (turns 6, 9, 11, 14) when active from turn 1", async () => {
    // Gaps 6 → 3 → 2 → 3 (the mala [6, 3, 2, 3]).
    const result = await runScenario({ turns: 15, activeFrom: 1, mode: "full" });
    expect(result.firedAt).toEqual([6, 9, 11, 14]);
  });
});
