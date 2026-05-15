import type { SoulManifest } from "./types";
import { Environment, InteractionMode } from "./types";

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
  parts.push(`# ${manifest.display_name}`);
  parts.push(`\n${manifest.description}`);

  if (manifest.disclosure?.summary) {
    parts.push(`\n${manifest.disclosure.summary}`);
  }

  // Level 2: Core persona
  if (level >= 2) {
    if (manifest.soul_content) {
      parts.push(`\n\n## Persona\n\n${manifest.soul_content}`);
    }

    if (includeIdentity && manifest.identity_content) {
      parts.push(`\n\n## Identity\n\n${manifest.identity_content}`);
    }
  }

  // Level 3: Extended behavior
  if (level >= 3) {
    if (manifest.style_content) {
      parts.push(`\n\n## Style Guidelines\n\n${manifest.style_content}`);
    }

    if (manifest.agents_content) {
      parts.push(`\n\n## Agent Behavior\n\n${manifest.agents_content}`);
    }

    if (manifest.heartbeat_content) {
      parts.push(`\n\n## Heartbeat\n\n${manifest.heartbeat_content}`);
    }

    if (manifest.user_template_content) {
      parts.push(`\n\n## User Message Template\n\n${manifest.user_template_content}`);
    }

    if (manifest.examples_good_content || manifest.examples_bad_content) {
      parts.push("\n\n## Calibration Examples");
      if (manifest.examples_good_content) {
        parts.push(`\n\n### Good Outputs\n\n${manifest.examples_good_content}`);
      }
      if (manifest.examples_bad_content) {
        parts.push(`\n\n### Outputs to Avoid\n\n${manifest.examples_bad_content}`);
      }
    }
  }

  // Add constraints for embodied agents
  if (manifest.environment !== Environment.VIRTUAL) {
    parts.push(`\n\n## Environment`);
    parts.push(`\nYou are an **${manifest.environment}** agent.`);

    if (manifest.interaction_mode !== InteractionMode.TEXT) {
      parts.push(`\nPrimary interaction mode: ${manifest.interaction_mode}`);
    }

    if (manifest.hardware_constraints) {
      const hc = manifest.hardware_constraints;
      const capabilities: string[] = [];
      if (hc.has_display) capabilities.push("display");
      if (hc.has_speaker) capabilities.push("speaker");
      if (hc.has_microphone) capabilities.push("microphone");
      if (hc.has_camera) capabilities.push("camera");
      if (capabilities.length > 0) {
        parts.push(`\nHardware: ${capabilities.join(", ")}`);
      }
    }

    if (manifest.safety?.physical) {
      const ps = manifest.safety.physical;
      parts.push(`\nSafety: ${ps.contact_policy} contact policy`);
    }
  }

  return parts.join("");
}
