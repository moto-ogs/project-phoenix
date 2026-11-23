import { afterAll, describe, expect, it } from "vitest";
import { lintSource, removeProbeDirectories } from "./oxlint-probe";

afterAll(removeProbeDirectories);

describe.concurrent("bff-boundary", () => {
  it.each([
    "fetch('/api/rooms')",
    "window.fetch = replacement",
    "const f = fetch; f('/api/rooms')",
    "const { fetch: f } = window",
    "let f; ({ fetch: f } = globalThis)",
    "fetch.call(null, '/api/rooms')",
    "self['fetch']",
    "const win = window; win.fetch('/api/rooms')",
    "let win = window; win.fetch('/api/rooms')",
    "let win: Window; win = window; export const send = win.fetch",
    "const { navigator: nav } = window; nav.sendBeacon('/api/log')",
    "globalThis.window.fetch",
    "(window as Window).fetch('/api/rooms')",
    "document.defaultView?.fetch('/api/rooms')",
    "const { navigator: { sendBeacon } } = self",
    "sessionFetch('/api/rooms')",
    "navigator.sendBeacon('/api/log')",
    "const { sendBeacon } = window.navigator",
    "new XMLHttpRequest()",
    "globalThis.XMLHttpRequest",
  ])("rejects raw browser transport: %s", async (source) => {
    const result = await lintSource(source);
    expect(result.output).toContain("bff-boundary(no-raw-browser-transport)");
  });

  it.each([
    "import { bffJsonUncontracted as x } from '~/lib/bff-fetch'; x()",
    "import { bffJsonUncontracted as x } from '~/lib/../lib/bff-fetch'; x()",
    "export { bffJsonUncontracted as x } from '~/lib/bff-fetch'",
    "export * from '../lib/bff-fetch'",
    "import * as bff from '~/lib/bff-fetch'; bff['bffJsonUncontracted']()",
    "const { bffJsonUncontracted: x } = await import('~/lib/bff-fetch'); x()",
    "const { bffJsonUncontracted: x } = require('~/lib/bff-fetch'); x()",
  ])("rejects access to the uncontracted helper: %s", async (source) => {
    const result = await lintSource(source);
    expect(result.output).toContain("bff-boundary(only-listed-uncontracted)");
  });

  it("does not let an allowlisted caller forward the helper", async () => {
    const result = await lintSource(
      "import { bffJsonUncontracted as x } from './bff-fetch'; export { x }",
      "src/lib/demo-access.ts",
    );
    expect(result.output).toContain("bff-boundary(only-listed-uncontracted)");
  });

  it.each([
    ["src/lib/probe.server.ts", "fetch('/api/rooms')"],
    ["src/lib/bff-fetch.ts", "fetch('/api/rooms')"],
    [
      "src/lib/demo-access.ts",
      "import { bffJsonUncontracted as x } from './bff-fetch'; x()",
    ],
    ["src/lib/probe.ts", "const fetch = () => 1; fetch()"],
    ["src/lib/probe.ts", "const send: typeof fetch = fakeSend; send('/')"],
    ["src/lib/probe.ts", "const window = { fetch: () => 1 }; window.fetch()"],
    ["src/lib/probe.ts", "let win; win = { fetch: () => 1 }; win.fetch()"],
    ["src/lib/probe.ts", "import { bffJson } from './bff-fetch'; bffJson()"],
  ])("allows valid code in %s: %s", async (path, source) => {
    const result = await lintSource(source, path);
    expect(result.output).not.toContain("bff-boundary(");
  });
});
