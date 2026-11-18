import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The rows with a dividing line between them. From `sm` on the actions sit
 * in one column of their own (the rows share it through `subgrid`), right
 * aligned in it, however long a row's text is. Below `sm` each row stacks:
 * text above, buttons below. Every decision is the same kit button, neither
 * way the lesser one. Rows are `ResponsiveActionRow`, their actions
 * `ResponsiveRowActions`.
 */
export function ResponsiveActionList({
  id,
  children,
}: Readonly<{ id?: string; children: ReactNode }>) {
  return (
    <ul
      id={id}
      className="divide-y divide-gray-100 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4"
    >
      {children}
    </ul>
  );
}

const ROW_ALIGN = {
  center: "sm:items-center",
  start: "sm:items-start",
} as const;

type ResponsiveActionRowProps = ComponentPropsWithoutRef<"li"> & {
  /** Vertical alignment of text and actions from `sm` on. */
  readonly align?: keyof typeof ROW_ALIGN;
};

/**
 * One row of a `ResponsiveActionList`: text first, actions second. From `sm`
 * on it spans both columns of the list and passes them on to its two
 * children (`subgrid`), so the actions of every row line up.
 * `className` adds to the row and replaces conflicting defaults.
 */
export function ResponsiveActionRow({
  align = "center",
  className,
  ...props
}: ResponsiveActionRowProps) {
  return (
    <li
      {...props}
      className={cn(
        "flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:col-span-2 sm:grid sm:grid-cols-subgrid",
        ROW_ALIGN[align],
        className,
      )}
    />
  );
}

/**
 * Inset below `sm` by the width of a leading element (icon, avatar, tile)
 * plus the `gap-3` between it and the text, so the actions start under the
 * text and not under the icon.
 */
const LEADING_INSET = {
  20: "max-sm:pl-8",
  32: "max-sm:pl-11",
  36: "max-sm:pl-12",
} as const;

const BUTTONS =
  "flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center sm:justify-end";

type SlotDivProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "className" | "style"
>;

type ResponsiveRowActionsProps = SlotDivProps &
  (
    | {
        /** Actions of equal rank, usually `Button`/`ButtonLink` `surface compact`. */
        readonly children?: ReactNode;
        /**
         * A kebab menu (`OverflowMenu`) after the actions. It stays beside
         * them on every width; alone it sits at the end of the row.
         */
        readonly menu?: ReactNode;
        /**
         * Width in px of an icon, avatar or tile in front of the text (with
         * `gap-3`). Below `sm` the actions then start under the text.
         */
        readonly leading?: keyof typeof LEADING_INSET;
        readonly field?: false;
      }
    | {
        /** One form field instead of buttons: row width on a phone, 18 rem from `sm`. */
        readonly field: true;
        readonly children: ReactNode;
        readonly menu?: never;
        readonly leading?: never;
      }
  );

/**
 * The action column of a `ResponsiveActionRow`, the only one it takes
 * (lint `ui-kit/row-actions-slot`). Below 480 px every action takes the full
 * width, one per line; from 480 px they stand side by side under the text;
 * from `sm` on they sit right in the column the rows share. Pass only the
 * actions: width, direction and alignment are decided here.
 */
export function ResponsiveRowActions({
  children,
  menu,
  leading,
  field = false,
  ...props
}: ResponsiveRowActionsProps) {
  const inset = leading === undefined ? undefined : LEADING_INSET[leading];
  if (field) {
    return (
      <div {...props} className={cn("w-full sm:w-72", inset)}>
        {children}
      </div>
    );
  }
  if (menu === undefined || menu === null) {
    return (
      <div {...props} className={cn(BUTTONS, inset)}>
        {children}
      </div>
    );
  }
  const hasActions =
    children !== undefined && children !== null && children !== false;
  return (
    <div
      {...props}
      className={cn(
        "flex items-center gap-2 sm:justify-end",
        hasActions ? null : "justify-end",
        inset,
      )}
    >
      {hasActions ? (
        <div className={cn(BUTTONS, "min-w-0 flex-1 min-[480px]:flex-none")}>
          {children}
        </div>
      ) : null}
      <div className="flex shrink-0">{menu}</div>
    </div>
  );
}
