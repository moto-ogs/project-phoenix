"use client";

// Rangfolge des Standortvergleichs (#4715): ein liegender Balken je Schule,
// die größte Zahl oben, und eine gestrichelte Linie für den Schnitt der
// Schulen. Belegte Plätze ab 100 % färben sich orange wie in der Auslastung.
// Die Seite lädt die Datei erst, wenn sie das Diagramm zeigt (recharts ist
// groß).

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import type { ComparisonMetric } from "~/lib/traeger-comparison-api";
import {
  COMPARISON_CHART_COLORS,
  formatMetric,
  metricInfo,
  type RankingEntry,
} from "./comparison-model";

/** Höhe je Schule; so bleiben auch 30 Schulen lesbar. */
const ROW_HEIGHT = 36;
/** Auf dem Telefon steht der Name über dem Balken und braucht eine Zeile. */
const PHONE_ROW_HEIGHT = 52;

/**
 * Der Name über dem Balken, auf dem Telefon: eine Achse links ließe dort
 * kaum Platz für die Balken.
 */
function nameAboveBar(props: {
  readonly x?: number | string;
  readonly y?: number | string;
  readonly value?: unknown;
}) {
  return (
    <text
      x={Number(props.x ?? 0)}
      y={Number(props.y ?? 0) - 6}
      className="fill-gray-700"
      fontSize={12}
      fontWeight={500}
    >
      {String(props.value ?? "")}
    </text>
  );
}

interface Point {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly label: string;
  /** recharts nimmt die Farbe eines Balkens aus seinem Datenpunkt. */
  readonly fill: string;
}

/** Die Zeile im Tooltip: Kennzahl links, Zahl in ihrer Schreibweise rechts. */
function tooltipRow(label: string) {
  return function TooltipRow(
    _value: unknown,
    _name: unknown,
    item: { readonly payload?: unknown },
  ) {
    const point = item.payload as Point;
    return (
      <span className="flex w-full justify-between gap-4">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold text-gray-900 tabular-nums">
          {point.label}
        </span>
      </span>
    );
  };
}

export function ComparisonChart({
  entries,
  metric,
  average,
}: Readonly<{
  entries: readonly RankingEntry[];
  metric: ComparisonMetric;
  average: number | undefined;
}>) {
  const phone = useMediaQuery(BELOW_SM);
  const info = metricInfo(metric);
  const share = info.format === "share";
  const data: Point[] = entries.map((entry) => {
    const value = share ? entry.value * 100 : entry.value;
    return {
      id: entry.school.id,
      name: entry.school.name,
      value,
      label: formatMetric(metric, entry.value),
      fill:
        share && value >= 100
          ? COMPARISON_CHART_COLORS.full
          : COMPARISON_CHART_COLORS.value,
    };
  });
  const reference =
    average === undefined || entries.length < 2
      ? undefined
      : share
        ? average * 100
        : average;
  const config = {
    value: { label: info.label, color: COMPARISON_CHART_COLORS.value },
  } satisfies ChartConfig;
  const longestName = Math.max(...data.map((point) => point.name.length), 8);
  // 12-px names need up to 8 px a letter, plus room before the bar; a
  // narrower axis wraps the name onto two lines.
  const axisWidth = Math.min(Math.max(longestName * 8 + 32, 120), 240);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{
        height: Math.max(
          data.length * (phone ? PHONE_ROW_HEIGHT : ROW_HEIGHT) + 40,
          140,
        ),
      }}
    >
      <BarChart
        accessibilityLayer
        layout="vertical"
        data={data}
        margin={{ top: phone ? 24 : 16, right: 56, left: 0, bottom: 0 }}
        barCategoryGap={8}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          domain={share ? [0, (max: number) => Math.max(100, max)] : undefined}
          tickFormatter={(value: number) =>
            share ? `${value} %` : String(value)
          }
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={phone ? 0 : axisWidth}
          hide={phone}
          interval={0}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-value)", fillOpacity: 0.08 }}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={tooltipRow(info.label)}
            />
          }
        />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          maxBarSize={22}
          // A school with 0 keeps a sliver and its label, so it reads as 0
          // and not as missing.
          minPointSize={2}
          isAnimationActive={false}
        >
          {phone ? <LabelList dataKey="name" content={nameAboveBar} /> : null}
          <LabelList
            dataKey="label"
            position="right"
            className="fill-gray-900 tabular-nums"
            fontSize={12}
            fontWeight={600}
          />
        </Bar>
        {reference === undefined ? null : (
          <ReferenceLine
            x={reference}
            stroke={COMPARISON_CHART_COLORS.average}
            strokeDasharray="5 4"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
          />
        )}
      </BarChart>
    </ChartContainer>
  );
}
