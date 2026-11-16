import { expect, test } from "@playwright/test";
import { createElement, type ComponentType, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonalCalendar } from "../../src/components/calendar/personal-calendar";
import type { CalendarEvent } from "../../src/lib/personal-calendar-api";
import { compileGlobalsCss, loadSourceModules, render } from "./harness";

let css: string;
let Calendar: ComponentType<ComponentProps<typeof PersonalCalendar>>;
test.describe.configure({ mode: "default" });
test.beforeAll(async () => {
  css = await compileGlobalsCss();
  await loadSourceModules(async (load) => {
    const calendar = await load(
      "/src/components/calendar/personal-calendar.tsx",
    );
    Calendar = calendar.PersonalCalendar as typeof Calendar;
  });
});

for (const viewMode of ["month", "week"] as const) {
  test(`narrow seven-column ${viewMode} cells retain event titles and times`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const event: CalendarEvent = {
      id: "appointment:1",
      source: "appointment",
      title: "Teambesprechung",
      start_date: "2026-09-09",
      end_date: "2026-09-10",
      start_time: "09:00",
      end_time: "10:00",
      all_day: false,
      can_respond: false,
      can_edit: false,
    };
    const markup = renderToStaticMarkup(
      createElement(Calendar, {
        events: [event],
        referenceDate: new Date(2026, 8, 9),
        viewMode,
        showWeekend: true,
      }),
    );
    await render(
      page,
      css,
      `<div style="width:640px;max-width:100%">${markup}</div>`,
    );
    const pill = page.getByRole("button", { name: /Teambesprechung/ }).first();
    await expect(pill).toBeVisible();
    const title = pill.getByText(event.title, { exact: true });
    expect((await title.boundingBox())!.width).toBeGreaterThan(35);
    await expect(pill.getByText("Termin")).toBeVisible();
    await expect(pill.getByText("09:00–10:00", { exact: true })).toBeVisible();
    expect(
      await pill.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
}
