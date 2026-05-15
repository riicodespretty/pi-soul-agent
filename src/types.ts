import { ManagedRuntime } from "effect";

// ── Enums as const objects (erasableSyntaxOnly: true forbids `enum`) ──

export const Environment = {
  VIRTUAL: "virtual",
  EMBODIED: "embodied",
  HYBRID: "hybrid",
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const InteractionMode = {
  TEXT: "text",
  VOICE: "voice",
  MULTIMODAL: "multimodal",
  GESTURE: "gesture",
} as const;
export type InteractionMode = (typeof InteractionMode)[keyof typeof InteractionMode];

export const ContactPolicy = {
  NO_CONTACT: "no-contact",
  GENTLE_CONTACT: "gentle-contact",
  FULL_CONTACT: "full-contact",
} as const;
export type ContactPolicy = (typeof ContactPolicy)[keyof typeof ContactPolicy];

export const Mobility = {
  STATIONARY: "stationary",
  MOBILE: "mobile",
  LIMITED: "limited",
} as const;
export type Mobility = (typeof Mobility)[keyof typeof Mobility];

// ── Interfaces (ported faithfully from src/.source/soul.ts) ──

export interface Author {
  readonly name: string;
  readonly github?: string;
  readonly email?: string;
}

export interface RecommendedSkill {
  readonly name: string;
  readonly version?: string;
  readonly required: boolean;
}

export interface Compatibility {
  readonly openclaw?: string;
  readonly models: string[];
  readonly frameworks: string[];
  readonly min_token_context?: number;
}

export interface SoulFiles {
  readonly soul: string;
  readonly identity?: string;
  readonly agents?: string;
  readonly heartbeat?: string;
  readonly style?: string;
  readonly user_template?: string;
  readonly avatar?: string;
}

export interface SoulExamples {
  readonly good?: string;
  readonly bad?: string;
}

export interface Disclosure {
  readonly summary?: string;
}

export interface HardwareConstraints {
  readonly has_display: boolean;
  readonly has_speaker: boolean;
  readonly has_microphone: boolean;
  readonly has_camera: boolean;
  readonly mobility: Mobility;
  readonly manipulator: boolean;
}

export interface PhysicalSafety {
  readonly contact_policy: ContactPolicy;
  readonly emergency_protocol: string;
  readonly operating_zone: string;
  readonly max_speed?: string;
}

export interface Safety {
  readonly physical?: PhysicalSafety;
}

export interface Sensor {
  readonly name: string;
  readonly type?: string;
  readonly range?: string;
  readonly fov?: number;
  readonly resolution?: string;
  readonly fps?: number;
  readonly channels?: number;
}

export interface Actuator {
  readonly name: string;
  readonly type?: string;
  readonly max_speed?: string;
  readonly payload?: string;
  readonly reach?: string;
  readonly force?: string;
  readonly dof?: number;
  readonly resolution?: string;
}

/** Main SoulSpec manifest — 30+ fields aggregating all interfaces above */
export interface SoulManifest {
  readonly spec_version: string;
  readonly name: string;
  readonly display_name: string;
  readonly version: string;
  readonly description: string;
  readonly author: Author;
  readonly license: string;
  readonly tags: string[];
  readonly category: string;
  readonly compatibility: Compatibility;
  readonly allowed_tools: string[];
  readonly recommended_skills: RecommendedSkill[];
  readonly files: SoulFiles;
  readonly examples?: SoulExamples;
  readonly disclosure?: Disclosure;
  readonly deprecated: boolean;
  readonly superseded_by?: string;
  readonly repository?: string;
  readonly environment: Environment;
  readonly interaction_mode: InteractionMode;
  readonly hardware_constraints?: HardwareConstraints;
  readonly safety?: Safety;
  readonly sensors: Sensor[];
  readonly actuators: Actuator[];

  // These are loaded from disk at runtime — not in the manifest JSON
  soul_content?: string;
  identity_content?: string;
  agents_content?: string;
  style_content?: string;
  heartbeat_content?: string;
  user_template_content?: string;
  examples_good_content?: string;
  examples_bad_content?: string;
  avatar_path?: string;
}

/** Persisted active soul entry */
export interface ActiveSoul {
  readonly soul: string;
  readonly level: number;
  readonly updatedAt: number;
}

/** Application runtime type for the Pi extension bridge */
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
