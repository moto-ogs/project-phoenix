import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";

import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import type {
  TraegerListFile,
  TraegerListFormat,
} from "~/lib/traeger-list-export";

import {
  TraegerListExportMenu,
  traegerExportScope,
  useTraegerListExportItems,
} from "./traeger-list-export-menu";

// Die zwei Formen des Träger-Downloads (#7403): im Seitenkopf als Einträge im
// Drei-Punkte-Menü, auf einer Karte ohne eigenes Seitenmenü als Knopf.

const meta = {
  title: "traeger/TraegerListExportMenu",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** The story never downloads: the file stays in creation. */
function download(_format: TraegerListFormat): Promise<TraegerListFile> {
  return new Promise(() => undefined);
}

const exportProps = {
  download,
  scope: traegerExportScope(),
  fallbackName: "belegung",
  errorObject: "die Belegung",
} as const;

/** Seitenkopf: der Download steht im Drei-Punkte-Menü unter „Herunterladen“. */
export const ImSeitenmenue: Story = {
  render: function Render() {
    const exportItems = useTraegerListExportItems(exportProps);
    return (
      <TenantPage
        title="Belegung"
        stats="412 Kinder · 9 Schulen"
        overflowMenu={exportItems}
      >
        <SectionCard title="Schulen">
          <p className="text-sm text-gray-600">Inhalt der Seite</p>
        </SectionCard>
      </TenantPage>
    );
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: /Weitere Aktionen/ }),
    );
    const heading = await screen.findByText("Herunterladen");
    await expect(heading).toBeVisible();
    await expect(screen.getByText("Alle Schulen")).toBeVisible();
    // The open menu lies over the head card, not under it: the card that
    // holds the trigger must not lift itself above the portaled menu.
    const box = heading.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    await expect(screen.getByRole("menu").contains(topmost)).toBe(true);
  },
};

/** Karte ohne eigenes Seitenmenü: der Knopf „Herunterladen ▾“. */
export const AufKarte: Story = {
  render: () => (
    <SectionCard
      title="Verlauf"
      actions={
        <TraegerListExportMenu
          {...exportProps}
          ariaLabel="Verlauf herunterladen"
        />
      }
    >
      <p className="text-sm text-gray-600">Inhalt der Karte</p>
    </SectionCard>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: /Verlauf herunterladen/,
      }),
    );
    await expect(await screen.findByText("Alle Schulen")).toBeVisible();
  },
};
