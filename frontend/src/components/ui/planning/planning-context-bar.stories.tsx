import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "../button";
import { PlanningContextBar, PlanningDayChip } from "./planning-context-bar";
import { SegmentedControl } from "../segmented-control";
import { CustomSelect } from "../custom-select";

const meta = {
  title: "components/ui/planning/PlanningContextBar",
  component: PlanningContextBar,
  args: {
    dateLabel: "Mo 13.07.",
    onPrevious: () => {},
    onNext: () => {},
    onToday: () => {},
  },
} satisfies Meta<typeof PlanningContextBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    actions: (
      <Button type="button" variant="primary" size="md">
        Neu
      </Button>
    ),
  },
};

const WEEK_DAYS = [
  { weekdayLabel: "Mo", dateLabel: "13.07.", count: 2 },
  { weekdayLabel: "Di", dateLabel: "14.07.", count: 0 },
  { weekdayLabel: "Mi", dateLabel: "15.07.", count: 1 },
  { weekdayLabel: "Do", dateLabel: "16.07.", count: 0 },
  { weekdayLabel: "Fr", dateLabel: "17.07.", count: 0 },
  { weekdayLabel: "Sa", dateLabel: "18.07." },
  { weekdayLabel: "So", dateLabel: "19.07." },
];

export const WithWeekStrip: Story = {
  args: {
    dateLabel: undefined,
    navigationSlot: (
      <div className="flex items-center gap-1">
        {WEEK_DAYS.map((day, index) => (
          <PlanningDayChip
            key={day.weekdayLabel}
            {...day}
            selected={index === 0}
          />
        ))}
      </div>
    ),
  },
};

/**
 * Markierung ohne Zahl (#7493): Der gewählte Mittwoch trägt nur den Punkt,
 * weil die Statuszeile seine Zahl schon nennt. Die übrigen Tage zeigen die
 * Verteilung über die Woche. Die Ziffer hält ihren Platz, die Leiste springt
 * beim Tageswechsel nicht.
 */
export const WithWeekStripCountDotOnly: Story = {
  args: {
    dateLabel: undefined,
    navigationSlot: (
      <div className="flex items-center gap-1">
        {WEEK_DAYS.map((day, index) => (
          <PlanningDayChip
            key={day.weekdayLabel}
            {...day}
            selected={index === 2}
            countDotOnly={index === 2}
            aria-label={
              index === 2
                ? `${day.weekdayLabel} ${day.dateLabel}, 1 offene Lücke`
                : undefined
            }
          />
        ))}
      </div>
    ),
  },
};

export const WithViewSwitcher: Story = {
  args: {
    viewSwitcher: (
      <SegmentedControl
        ariaLabel="Ansicht"
        value="stoerungen"
        onChange={() => {}}
        items={[
          { value: "stoerungen", label: "Nur Störungen" },
          { value: "ganzerTag", label: "Ganzer Tag" },
        ]}
      />
    ),
  },
};

export const WithContextRow: Story = {
  args: {
    children: (
      <>
        <Button type="button" variant="ghost" size="compact">
          2 Lücken
        </Button>
        <Button type="button" variant="ghost" size="compact">
          1 quittiert
        </Button>
      </>
    ),
  },
};

/** Monatsauswahl zwischen den Pfeilen (Stichtagszahlen, #7300): ein Rahmen. */
export const WithSelectInGroup: Story = {
  args: {
    dateLabel: undefined,
    withoutContextRow: true,
    navigationInGroup: true,
    previousLabel: "Monat davor",
    nextLabel: "Monat danach",
    navigationSlot: (
      <CustomSelect
        embedded
        ariaLabel="Monat"
        value="2026-11"
        onChange={() => {}}
        options={[
          { value: "2026-11", label: "November 2026" },
          { value: "2026-10", label: "Oktober 2026" },
        ]}
      />
    ),
  },
};
