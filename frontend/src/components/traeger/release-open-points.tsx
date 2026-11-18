import type { ReactNode } from "react";
import { Alert } from "~/components/ui/alert";

/** „1 Familie“ / „3 Familien“. */
export function familiesLabel(count: number): string {
  return count === 1 ? "1 Familie" : `${count} Familien`;
}

/**
 * One open point; its action is the way to fix it before releasing. It
 * leads out of the release question, so it is a `ButtonLink` with
 * `variant="surface" size="compact" newTab` (`ui/jump-button`).
 */
export interface OpenPoint {
  readonly text: string;
  readonly action?: ReactNode;
}

/**
 * What a run preview still asks to check, repeated in the release question.
 * The release numbers the invoices for good, so the hints from further down
 * the page stand where the decision is made. Each point carries its own way
 * to fix it, so an action never reads as the fix of another point.
 */
export function ReleaseOpenPoints({
  points,
}: Readonly<{
  points: readonly (string | OpenPoint)[];
}>) {
  if (points.length === 0) return null;
  const items = points.map((point) =>
    typeof point === "string" ? { text: point } : point,
  );
  // The list goes in `details`: the symbol then stands beside the title, not
  // beside a point in the middle, where it would mark that point alone.
  return (
    <Alert
      type="warning"
      announce="off"
      className="mt-3"
      title="Noch offen"
      message="Du kannst das vorher klären oder trotzdem freigeben."
      details={
        <ul className="mt-2 list-disc space-y-2 pl-4">
          {items.map((point) => (
            <li key={point.text}>
              <span>{point.text}</span>
              {point.action ? (
                <span className="mt-1.5 block">{point.action}</span>
              ) : null}
            </li>
          ))}
        </ul>
      }
    />
  );
}
