"use client";

import { memo, useDeferredValue, useMemo } from "react";
import { BELOW_MD, useMediaQuery } from "~/lib/hooks/use-media-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import type { FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { parseISODate } from "~/lib/date-helpers";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import type { OwnTimeChartPoint } from "~/lib/contract/time-tracking.generated";

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const weekChartConfig = {
  netMinutes: {
    label: "Arbeitszeit",
    color: MOTO_COLOR_PALETTE.timeTracking.base,
  },
  breakMinutes: {
    label: "Pause",
    color: MOTO_COLOR_PALETTE.neutral.light,
  },
} satisfies ChartConfig;

function formatDateShort(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${day}.${month}`;
}

interface WeekChartPoint {
  readonly dayKey: string;
  readonly dayShort: string;
  readonly label: string;
  readonly netMinutes: number;
  readonly breakMinutes: number;
}

function useMobileViewport(): boolean {
  return useMediaQuery(BELOW_MD);
}

function chartPoints(points: readonly OwnTimeChartPoint[]): WeekChartPoint[] {
  return points.flatMap((point) => {
    if (!point.date) return [];
    const date = parseISODate(point.date);
    const dayShort = DAY_NAMES[(date.getDay() + 6) % 7] ?? "";
    return [
      {
        dayKey: point.date,
        dayShort,
        label: `${dayShort} ${formatDateShort(date)}`,
        netMinutes: point.actual_minutes,
        breakMinutes: point.break_minutes,
      },
    ];
  });
}

function tooltipLabelFormatter(
  _value: unknown,
  payload: ReadonlyArray<{ payload?: { label?: string } }>,
): string {
  return payload[0]?.payload?.label ?? "";
}

function tooltipValueFormatter(
  value: number | string | ReadonlyArray<number | string> | undefined,
  name: string | number | undefined,
): string {
  const totalMinutes = (value ?? 0) as number;
  const label = name === "netMinutes" ? "Arbeitszeit" : "Pause";
  return `${label}: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}

function WeekChartAxes({
  chartData,
  isMobile,
}: {
  readonly chartData: readonly WeekChartPoint[];
  readonly isMobile: boolean;
}) {
  return (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="dayKey"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        fontSize={isMobile ? 10 : 11}
        interval={0}
        tickFormatter={(value: string) =>
          chartData.find((entry) => entry.dayKey === value)?.dayShort ?? ""
        }
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tickMargin={4}
        fontSize={isMobile ? 10 : 12}
        interval={0}
        tickFormatter={(value: number) => `${Math.round(value / 60)}h`}
        domain={[0, "auto"]}
      />
    </>
  );
}

function WeekChartSeries() {
  return (
    <>
      <Bar
        dataKey="breakMinutes"
        stackId="a"
        fill="var(--color-breakMinutes)"
        radius={[0, 0, 4, 4]}
        isAnimationActive={false}
      />
      <Bar
        dataKey="netMinutes"
        stackId="a"
        fill="var(--color-netMinutes)"
        radius={[4, 4, 0, 0]}
        isAnimationActive={false}
      />
    </>
  );
}

function WeekChartPlot({
  chartData,
  isMobile,
}: {
  readonly chartData: readonly WeekChartPoint[];
  readonly isMobile: boolean;
}) {
  return (
    <BarChart
      accessibilityLayer
      data={chartData}
      margin={{ top: 4, right: 4, bottom: 0, left: isMobile ? -24 : -20 }}
      barCategoryGap={isMobile ? 2 : 4}
    >
      <WeekChartAxes chartData={chartData} isMobile={isMobile} />
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={tooltipLabelFormatter}
            formatter={tooltipValueFormatter}
          />
        }
      />
      <ChartLegend content={<ChartLegendContent />} />
      <WeekChartSeries />
    </BarChart>
  );
}

function WeekChartHeader({
  chartData,
}: {
  readonly chartData: readonly WeekChartPoint[];
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between sm:mb-4">
      <h2 className="text-base font-bold text-gray-900 sm:text-lg">
        Wochenübersicht
      </h2>
      <span className="text-xs text-gray-500">
        {chartData[0]?.label.split(" ")[1] ?? ""} –{" "}
        {chartData.at(-1)?.label.split(" ")[1] ?? ""}
      </span>
    </div>
  );
}

const WeekChart = memo(function WeekChart({
  points,
  error,
}: {
  readonly points: readonly OwnTimeChartPoint[];
  /** A failed history load replaces the chart: empty bars would read as a
   *  week without work (#2514). */
  readonly error?: FormErrorInput;
}) {
  const isMobile = useMobileViewport();
  const chartData = useMemo(() => chartPoints(points), [points]);
  // The clock actions and exact hours in the table need not wait for the
  // plot's layout measurements. Keep the card's space in the first commit.
  const plot = useDeferredValue(chartData, null);

  return (
    <SectionCard
      className="flex min-h-[280px] flex-col overflow-hidden md:h-full md:min-h-0"
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <WeekChartHeader chartData={plot ?? chartData} />
        {error ? (
          <LoadErrorAlert error={error} />
        ) : plot ? (
          <ChartContainer
            config={weekChartConfig}
            className="aspect-auto min-h-0 flex-1"
          >
            <WeekChartPlot chartData={plot} isMobile={isMobile} />
          </ChartContainer>
        ) : null}
      </div>
    </SectionCard>
  );
});

export default WeekChart;
