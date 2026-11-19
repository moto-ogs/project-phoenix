// Kept apart from `runtime.ts`: client code narrows enums with it, and
// importing the runtime would pull the decoders' zod into the page bundle.

/** Narrows an open enum to the values this build knows. */
export function knownEnum<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return values.find((known) => known === value);
}
