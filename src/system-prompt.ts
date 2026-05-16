import type { SoulManifest } from "@/src/types";
import { Environment, InteractionMode } from "@/src/types";

/**
 * Build a system prompt string from a SoulSpec manifest.
 * Pure function — no Effect needed.
 *
 * Ported from src/.source/soul.ts SoulSpecLoader.buildSystemPrompt()
 *
 * @param manifest - The loaded soul manifest with optional content fields
 * @param level - Progressive disclosure level (1-3)
 * @param includeIdentity - Whether to include identity content (default: true)
 * @returns Formatted system prompt string
 */
export function buildSystemPrompt(
  manifest: SoulManifest,
  level: number = 2,
  includeIdentity: boolean = true,
): string {
  const parts: string[] = [];

  // Level 1: Basic info
  parts.push(`# ${manifest.displayName}`);
  parts.push(`\n${manifest.description}`);

  if (manifest.disclosure?.summary) {
    parts.push(`\n${manifest.disclosure.summary}`);
  }

  // Level 2: Core persona
  if (level >= 2) {
    if (manifest.soulContent) {
      parts.push(`\n\n## Persona\n\n${manifest.soulContent}`);
    }

    if (includeIdentity && manifest.identityContent) {
      parts.push(`\n\n## Identity\n\n${manifest.identityContent}`);
    }
  }

  // Level 3: Extended behavior
  if (level >= 3) {
    if (manifest.styleContent) {
      parts.push(`\n\n## Style Guidelines\n\n${manifest.styleContent}`);
    }

    if (manifest.agentsContent) {
      parts.push(`\n\n## Agent Behavior\n\n${manifest.agentsContent}`);
    }

    if (manifest.heartbeatContent) {
      parts.push(`\n\n## Heartbeat\n\n${manifest.heartbeatContent}`);
    }

    if (manifest.userTemplateContent) {
      parts.push(`\n\n## User Message Template\n\n${manifest.userTemplateContent}`);
    }

    if (manifest.examplesGoodContent || manifest.examplesBadContent) {
      parts.push("\n\n## Calibration Examples");
      if (manifest.examplesGoodContent) {
        parts.push(`\n\n### Good Outputs\n\n${manifest.examplesGoodContent}`);
      }
      if (manifest.examplesBadContent) {
        parts.push(`\n\n### Outputs to Avoid\n\n${manifest.examplesBadContent}`);
      }
    }
  }

  // Add constraints for embodied agents
  if (manifest.environment !== Environment.VIRTUAL) {
    parts.push(`\n\n## Environment`);
    parts.push(`\nYou are an **${manifest.environment}** agent.`);

    if (manifest.interactionMode !== InteractionMode.TEXT) {
      parts.push(`\nPrimary interaction mode: ${manifest.interactionMode}`);
    }

    if (manifest.hardwareConstraints) {
      const hc = manifest.hardwareConstraints;
      const capabilities: string[] = [];
      if (hc.hasDisplay) capabilities.push("display");
      if (hc.hasSpeaker) capabilities.push("speaker");
      if (hc.hasMicrophone) capabilities.push("microphone");
      if (hc.hasCamera) capabilities.push("camera");
      if (capabilities.length > 0) {
        parts.push(`\nHardware: ${capabilities.join(", ")}`);
      }
    }

    if (manifest.safety?.physical) {
      const ps = manifest.safety.physical;
      parts.push(`\nSafety: ${ps.contactPolicy} contact policy`);
    }
  }

  return parts.join("");
}
