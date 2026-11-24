"use client";

import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";

interface WizardStepperProps {
  readonly steps: readonly string[];
  readonly current: number;
  readonly className?: string;
  /**
   * Names every step under its bar instead of „Schritt 1 von 3“ and the
   * current name: for a process the person reads ahead (a billing run),
   * not for a dialog that walks through it.
   */
  readonly labeled?: boolean;
}

const ACTIVE = MOTO_COLOR_PALETTE.green.base;
const INACTIVE = "#E5E7EB";
const ACTIVE_TEXT = "#1F2937";

export function WizardStepper({
  steps,
  current,
  className = "",
  labeled = false,
}: Readonly<WizardStepperProps>) {
  const total = steps.length;
  const clampedCurrent = Math.max(0, Math.min(current, total - 1));

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* The bars draw the progress; the text below says it, with the step
          names and aria-current (#7112). A div without a role carries no
          name, and an empty bar no current step. */}
      <div className="flex items-center gap-2" aria-hidden="true">
        {steps.map((label, index) => {
          const isActive = index <= clampedCurrent;
          return (
            <div key={label} className="flex flex-1 items-center">
              <div
                className="h-2 flex-1 rounded-full transition-colors duration-300"
                style={{ backgroundColor: isActive ? ACTIVE : INACTIVE }}
              />
            </div>
          );
        })}
      </div>
      {labeled ? (
        // One name under each bar; on a phone one step per line, where
        // only the weight and the shade mark the current step: the other
        // steps stay a clear step lighter. text-pretty: a long name never
        // leaves its last word alone on a line.
        <ol className="flex gap-2 text-sm max-sm:flex-col max-sm:gap-1">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === clampedCurrent ? "step" : undefined}
              className={`min-w-0 flex-1 text-pretty ${index === clampedCurrent ? "font-semibold" : "text-gray-500"}`}
              style={
                index === clampedCurrent ? { color: ACTIVE_TEXT } : undefined
              }
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium" style={{ color: ACTIVE_TEXT }}>
            Schritt {clampedCurrent + 1} von {total}
          </span>
          {/* The name of the current step is read, not decoration: it keeps
              the contrast of body text (WCAG 1.4.3). */}
          <span className="text-gray-600">{steps[clampedCurrent]}</span>
        </div>
      )}
    </div>
  );
}
