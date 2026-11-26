"use client";

/**
 * Gemeinsame Anlege-Geste der Planungsraster (#2031). Die gestrichelte
 * Fläche und das Plus werden auf dem Knopf gezeichnet, ohne einen
 * zusätzlichen Knoten je leerer Rasterzelle oder Stunde.
 */
export const PLAN_ADD_AFFORDANCE =
  "before:pointer-events-none before:absolute before:rounded-md before:border before:border-dashed before:border-gray-200 before:text-gray-500 before:transition hover:before:border-gray-300 hover:before:text-gray-600 before:bg-center before:bg-no-repeat before:[background-image:linear-gradient(currentColor,currentColor),linear-gradient(currentColor,currentColor)] before:[background-size:0.583rem_1.33px,1.33px_0.583rem] [@media(hover:hover)_and_(pointer:fine)]:before:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:hover:before:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:before:opacity-100";

export function PlanAddButton({
  label,
  onClick,
  disabled,
}: Readonly<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={`relative flex h-7 w-full rounded-md before:inset-0 focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:outline-none disabled:cursor-wait disabled:opacity-40 ${PLAN_ADD_AFFORDANCE}`}
    />
  );
}
