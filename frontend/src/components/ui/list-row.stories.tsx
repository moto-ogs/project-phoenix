import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { ListRow } from "./list-row";
import { StatusBadge } from "./status-badge";

// Zeile als eigene Fläche (Startseite, Kinder in einem Block, Personen im
// Panel). Die Stories zeigen die bedienbaren Formen in einer Zeile Text: So
// misst die Trefferflächen-Prüfung (#8060) die niedrigste Höhe.

const meta = {
  title: "components/ui/ListRow",
  component: ListRow,
  parameters: {
    layout: "padded",
  },
  args: {
    children: <span className="text-sm text-gray-900">Mia Schneider</span>,
  },
} satisfies Meta<typeof ListRow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Die ganze Zeile ist ein Link. */
export const AsLink: Story = {
  args: { href: "/students/1" },
};

/** Die ganze Zeile ist ein Knopf. */
export const AsButton: Story = {
  args: { onClick: fn() },
};

/** Dicht, für Karten fester Höhe; rechts eine Pille. */
export const CompactWithTrailing: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      <ListRow
        href="/students/1"
        density="compact"
        trailing={<StatusBadge tone="green" label="Anwesend" />}
      >
        <span className="text-sm text-gray-900">Mia Schneider</span>
      </ListRow>
      <ListRow
        href="/students/2"
        density="compact"
        trailing={<StatusBadge tone="gray" label="Zuhause" />}
      >
        <span className="text-sm text-gray-900">Noah Weber</span>
      </ListRow>
    </div>
  ),
};

/** Ohne `href` und `onClick`: reine Anzeige, nichts zum Antippen. */
export const DisplayOnly: Story = {};
