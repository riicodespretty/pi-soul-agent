import type { SoulManifest } from "./types";
import { Environment, InteractionMode } from "./types";
import { Option } from "effect";

export function buildSystemPrompt(manifest: SoulManifest, level: number = 2): string {
  const parts: string[] = [];

  const push = (
    prefix: string,
    content: string | null | undefined,
    minLevel: number = 1,
    guard: boolean = true,
  ) =>
    Option.fromNullable(content).pipe(
      Option.filter(() => level >= minLevel && guard),
      Option.map((c) => parts.push(`${prefix}${c}`)),
    );

  // ── Level 1: Basic info ─────────────────────────────────────────────────────
  if (level < 2) {
    push("# ", manifest.displayName, 1);
    push("\n", manifest.disclosure?.summary ?? manifest.description, 1);
  }

  // ── Level 2: Core persona ─────────────────────────────────────────────────────
  push("\n\n── Personality\n\n", manifest.soulContent, 2);
  push("\n\n── Identity\n\n", manifest.identityContent, 2);

  // ── Level 3: Extended behavior ────────────────────────────────────────────────
  push("\n\n── Style Guidelines\n\n", manifest.styleContent, 3);
  push("\n\n── Agent Behavior\n\n", manifest.agentsContent, 3);
  push("\n\n── User Message Template\n\n", manifest.userTemplateContent, 3);

  // ── Calibration examples ──────────────────────────────────────────────────────
  push(
    "\n\n── Calibration Examples",
    "",
    3,
    Boolean(manifest.examplesGoodContent ?? manifest.examplesBadContent),
  );
  push("\n\n── Good Outputs\n\n", manifest.examplesGoodContent, 3);
  push("\n\n── Outputs to Avoid\n\n", manifest.examplesBadContent, 3);

  // ── Environment: embodied agent constraints ───────────────────────────────────

  /** Format hardware constraints to a capabilities string, or null if none. */
  const formatHardwareCaps = (hc: SoulManifest["hardwareConstraints"]): string | null =>
    Option.fromNullable(hc).pipe(
      Option.map((hc) => {
        const { hasDisplay, hasSpeaker, hasMicrophone, hasCamera } = hc;
        return [
          hasDisplay && "display",
          hasSpeaker && "speaker",
          hasMicrophone && "microphone",
          hasCamera && "camera",
        ]
          .filter(Boolean)
          .join(", ");
      }),
      Option.getOrElse(() => null),
    );

  const envActive = manifest.environment !== Environment.VIRTUAL;

  push(`\n\n── Environment\n`, `You are an **${manifest.environment}** agent.`, 1, envActive);

  push(
    "\nPrimary interaction mode: ",
    manifest.interactionMode,
    1,
    envActive && manifest.interactionMode !== InteractionMode.TEXT,
  );

  push("\nHardware: ", formatHardwareCaps(manifest.hardwareConstraints), 1, envActive);

  push(
    "\nSafety: ",
    `${manifest.safety?.physical?.contactPolicy ?? "unknown"} contact policy`,
    1,
    envActive && Boolean(manifest.safety?.physical?.contactPolicy),
  );

  return parts.join("");
}
