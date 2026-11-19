import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateServerRuntimeEnv } =
      await import("./lib/server-runtime-env");
    validateServerRuntimeEnv();
    // No response leaves this server with a session cookie that
    // gateSessionCookieWrites did not approve (#5520).
    const { installSessionCookieExit } =
      await import("./lib/session-cookie-exit.server");
    installSessionCookieExit();
    // A stopping replica ends its event streams so browsers reconnect to
    // another replica (#7226).
    const { installProcessDrain } = await import("./lib/process-drain.server");
    installProcessDrain();
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
