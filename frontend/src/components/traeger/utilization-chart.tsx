"use client";

// Verlauf der Auslastung (#4713): eine grüne Fläche für die Belegung, eine
// gestrichelte Linie für die Plätze und eine blaue Linie für die Kinder, die
// da waren. Dieselbe Bildsprache auf allen drei Reitern. Die Seite lädt die
// Datei erst, wenn sie das Diagramm zeigt (recharts ist groß).

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import type { UtilizationPoint } from "./utilization-model";

export interface UtilizationChartLabels {
  /** „Belegte Plätze“, „Gebuchte Kinder“, „Höchstens gleichzeitig“ */
  readonly belegt: string;
  /** „Kinder anwesend“ oder „Kinder im Raum“; ohne Angabe keine Linie. */
  readonly second?: string;
}

/** Die Farben des Diagramms; die Legende der Seite nimmt dieselben. */
export const UTILIZATION_CHART_COLORS = {
  places: MOTO_COLOR_PALETTE.neutral.light,
  belegt: MOTO_COLOR_PALETTE.green.base,
  second: MOTO_COLOR_PALETTE.blue.base,
} as const;

const NUMBER = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Eine Zeile im Tooltip: Bezeichnung links, Zahl rechts. */
function tooltipRow(config: ChartConfig) {
  return function TooltipRow(value: unknown, name: unknown) {
    const key = String(name);
    return (
      <span className="flex w-full justify-between gap-4">
        <span className="text-gray-600">{config[key]?.label ?? key}</span>
        <span className="font-semibold text-gray-900 tabular-nums">
          {NUMBER.format(Number(value))}
        </span>
      </span>
    );
  };
}

export function UtilizationChart({
  data,
  labels,
}: Readonly<{
  data: readonly UtilizationPoint[];
  labels: UtilizationChartLabels;
}>) {
  const secondKey = data.some((point) => point.anwesend !== undefined)
    ? "anwesend"
    : "kinder";
  const config = {
    places: { label: "Plätze", color: UTILIZATION_CHART_COLORS.places },
    belegt: { label: labels.belegt, color: UTILIZATION_CHART_COLORS.belegt },
    [secondKey]: {
      label: labels.second ?? "",
      color: UTILIZATION_CHART_COLORS.second,
    },
  } satisfies ChartConfig;
  // Few points read better with a marker on each; many points stay a curve.
  const dots = data.length <= 16;
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <ComposedChart
        accessibilityLayer
        data={[...data]}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="utilization-belegt" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-belegt)"
              stopOpacity={0.35}
            />
            <stop
              offset="100%"
              stopColor="var(--color-belegt)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          fontSize={11}
          width={40}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_label, payload) => {
                const point = payload?.[0]?.payload as
                  { fullLabel?: string } | undefined;
                return point?.fullLabel ?? "";
              }}
              formatter={tooltipRow(config)}
            />
          }
        />
        <Area
          dataKey="belegt"
          name="belegt"
          type="monotone"
          stroke="var(--color-belegt)"
          strokeWidth={2.5}
          fill="url(#utilization-belegt)"
          dot={dots ? { r: 3, fill: "var(--color-belegt)" } : false}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        {labels.second ? (
          <Line
            dataKey={secondKey}
            name={secondKey}
            type="monotone"
            stroke={`var(--color-${secondKey})`}
            strokeWidth={2}
            dot={dots ? { r: 2.5, fill: `var(--color-${secondKey})` } : false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ) : null}
        <Line
          dataKey="places"
          name="places"
          type="stepAfter"
          stroke="var(--color-places)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
