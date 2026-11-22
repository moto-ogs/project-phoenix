import { afterAll, describe, expect, it } from "vitest";
import { lintSource, removeProbeDirectories } from "./oxlint-probe";

afterAll(removeProbeDirectories);

const RULE = "backend-url(only-server-api-url)";
const SERVER_FILE = "src/lib/probe-route.server.ts";

describe.concurrent("backend-url/only-server-api-url", () => {
  it.each([
    [
      "a template URL",
      "export const f = () => fetch(`${process.env.API_URL}/api/rooms`);",
    ],
    ["a computed key", 'export const url = process.env["API_URL"];'],
    [
      "globalThis.process",
      "export const url = globalThis.process.env.API_URL;",
    ],
    [
      "destructuring",
      "const { API_URL } = process.env; export const url = API_URL;",
    ],
    [
      "a renamed binding",
      "const { API_URL: base } = process.env; export const url = base;",
    ],
    [
      "the validated env",
      'import { env } from "~/env"; export const url = env.API_URL;',
    ],
  ])("rejects reading API_URL through %s", async (_, source) => {
    const result = await lintSource(source, SERVER_FILE);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(RULE);
  });

  it("lets the one reader and the env schema read it", async () => {
    const reader = await lintSource(
      "export const url = () => process.env.API_URL;",
      "src/lib/server-api-url.ts",
    );
    expect(reader.output).not.toContain(RULE);
    const schema = await lintSource(
      "export const runtimeEnv = { API_URL: process.env.API_URL };",
      "src/env.js",
    );
    expect(schema.output).not.toContain(RULE);
  });

  it("lets test setup set it and other keys pass", async () => {
    const result = await lintSource(
      'process.env.API_URL = "http://server:8080"; export const other = process.env.NEXT_PUBLIC_API_URL;',
      "src/test/setup-probe.ts",
    );
    expect(result.output).not.toContain(RULE);
  });
});
