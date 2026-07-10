import { Effect, Layer, Logger, LogLevel } from "effect";

const DEBUG_ENABLED = typeof process !== "undefined" && process.env?.PI_EXTENSIONS_DEBUG === "1";

export const LoggerLayer: Layer.Layer<never, never, never> = DEBUG_ENABLED
  ? Logger.minimumLogLevel(LogLevel.Debug)
  : Logger.minimumLogLevel(LogLevel.Info);

const log = (logFn: typeof Effect.logDebug, module: string, message: string, ...args: unknown[]) =>
  args.length > 0
    ? logFn(`[${module}] ${message}`).pipe(Effect.annotateLogs({ args: JSON.stringify(args) }))
    : logFn(`[${module}] ${message}`);

/**
 * Shorthand: log a debug message from a named module.
 * Use as: `yield* logDebug("loader", "Loading soul", soulPath)`
 */
export const logDebug = (module: string, message: string, ...args: unknown[]) =>
  log(Effect.logDebug, module, message, ...args);

/**
 * Shorthand: log an info message from a named module.
 */
export const logInfo = (module: string, message: string, ...args: unknown[]) =>
  log(Effect.logInfo, module, message, ...args);

/**
 * Shorthand: log a warning message from a named module.
 */
export const logWarning = (module: string, message: string, ...args: unknown[]) =>
  log(Effect.logWarning, module, message, ...args);

/**
 * Shorthand: log an error message from a named module.
 */
export const logError = (module: string, message: string, ...args: unknown[]) =>
  log(Effect.logError, module, message, ...args);
