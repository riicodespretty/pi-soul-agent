import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Notify the user via UI if available.
 * Safely wraps the pattern: `if (ctx.hasUI) ctx.ui.notify(message, level)`
 */
export function notifyUI(
  ctx: ExtensionContext,
  message: string,
  level?: Parameters<ExtensionContext["ui"]["notify"]>[1],
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level ?? "info");
  }
}
