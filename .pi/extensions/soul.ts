import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ManagedRuntime, Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { layer as NodePathLayer } from "@effect/platform-node/NodePath";
import { LoggerLayer } from "../../src/logger";
import { SoulSpecLoader } from "../../src/loader";
import { ActiveSoulPersistence } from "../../src/persistence";
import {
  registerSoulListCommand,
  registerSoulCommand,
  registerSoulInfoCommand,
} from "../../src/commands";
import {
  registerSessionStartHandler,
  registerResourcesDiscoverHandler,
  registerBeforeAgentStartHandler,
} from "../../src/events";

/**
 * Application layer stack.
 * Requirements are satisfied by providing NodeFileSystem + NodePath layers.
 */
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    SoulSpecLoader.Default,
    ActiveSoulPersistence.Default,
    LoggerLayer,
    NodeFileSystem.layer,
    NodePathLayer,
    // oxc can't infer the Exclude<Requirements, Outputs> type here
  ) as unknown as Layer.Layer<any, any, never>,
);

/**
 * Pi Soul Agent Extension Entry Point
 *
 * @param pi - The Pi Coding Agent Extension API
 */
export default function piSoulAgent(pi: ExtensionAPI) {
  // Register commands
  registerSoulListCommand(pi, runtime);
  registerSoulCommand(pi, runtime);
  registerSoulInfoCommand(pi, runtime);

  // Register event handlers
  registerSessionStartHandler(pi, runtime);
  registerResourcesDiscoverHandler(pi, runtime);
  registerBeforeAgentStartHandler(pi, runtime);
}
