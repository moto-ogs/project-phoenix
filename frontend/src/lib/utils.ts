import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Compare selections by membership, ignoring order and repeated values. */
export function sameSetMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const selected = new Set(left);
  const available = new Set(right);
  return (
    selected.size === available.size &&
    [...selected].every((value) => available.has(value))
  );
}
