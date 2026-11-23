// Kept apart from `runtime.ts`: client code narrows enums with it, and
// importing the runtime would pull the decoders' zod into the page bundle.

/** Narrows an open enum to the values this build knows. */
export function knownEnum<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return values.find((known) => known === value);
}

/**
 * An open enum the page cannot work without: a value this build does not
 * know fails the read like a broken required field (ADR 0270 point 6), so
 * nothing saves a guessed value back.
 */
export function requiredEnum<T extends string>(
  values: readonly T[],
  value: string,
  field: string,
): T {
  const known = knownEnum(values, value);
  if (known === undefined) {
    throw new Error(`contract: ${field} has an unknown value`);
  }
  return known;
}
