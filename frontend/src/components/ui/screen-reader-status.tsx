/**
 * A polite live region only screen readers hear (#7113, WCAG 4.1.3): the
 * end of a long task or a recomputed amount the screen already shows.
 * Keep it mounted and change `message`; a region that appears with its
 * text already inside is not announced reliably. An empty message says
 * nothing.
 */
export function ScreenReaderStatus({
  message,
  "data-testid": testId,
}: Readonly<{ message: string; "data-testid"?: string }>) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="sr-only"
      data-testid={testId}
    >
      {message}
    </p>
  );
}
