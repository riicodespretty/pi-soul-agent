import type { SoulManifest } from "@/src/types";
import { Environment, InteractionMode } from "@/src/types";
import { Option } from "effect";

/**
 * Build a system prompt string from a SoulSpec manifest.
 *
 * Mirrors the readAndSet pattern in loader.ts: all branching logic
 * lives in a single `push` helper — fromNullable wraps the optional,
 * a single filter combines all guards, map formats and pushes.
 * The function body is a flat sequence of single-line helper calls.
 *
 * @param manifest - The loaded soul manifest with optional content fields
 * @param level - Progressive disclosure level (1-3)
 * @param includeIdentity - Whether to include identity content (default: true)
 * @returns Formatted system prompt string
 */
export function buildSystemPrompt(manifest: SoulManifest, level: number = 2): string {
  const parts: string[] = [];

  // ── Helper ────────────────────────────────────────────────────────────────────
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
  push("# ", manifest.displayName, 1);
  push("\n", manifest.description, 1);
  push("\n", manifest.disclosure?.summary, 1);

  // ── Level 2: Core persona ─────────────────────────────────────────────────────
  push("\n\n## Persona\n\n", manifest.soulContent, 2);
  push("\n\n## Identity\n\n", manifest.identityContent, 2);

  // ── Level 3: Extended behavior ────────────────────────────────────────────────
  push("\n\n## Style Guidelines\n\n", manifest.styleContent, 3);
  push("\n\n## Agent Behavior\n\n", manifest.agentsContent, 3);
  push("\n\n## Heartbeat\n\n", manifest.heartbeatContent, 3);
  push("\n\n## User Message Template\n\n", manifest.userTemplateContent, 3);

  // ── Calibration examples ──────────────────────────────────────────────────────
  push(
    "\n\n## Calibration Examples",
    "",
    3,
    Boolean(manifest.examplesGoodContent ?? manifest.examplesBadContent),
  );
  push("\n\n### Good Outputs\n\n", manifest.examplesGoodContent, 3);
  push("\n\n### Outputs to Avoid\n\n", manifest.examplesBadContent, 3);

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

  push(`\n\n## Environment\n`, `You are an **${manifest.environment}** agent.`, 1, envActive);

  push(
    "\nPrimary interaction mode: ",
    manifest.interactionMode,
    1,
    envActive && manifest.interactionMode !== InteractionMode.TEXT,
  );

  push("\nHardware: ", formatHardwareCaps(manifest.hardwareConstraints), 1, envActive);

  push(
    "\nSafety: ",
    `${manifest.safety!.physical!.contactPolicy} contact policy`,
    1,
    envActive && Boolean(manifest.safety?.physical),
  );

  return parts.join("");
}
