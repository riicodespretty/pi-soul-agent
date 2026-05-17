import { ManagedRuntime, ParseResult, Schema as S } from "effect";

// ── Enums as const objects (erasableSyntaxOnly: true forbids `enum`) ──

export const EnvironmentSchema = S.Enums({
  VIRTUAL: "virtual",
  EMBODIED: "embodied",
  HYBRID: "hybrid",
} as const);
export const Environment = EnvironmentSchema.enums;
export type Environment = S.Schema.Type<typeof EnvironmentSchema>;

export const InteractionModeSchema = S.Enums({
  TEXT: "text",
  VOICE: "voice",
  MULTIMODAL: "multimodal",
  GESTURE: "gesture",
} as const);
export const InteractionMode = InteractionModeSchema.enums;
export type InteractionMode = S.Schema.Type<typeof InteractionModeSchema>;

export const ContactPolicySchema = S.Enums({
  NO_CONTACT: "no-contact",
  GENTLE_CONTACT: "gentle-contact",
  FULL_CONTACT: "full-contact",
} as const);
export const ContactPolicy = ContactPolicySchema.enums;
export type ContactPolicy = S.Schema.Type<typeof ContactPolicySchema>;

export const MobilitySchema = S.Enums({
  STATIONARY: "stationary",
  MOBILE: "mobile",
  LIMITED: "limited",
} as const);
export const Mobility = MobilitySchema.enums;
export type Mobility = S.Schema.Type<typeof MobilitySchema>;

// ── Utility ──

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

// ── Schema definitions (source of truth for all soul.json data types) ──
// See: https://github.com/clawsouls/soulspec/blob/main/soul-spec-v0.5.md

export const AuthorSchema = S.Struct({
  name: S.optionalWith(S.String, { default: () => "Unknown" }),
  github: S.optionalWith(S.String, { exact: true }),
  email: S.optionalWith(S.String, { exact: true }),
});
export type Author = S.Schema.Type<typeof AuthorSchema>;

export const CompatibilitySchema = S.Struct({
  openclaw: S.optionalWith(S.String, { exact: true }),
  models: S.optionalWith(S.Array(S.String), { default: () => [] }),
  frameworks: S.optionalWith(S.Array(S.String), { default: () => [] }),
  minTokenContext: S.optionalWith(S.Number, { exact: true }),
});
export type Compatibility = S.Schema.Type<typeof CompatibilitySchema>;

export const SoulFilesSchema = S.Struct({
  soul: S.optionalWith(S.String, { default: () => "SOUL.md" }),
  identity: S.optionalWith(S.String, { exact: true }),
  agents: S.optionalWith(S.String, { exact: true }),
  heartbeat: S.optionalWith(S.String, { exact: true }),
  style: S.optionalWith(S.String, { exact: true }),
  userTemplate: S.optionalWith(S.String, { exact: true }),
  avatar: S.optionalWith(S.String, { exact: true }),
});
export type SoulFiles = S.Schema.Type<typeof SoulFilesSchema>;

export const SoulExamplesSchema = S.Struct({
  good: S.optionalWith(S.String, { exact: true }),
  bad: S.optionalWith(S.String, { exact: true }),
});
export type SoulExamples = S.Schema.Type<typeof SoulExamplesSchema>;

export const DisclosureSchema = S.Struct({
  summary: S.optionalWith(S.String, { exact: true }),
});
export type Disclosure = S.Schema.Type<typeof DisclosureSchema>;

export const PhysicalSafetySchema = S.Struct({
  contactPolicy: S.optionalWith(ContactPolicySchema, {
    default: () => ContactPolicy.NO_CONTACT,
  }),
  emergencyProtocol: S.optionalWith(S.String, { default: () => "stop" }),
  operatingZone: S.optionalWith(S.String, { default: () => "indoor" }),
  maxSpeed: S.optionalWith(S.String, { exact: true }),
});
export type PhysicalSafety = S.Schema.Type<typeof PhysicalSafetySchema>;

export const HardwareConstraintsSchema = S.Struct({
  hasDisplay: S.optionalWith(S.Boolean, { default: () => false }),
  hasSpeaker: S.optionalWith(S.Boolean, { default: () => false }),
  hasMicrophone: S.optionalWith(S.Boolean, { default: () => false }),
  hasCamera: S.optionalWith(S.Boolean, { default: () => false }),
  mobility: S.optionalWith(MobilitySchema, {
    default: () => Mobility.STATIONARY,
  }),
  manipulator: S.optionalWith(S.Boolean, { default: () => false }),
});
export type HardwareConstraints = S.Schema.Type<typeof HardwareConstraintsSchema>;

export const SafetySchema = S.Struct({
  physical: S.optionalWith(PhysicalSafetySchema, { exact: true }),
});
export type Safety = S.Schema.Type<typeof SafetySchema>;

// ── Skills (with string→object normalization) ──

const SkillEntryEncodedSchema = S.Union(
  S.String,
  S.Struct({
    name: S.String,
    version: S.optionalWith(S.String, { exact: true }),
    required: S.optionalWith(S.Boolean, { exact: true }),
  }),
);

const SkillEntryDecodedSchema = S.Struct({
  name: S.String,
  version: S.optional(S.String),
  required: S.Boolean,
});
export type RecommendedSkill = S.Schema.Type<typeof SkillEntryDecodedSchema>;

export const RecommendedSkillsSchema = S.transformOrFail(
  S.Array(SkillEntryEncodedSchema),
  S.Array(SkillEntryDecodedSchema),
  {
    decode: (entries) =>
      ParseResult.succeed(
        entries.map((e) =>
          typeof e === "string"
            ? { name: e, required: false }
            : { name: e.name, version: e.version, required: e.required ?? false },
        ),
      ),
    encode: ParseResult.succeed,
  },
);

// ── Sensors (inject name from record key) ──

const SensorEntryEncodedSchema = S.Union(
  S.Boolean,
  S.Struct({
    type: S.optionalWith(S.String, { exact: true }),
    range: S.optionalWith(S.String, { exact: true }),
    fov: S.optionalWith(S.Number, { exact: true }),
    resolution: S.optionalWith(S.String, { exact: true }),
    fps: S.optionalWith(S.Number, { exact: true }),
    channels: S.optionalWith(S.Number, { exact: true }),
  }),
);

const SensorEntryDecodedSchema = S.Struct({
  name: S.String,
  type: S.optional(S.String),
  range: S.optional(S.String),
  fov: S.optional(S.Number),
  resolution: S.optional(S.String),
  fps: S.optional(S.Number),
  channels: S.optional(S.Number),
});
export type Sensor = S.Schema.Type<typeof SensorEntryDecodedSchema>;

export const SensorsSchema = S.transformOrFail(
  S.Record({ key: S.String, value: SensorEntryEncodedSchema }),
  S.Record({ key: S.String, value: SensorEntryDecodedSchema }),
  {
    decode: (encoded) =>
      ParseResult.succeed(
        Object.fromEntries(
          Object.entries(encoded).map(([name, val]) => [
            name,
            typeof val === "boolean" ? { name } : { name, ...val },
          ]),
        ),
      ),
    encode: ParseResult.succeed,
  },
);

// ── Actuators (inject name from record key) ──

const ActuatorEntryEncodedSchema = S.Struct({
  type: S.optionalWith(S.String, { exact: true }),
  maxSpeed: S.optionalWith(S.String, { exact: true }),
  payload: S.optionalWith(S.String, { exact: true }),
  reach: S.optionalWith(S.String, { exact: true }),
  force: S.optionalWith(S.String, { exact: true }),
  dof: S.optionalWith(S.Number, { exact: true }),
  resolution: S.optionalWith(S.String, { exact: true }),
});

const ActuatorEntryDecodedSchema = S.Struct({
  name: S.String,
  type: S.optional(S.String),
  maxSpeed: S.optional(S.String),
  payload: S.optional(S.String),
  reach: S.optional(S.String),
  force: S.optional(S.String),
  dof: S.optional(S.Number),
  resolution: S.optional(S.String),
});
export type Actuator = S.Schema.Type<typeof ActuatorEntryDecodedSchema>;

export const ActuatorsSchema = S.transformOrFail(
  S.Record({ key: S.String, value: ActuatorEntryEncodedSchema }),
  S.Record({ key: S.String, value: ActuatorEntryDecodedSchema }),
  {
    decode: (encoded) =>
      ParseResult.succeed(
        Object.fromEntries(Object.entries(encoded).map(([name, val]) => [name, { name, ...val }])),
      ),
    encode: ParseResult.succeed,
  },
);

// ── Main manifest schema ──

export const SoulManifestDataSchema = S.Struct({
  specVersion: S.optionalWith(S.String, { default: () => "0.5" }),
  name: S.optionalWith(S.String, { default: () => "unknown" }),
  displayName: S.optionalWith(S.String, { default: () => "Unknown" }),
  version: S.optionalWith(S.String, { default: () => "1.0.0" }),
  description: S.optionalWith(S.String, { default: () => "" }),
  author: S.optionalWith(AuthorSchema, {
    default: () => ({ name: "Unknown" }),
  }),
  license: S.optionalWith(S.String, { default: () => "MIT" }),
  tags: S.optionalWith(S.Array(S.String), { default: () => [] }),
  category: S.optionalWith(S.String, { default: () => "general" }),
  compatibility: S.optionalWith(CompatibilitySchema, {
    default: () => ({ models: [], frameworks: [] }),
  }),
  allowedTools: S.optionalWith(S.Array(S.String), { default: () => [] }),
  files: S.optionalWith(SoulFilesSchema, {
    default: () => ({ soul: "SOUL.md" }),
  }),
  examples: S.optionalWith(SoulExamplesSchema, { exact: true }),
  disclosure: S.optionalWith(DisclosureSchema, { exact: true }),
  deprecated: S.optionalWith(S.Boolean, { default: () => false }),
  supersededBy: S.optionalWith(S.String, { exact: true }),
  repository: S.optionalWith(S.String, { exact: true }),
  environment: S.optionalWith(EnvironmentSchema, {
    default: () => Environment.VIRTUAL,
  }),
  interactionMode: S.optionalWith(InteractionModeSchema, {
    default: () => InteractionMode.TEXT,
  }),
  hardwareConstraints: S.optionalWith(HardwareConstraintsSchema, {
    exact: true,
  }),
  safety: S.optionalWith(
    S.Struct({
      physical: S.optionalWith(PhysicalSafetySchema, { exact: true }),
    }),
    { exact: true },
  ),
  sensors: S.optionalWith(SensorsSchema, { default: () => ({}) }),
  actuators: S.optionalWith(ActuatorsSchema, { default: () => ({}) }),
  recommendedSkills: S.optionalWith(RecommendedSkillsSchema, {
    default: () => [],
  }),
});
export type SoulManifestData = S.Schema.Type<typeof SoulManifestDataSchema>;

// ── Composite types ──

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

/** Main SoulSpec manifest — on-disk fields from schema + runtime-loaded content. */
export interface SoulManifest extends WritableSoulManifestProps, SoulManifestData {}

/** Schema for persisted active soul entry (runtime data, not from soul.json). */
export const HeartbeatModeSchema = S.Literal("off", "lite", "full");
export type HeartbeatMode = S.Schema.Type<typeof HeartbeatModeSchema>;

export const ActiveSoulSchema = S.Struct({
  soul: S.String,
  level: S.Number,
  updatedAt: S.Number,
  heartbeatMode: S.optionalWith(HeartbeatModeSchema, { default: () => "lite" as const }),
});
export type ActiveSoul = S.Schema.Type<typeof ActiveSoulSchema>;

/** Parsed /soul command arguments — discriminated union by action. */
export const ParsedSoulCommandSchema = S.Union(
  S.Struct({ action: S.Literal("help") }),
  S.Struct({ action: S.Literal("deactivate") }),
  S.Struct({ action: S.Literal("activate"), soulName: S.String, level: S.Number }),
  S.Struct({ action: S.Literal("heartbeat"), mode: HeartbeatModeSchema }),
);
export type ParsedSoulCommand = S.Schema.Type<typeof ParsedSoulCommandSchema>;

/** Application runtime type for the Pi extension bridge */
export type AppRuntime = ManagedRuntime.ManagedRuntime<any, any>;
