import { describe, expect, it } from "vitest";

// swr/no-direct-import permits package imports inside this shared wrapper only.
import { initCache, internalMutate } from "swr/_internal";

/**
 * patches/swr@2.5.1.patch: Safari 26 threw `undefined is not a function
 * (near '...[t,r,i,o]...')` where SWR's mutate destructured its rest
 * parameter, after the write was saved (#2459). These tests fail when the
 * patch is missing, and hold what the patch must not change: SWR counts the
 * arguments of a mutate.
 */
describe("patched SWR mutate", () => {
  it("names its parameters instead of destructuring a rest parameter", () => {
    const source = Function.prototype.toString.call(internalMutate);
    const head = source.slice(0, source.indexOf("{"));

    expect(head).not.toContain("...");
    expect(internalMutate).toHaveLength(4);
  });

  it("revalidates without data and clears with an explicit undefined", async () => {
    const [cache, mutate] = initCache(new Map()) as unknown as [
      Map<string, { data?: unknown }>,
      (key: string, data?: unknown, options?: unknown) => Promise<unknown>,
    ];

    await mutate("key", "saved", { revalidate: false });
    expect(cache.get("key")?.data).toBe("saved");

    // No mounted reader: a revalidation changes nothing and reports the data.
    await expect(mutate("key")).resolves.toBe("saved");
    expect(cache.get("key")?.data).toBe("saved");

    await mutate("key", undefined, { revalidate: false });
    expect(cache.get("key")?.data).toBeUndefined();
  });
});
