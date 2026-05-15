import { FileSystem } from "@effect/platform/FileSystem";
import { Effect } from "effect";
import {
  type Actuator,
  type Author,
  type Compatibility,
  type Disclosure,
  type HardwareConstraints,
  type PhysicalSafety,
  type RecommendedSkill,
  type Safety,
  type Sensor,
  type SoulExamples,
  type SoulFiles,
  type SoulManifest,
  ContactPolicy,
  Environment,
  InteractionMode,
  Mobility,
} from "@/src/types";
import { FileSystemError, ManifestParseError } from "@/src/errors";

/**
 * Expand ~ to the user's home directory.
 * This is a sync boundary function — NOT an Effect.
 * Must be called before passing paths to @effect/platform FileSystem methods.
 */
export function expandHome(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/home/user";
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  return p;
}

/**
 * Parse a raw JSON data object into a typed SoulManifest.
 * Maps camelCase JSON fields (from SoulSpec v0.5 soul.json) to snake_case TS fields.
 */
export function parseManifest(data: Record<string, unknown>): SoulManifest {
  const author: Author = {
    name: ((data.author as Record<string, unknown>)?.name as string) || "Unknown",
    github: (data.author as Record<string, unknown>)?.github as string | undefined,
    email: (data.author as Record<string, unknown>)?.email as string | undefined,
  };

  const compatData = data.compatibility as Record<string, unknown> | undefined;
  const compatibility: Compatibility = {
    openclaw: compatData?.openclaw as string | undefined,
    models: (compatData?.models as string[]) || [],
    frameworks: (compatData?.frameworks as string[]) || [],
    min_token_context: compatData?.minTokenContext as number | undefined,
  };

  // Parse recommended skills (handle both new object format and legacy string format)
  const recommendedSkills: RecommendedSkill[] = [];
  const skillsData = (data.recommendedSkills || data.skills || []) as Array<unknown>;
  for (const skill of skillsData) {
    if (typeof skill === "string") {
      recommendedSkills.push({ name: skill, required: false });
    } else {
      const s = skill as Record<string, unknown>;
      recommendedSkills.push({
        name: s.name as string,
        version: s.version as string | undefined,
        required: (s.required as boolean) || false,
      });
    }
  }

  const filesData = data.files as Record<string, unknown> | undefined;
  const files: SoulFiles = {
    soul: (filesData?.soul as string) || "SOUL.md",
    identity: filesData?.identity as string | undefined,
    agents: filesData?.agents as string | undefined,
    heartbeat: filesData?.heartbeat as string | undefined,
    style: filesData?.style as string | undefined,
    user_template: filesData?.userTemplate as string | undefined,
    avatar: filesData?.avatar as string | undefined,
  };

  const examplesData = data.examples as Record<string, unknown> | undefined;
  const examples: SoulExamples | undefined = examplesData
    ? {
        good: examplesData.good as string | undefined,
        bad: examplesData.bad as string | undefined,
      }
    : undefined;

  const disclosureData = data.disclosure as Record<string, unknown> | undefined;
  const disclosure: Disclosure | undefined = disclosureData
    ? {
        summary: disclosureData.summary as string | undefined,
      }
    : undefined;

  const hcData = data.hardwareConstraints as Record<string, unknown> | undefined;
  const hardwareConstraints: HardwareConstraints | undefined = hcData
    ? {
        has_display: (hcData.hasDisplay as boolean) || false,
        has_speaker: (hcData.hasSpeaker as boolean) || false,
        has_microphone: (hcData.hasMicrophone as boolean) || false,
        has_camera: (hcData.hasCamera as boolean) || false,
        mobility: Mobility[hcData.mobility as keyof typeof Mobility] || Mobility.STATIONARY,
        manipulator: (hcData.manipulator as boolean) || false,
      }
    : undefined;

  const safetyData = data.safety as Record<string, unknown> | undefined;
  const physData = safetyData?.physical as Record<string, unknown> | undefined;
  const physicalSafety: PhysicalSafety | undefined = physData
    ? {
        contact_policy:
          ContactPolicy[physData.contactPolicy as keyof typeof ContactPolicy] ||
          ContactPolicy.NO_CONTACT,
        emergency_protocol: (physData.emergencyProtocol as string) || "stop",
        operating_zone: (physData.operatingZone as string) || "indoor",
        max_speed: physData.maxSpeed as string | undefined,
      }
    : undefined;

  const safety: Safety | undefined = safetyData
    ? {
        physical: physicalSafety,
      }
    : undefined;

  // Parse sensors (keyed object → array with name field)
  const sensors: Sensor[] = [];
  const rawSensors = data.sensors as Record<string, unknown> | undefined;
  if (rawSensors) {
    for (const [name, sensorData] of Object.entries(rawSensors)) {
      const sd = sensorData as Record<string, unknown> | undefined;
      sensors.push({
        name,
        type: sd?.type as string | undefined,
        range: sd?.range as string | undefined,
        fov: sd?.fov as number | undefined,
        resolution: sd?.resolution as string | undefined,
        fps: sd?.fps as number | undefined,
        channels: sd?.channels as number | undefined,
      });
    }
  }

  // Parse actuators (keyed object → array with name field)
  const actuators: Actuator[] = [];
  const rawActuators = data.actuators as Record<string, unknown> | undefined;
  if (rawActuators) {
    for (const [name, actData] of Object.entries(rawActuators)) {
      const ad = actData as Record<string, unknown>;
      actuators.push({
        name,
        type: ad.type as string | undefined,
        max_speed: ad.maxSpeed as string | undefined,
        payload: ad.payload as string | undefined,
        reach: ad.reach as string | undefined,
        force: ad.force as string | undefined,
        dof: ad.dof as number | undefined,
        resolution: ad.resolution as string | undefined,
      });
    }
  }

  return {
    spec_version: (data.specVersion as string) || "0.5",
    name: (data.name as string) || "unknown",
    display_name: (data.displayName as string) || "Unknown",
    version: (data.version as string) || "1.0.0",
    description: (data.description as string) || "",
    author,
    license: (data.license as string) || "MIT",
    tags: (data.tags as string[]) || [],
    category: (data.category as string) || "general",
    compatibility,
    allowed_tools: (data.allowedTools as string[]) || [],
    recommended_skills: recommendedSkills,
    files,
    examples,
    disclosure,
    deprecated: (data.deprecated as boolean) || false,
    superseded_by: data.supersededBy as string | undefined,
    repository: data.repository as string | undefined,
    environment: Environment[data.environment as keyof typeof Environment] || Environment.VIRTUAL,
    interaction_mode:
      InteractionMode[data.interactionMode as keyof typeof InteractionMode] || InteractionMode.TEXT,
    hardware_constraints: hardwareConstraints,
    safety,
    sensors,
    actuators,
  };
}

/**
 * Read and parse a JSON file, returning the typed result.
 */
export function readJsonFile<T>(
  fs: FileSystem,
  soulPath: string,
): Effect.Effect<T, FileSystemError | ManifestParseError> {
  const readAndParse = fs.readFileString(soulPath).pipe(
    Effect.flatMap((content: string) =>
      Effect.try({
        try: () => JSON.parse(content) as T,
        catch: (cause) => new ManifestParseError({ path: soulPath, cause }),
      }),
    ),
  );
  return readAndParse.pipe(
    Effect.mapError((cause) => {
      if (cause instanceof ManifestParseError) {
        return cause as ManifestParseError;
      }
      return new FileSystemError({ path: soulPath, cause });
    }),
  );
}

/**
 * Read a text file, returning its content as a string.
 */
export function readTextFile(
  fs: FileSystem,
  soulPath: string,
): Effect.Effect<string, FileSystemError> {
  return fs
    .readFileString(soulPath)
    .pipe(Effect.mapError((cause) => new FileSystemError({ path: soulPath, cause })));
}
