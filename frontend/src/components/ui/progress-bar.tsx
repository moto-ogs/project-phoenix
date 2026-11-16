const TONE_CLASS = {
  green: "bg-moto-green",
  orange: "bg-moto-orange",
  dark: "bg-gray-900",
} as const;

const SIZE_CLASS = {
  xs: "h-1 bg-gray-100",
  sm: "h-1.5 bg-gray-100",
  md: "h-2 bg-gray-200",
} as const;

interface ProgressBarBaseProps {
  /** Vorgelesen statt der Zahl, zum Beispiel „3 von 6 Schritten erledigt“. */
  readonly label: string;
  readonly tone?: keyof typeof TONE_CLASS;
  /** Farbe aus Daten als Hex; hat Vorrang vor `tone`. */
  readonly color?: string;
  readonly size?: keyof typeof SIZE_CLASS;
  readonly className?: string;
}

type ProgressBarProps = ProgressBarBaseProps &
  (
    | {
        /** Erledigte Teile. */
        readonly value: number;
        readonly max: number;
        readonly indeterminate?: undefined;
      }
    | {
        /**
         * Läuft, ohne einen Anteil zu nennen: für ein Warten, dessen Dauer
         * niemand kennt, etwa eine Weiterleitung. Ohne Bewegung (reduzierte
         * Bewegung) steht der Balken ruhig und voll.
         */
        readonly indeterminate: true;
        readonly value?: undefined;
        readonly max?: undefined;
      }
  );

/**
 * Ein durchgehender Fortschrittsbalken, etwa für eine Checkliste. Für
 * nummerierte Schritte eines Ablaufs gibt es `WizardStepper`.
 */
export function ProgressBar(props: ProgressBarProps) {
  const { label, tone = "green", color, size = "md", className = "" } = props;
  const fill = color ? "" : TONE_CLASS[tone];
  const fillStyle = color ? { backgroundColor: color } : undefined;

  if (props.indeterminate) {
    // Ohne aria-valuenow gilt der Balken als unbestimmt (ARIA progressbar).
    return (
      <div
        role="progressbar"
        aria-label={label}
        className={`w-full overflow-hidden rounded-full ${SIZE_CLASS[size]} ${className}`}
      >
        <div
          className={`moto-progress-indeterminate h-full w-2/5 rounded-full ${fill}`}
          style={fillStyle}
        />
      </div>
    );
  }

  const { value, max } = props;
  const bounded = Math.min(Math.max(value, 0), max);
  const percent = max > 0 ? (bounded / max) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={bounded}
      className={`w-full overflow-hidden rounded-full ${SIZE_CLASS[size]} ${className}`}
    >
      <div
        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 ${fill}`}
        style={{ width: `${percent}%`, ...fillStyle }}
      />
    </div>
  );
}
