import { afterAll, afterEach, expect } from "vitest";

/**
 * Component tests answer every request with a mock, never the network
 * (#7216). An unmocked `fetch` goes to the test origin
 * (http://localhost:3000): CI refuses the connection, a local dev server on
 * that port answers it, and the answer may arrive while a later test runs.
 * The outcome then depends on the machine. The guard answers such a request
 * at once with a network error and fails the test that sent it.
 */
const unmockedRequests: string[] = [];

function requestLine(input: RequestInfo | URL, init?: RequestInit): string {
  if (input instanceof Request) return `${input.method} ${input.url}`;
  const url = input instanceof URL ? input.href : input;
  return `${init?.method ?? "GET"} ${url}`;
}

/** The first frames in application code show which call sent the request. */
function callSite(): string {
  return (new Error().stack ?? "")
    .split("\n")
    .filter((line) => line.includes("/src/") && !line.includes("network-guard"))
    .slice(0, 3)
    .map((line) => `    ${line.trim()}`)
    .join("\n");
}

function unmockedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = requestLine(input, init);
  const test = expect.getState().currentTestName ?? "outside a test";
  unmockedRequests.push(`${request} (${test})\n${callSite()}`);
  return Promise.reject(
    new TypeError(`Unmocked request in a test: ${request}`),
  );
}

/**
 * Replaces the environment's fetch for this test file. Tests that need a
 * response still mock `fetch` or the API module as before; the worker reset
 * restores the environment's fetch after every file.
 */
export function installNetworkGuard(): void {
  globalThis.fetch = unmockedFetch;
}

// Captured before a test file can install fake timers.
const realSetTimeout = globalThis.setTimeout;
const realSetImmediate = globalThis.setImmediate;

function failOnUnmockedRequests(): void {
  if (unmockedRequests.length === 0) return;
  const requests = unmockedRequests.splice(0);
  throw new Error(
    `${requests.length} request(s) reached the network instead of a mock. ` +
      `Mock the API module or fetch for:\n${requests.join("\n")}`,
  );
}

// Each entry names the test that sent it. A request an effect sends after
// its test ended is reported by the next check, still under its own name.
afterEach(failOnUnmockedRequests);
// After the file's last test, wait for zero-delay timers once so a late
// request is still reported before the worker moves on to the next file.
afterAll(async () => {
  await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
  await new Promise<void>((resolve) => realSetImmediate(resolve));
  failOnUnmockedRequests();
});
