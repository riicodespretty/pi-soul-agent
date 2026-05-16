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

// ── Utility ──

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

// ── Interfaces ──

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
  readonly minTokenContext?: number;
}

export interface SoulFiles {
  readonly soul: string;
  readonly identity?: string;
  readonly agents?: string;
  readonly heartbeat?: string;
  readonly style?: string;
  readonly userTemplate?: string;
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
  readonly hasDisplay: boolean;
  readonly hasSpeaker: boolean;
  readonly hasMicrophone: boolean;
  readonly hasCamera: boolean;
  readonly mobility: Mobility;
  readonly manipulator: boolean;
}

export interface PhysicalSafety {
  readonly contactPolicy: ContactPolicy;
  readonly emergencyProtocol: string;
  readonly operatingZone: string;
  readonly maxSpeed?: string;
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
  readonly maxSpeed?: string;
  readonly payload?: string;
  readonly reach?: string;
  readonly force?: string;
  readonly dof?: number;
  readonly resolution?: string;
}

/** Fields loaded from disk at runtime (not present in soul.json on disk). */
export interface WritableSoulManifestProps {
  soulContent?: string;
  identityContent?: string;
  agentsContent?: string;
  styleContent?: string;
  heartbeatContent?: string;
  userTemplateContent?: string;
  examplesGoodContent?: string;
  examplesBadContent?: string;
  avatarPath?: string;
}

/** On-disk fields present in soul.json. Used to type manifest overrides. */
export type SoulManifestData = Omit<SoulManifest, keyof WritableSoulManifestProps>;

/** Main SoulSpec manifest — 30+ fields aggregating all interfaces above */
export interface SoulManifest extends WritableSoulManifestProps {
  readonly specVersion: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly author: Author;
  readonly license: string;
  readonly tags: string[];
  readonly category: string;
  readonly compatibility: Compatibility;
  readonly allowedTools: string[];
  readonly recommendedSkills: RecommendedSkill[];
  readonly files: SoulFiles;
  readonly examples?: SoulExamples;
  readonly disclosure?: Disclosure;
  readonly deprecated: boolean;
  readonly supersededBy?: string;
  readonly repository?: string;
  readonly environment: Environment;
  readonly interactionMode: InteractionMode;
  readonly hardwareConstraints?: HardwareConstraints;
  readonly safety?: Safety;
  readonly sensors: Sensor[];
  readonly actuators: Actuator[];
}

/** Persisted active soul entry */
export interface ActiveSoul {
  readonly soul: string;
  readonly level: number;
  readonly updatedAt: number;
}

/** Application runtime type for the Pi extension bridge */
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
