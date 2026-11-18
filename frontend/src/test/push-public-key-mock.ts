import { vi } from "vitest";
import type { PushPublicKeyRead } from "~/lib/hooks/use-push-public-key";
import { ApiError } from "~/lib/api-error";

/**
 * Stand-in for `usePushPublicKey` in component tests: the answer about the
 * server's Web Push key, without a cache or a request.
 *
 *   vi.mock("~/lib/hooks/use-push-public-key", async () =>
 *     (await import("~/test/push-public-key-mock")).pushPublicKeyModule);
 *   beforeEach(() => setPushPublicKey("ready"));
 */
export const TEST_PUSH_PUBLIC_KEY = new Uint8Array(
  65,
) as Uint8Array<ArrayBuffer>;

function readOf(
  state: PushPublicKeyRead["state"],
  failure?: unknown,
): PushPublicKeyRead {
  const missing = () =>
    state === "failed"
      ? failure
      : new ApiError("Web Push ist auf diesem Server nicht eingerichtet.", 404);
  return {
    state,
    require: () => {
      if (state === "ready") return TEST_PUSH_PUBLIC_KEY;
      throw missing();
    },
    load: () =>
      state === "ready"
        ? Promise.resolve(TEST_PUSH_PUBLIC_KEY)
        : Promise.reject(missing()),
  };
}

// One object per answer, as the hook keeps it: effects depend on it.
let current = readOf("ready");

export function setPushPublicKey(
  state: PushPublicKeyRead["state"],
  failure?: unknown,
): void {
  current = readOf(state, failure);
}

export function currentPushPublicKey(): PushPublicKeyRead {
  return current;
}

export const pushPublicKeyModule = {
  usePushPublicKey: vi.fn((_portal: string) => current),
};
