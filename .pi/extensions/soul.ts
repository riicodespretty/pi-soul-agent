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
  registerSoulHeartbeatCommand,
} from "../../src/commands";
import {
  registerSessionStartHandler,
  registerResourcesDiscoverHandler,
  registerBeforeAgentStartHandler,
  registerHeartbeatReminderHandler,
} from "../../src/events";

/**
 * Application layer stack.
 * Requirements are satisfied by providing NodeFileSystem + NodePath layers.
 */
const runtime = ManagedRuntime.make(
  SoulSpecLoader.Default.pipe(
    Layer.provideMerge(NodeFileSystem.layer),
    Layer.provideMerge(NodePathLayer),
    Layer.provideMerge(
      ActiveSoulPersistence.Default.pipe(
        Layer.provideMerge(NodeFileSystem.layer),
        Layer.provideMerge(NodePathLayer),
      ),
    ),
    Layer.provideMerge(LoggerLayer),
  ),
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
  registerSoulHeartbeatCommand(pi, runtime);

  // Register event handlers
  registerSessionStartHandler(pi, runtime);
  registerResourcesDiscoverHandler(pi, runtime);
  registerBeforeAgentStartHandler(pi, runtime);
  registerHeartbeatReminderHandler(pi, runtime);
}
