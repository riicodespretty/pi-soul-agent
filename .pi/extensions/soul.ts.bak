import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect, ManagedRuntime, Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { LoggerLayer } from "../../src/logger";
import { SoulSpecLoader } from "../../src/loader";
import { ActiveSoulPersistence } from "../../src/persistence";
import { registerLoadSoulTool, registerListSoulsTool, registerSoulInfoTool } from "../../src/tools";
import { registerSoulsCommand, registerSoulCommand } from "../../src/commands";
import {
  registerSessionStartHandler,
  registerResourcesDiscoverHandler,
  registerBeforeAgentStartHandler,
} from "../../src/events";

/**
 * Application layer stack.
 * Each service's FileSystem requirement is satisfied by NodeFileSystem.layer.
 */
const AppLayer = Layer.mergeAll(
  Layer.provideMerge(SoulSpecLoader.Default, NodeFileSystem.layer),
  Layer.provideMerge(ActiveSoulPersistence.Default, NodeFileSystem.layer),
  LoggerLayer,
);

/**
 * Managed runtime — created once, reused across all handlers.
 */
const runtime = ManagedRuntime.make(AppLayer);

/**
 * Pi Soul Agent Extension Entry Point
 *
 * @param pi - The Pi Coding Agent Extension API
 */
export default function (pi: ExtensionAPI) {
  Effect.logDebug("soul", "SoulSpec extension loading...");

  // Register tools
  registerLoadSoulTool(pi, runtime);
  registerListSoulsTool(pi, runtime);
  registerSoulInfoTool(pi, runtime);

  // Register commands
  registerSoulsCommand(pi, runtime);
  registerSoulCommand(pi, runtime);

  // Register event handlers
  registerSessionStartHandler(pi, runtime);
  registerResourcesDiscoverHandler(pi, runtime);
  registerBeforeAgentStartHandler(pi, runtime);

  Effect.logDebug("soul", "SoulSpec extension loaded successfully.");
}
