import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { OverlaySheet } from "~/components/ui/overlay-sheet";

const meta: Meta<typeof OverlaySheet> = {
  title: "components/ui/OverlaySheet",
  component: OverlaySheet,
};

export default meta;
type Story = StoryObj<typeof OverlaySheet>;

function Demo({ size }: { size?: "half" | "full" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" noTooltip="Story" onClick={() => setOpen(true)}>
        Blatt öffnen
      </Button>
      <OverlaySheet
        open={open}
        onOpenChange={setOpen}
        title="Filter"
        size={size}
        footer={
          <Button
            type="button"
            className="w-full"
            noTooltip="Story"
            onClick={() => setOpen(false)}
          >
            Fertig
          </Button>
        }
      >
        <p className="text-sm text-gray-700">
          Am Telefon halbe oder volle Höhe, am iPad eine Karte, am Desktop das
          mittige Fenster.
        </p>
      </OverlaySheet>
    </>
  );
}

export const Halb: Story = { render: () => <Demo /> };
export const Voll: Story = { render: () => <Demo size="full" /> };
