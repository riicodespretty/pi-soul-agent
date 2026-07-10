import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function notifyUI(
  ctx: ExtensionContext,
  message: string,
  level?: Parameters<ExtensionContext["ui"]["notify"]>[1],
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level ?? "info");
  }
}
