import { useId } from "react";
import { Check, Circle } from "lucide-react";
import { InsetPanel } from "~/components/ui/inset-panel";
import { cn } from "~/lib/utils";

const SIZE_CLASSES = {
  sm: {
    title: "mb-2",
    list: "grid-cols-2 gap-x-3 gap-y-1.5",
    item: "gap-1.5 text-xs",
    mark: "h-4 w-4",
    glyph: "h-3 w-3",
  },
  md: {
    title: "mb-3",
    list: "gap-1.5 sm:grid-cols-2 sm:gap-2",
    item: "gap-2 text-sm",
    mark: "h-5 w-5",
    glyph: "h-3.5 w-3.5",
  },
} as const;

/**
 * The password rules next to a new password, each ticked once met. The
 * caller computes the status from `PASSWORD_RULES` (`~/lib/password-rules`).
 *
 * The state of a rule is not carried by the symbol alone (#7114, WCAG
 * 1.1.1/1.4.1): a check or an empty circle shows it, and a hidden text after
 * the label reads it out.
 */
export function PasswordRequirements({
  requirements,
  title = "Passwortanforderungen",
  metLabel = "erfüllt",
  unmetLabel = "noch nicht erfüllt",
  size = "sm",
}: Readonly<{
  requirements: readonly { readonly label: string; readonly met: boolean }[];
  /** Translated heading; the staff portals keep the German default. */
  title?: string;
  /** Translated state read after a met rule. */
  metLabel?: string;
  /** Translated state read after a rule not met yet. */
  unmetLabel?: string;
  /** `md`: larger text for the parents' invitation form. */
  size?: keyof typeof SIZE_CLASSES;
}>) {
  const titleId = useId();
  const classes = SIZE_CLASSES[size];
  return (
    <InsetPanel framed>
      <p
        id={titleId}
        className={cn("text-xs font-medium text-gray-700", classes.title)}
      >
        {title}
      </p>
      <ul aria-labelledby={titleId} className={cn("grid", classes.list)}>
        {requirements.map((requirement) => (
          <li
            key={requirement.label}
            className={cn("flex items-center", classes.item)}
          >
            <span
              className={cn(
                "flex flex-shrink-0 items-center justify-center rounded-full border",
                classes.mark,
                requirement.met
                  ? "border-moto-green bg-moto-green/10 text-moto-green-strong"
                  : "border-gray-300 bg-white text-gray-400",
              )}
              aria-hidden="true"
            >
              {requirement.met ? (
                <Check className={classes.glyph} />
              ) : (
                <Circle className={classes.glyph} />
              )}
            </span>
            <span
              className={requirement.met ? "text-gray-700" : "text-gray-500"}
            >
              {requirement.label}
              <span className="sr-only">
                : {requirement.met ? metLabel : unmetLabel}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </InsetPanel>
  );
}
