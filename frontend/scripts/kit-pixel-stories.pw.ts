import { expect, test } from "@playwright/test";

import {
  kitStories,
  openStory,
  prepareStorybookPage,
} from "./kit-pixel-storybook";

// Ein Test je Story und Breite: Story im Storybook-Build öffnen, warten, bis
// Render und `play` fertig sind, ganze Seite gegen die Baseline vergleichen.
// Start nur über `pnpm run kit-pixel` (#6562).

const stories = kitStories();

test.beforeEach(prepareStorybookPage);

for (const story of stories) {
  test(story.id, async ({ page }) => {
    await openStory(page, story.id);
    await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
  });
}
