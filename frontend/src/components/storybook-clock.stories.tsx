import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { storyNow } from "~storybook/clock";
import { expect } from "storybook/test";

import { TEST_CLOCK_INSTANT } from "~/test/clock-instant";

// Regressionstest der festen Uhr der Storybook-Tests (#7296), das Gegenstück
// zu `clock.test.tsx` der Unit-Suite. Nur im Testlauf sichtbar: Im Storybook
// am Entwicklungsrechner läuft die echte Uhr, dort schlüge `play` fehl.
const moduleScopeNow = storyNow();

function Clock() {
  return <p>{storyNow().toISOString()}</p>;
}

const meta: Meta<typeof Clock> = {
  title: "test/StorybookClock",
  component: Clock,
  tags: ["!dev", "!autodocs"],
};

export default meta;
type Story = StoryObj<typeof Clock>;

/** Fixture auf Modulebene, Render und `play` lesen denselben festen Zeitpunkt. */
export const Frozen: Story = {
  play: async ({ canvas }) => {
    const instant = TEST_CLOCK_INSTANT.toISOString();
    await expect(moduleScopeNow.toISOString()).toBe(instant);
    await expect(storyNow().toISOString()).toBe(instant);
    await expect(canvas.getByText(instant)).toBeVisible();
  },
};
