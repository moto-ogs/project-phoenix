/**
 * The entry of a lookup table for a value the contract may leave undefined:
 * a value this build does not know (`knownEnum`, ADR 0270 point 6) gets the
 * fallback instead of an empty cell.
 */
export function labelOf<K extends string, V>(
  table: Readonly<Record<K, V>>,
  key: K | undefined,
  fallback: V,
): V {
  return key === undefined ? fallback : table[key];
}
