import { expect, test } from "@playwright/test";
import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  SearchBarDraftProvider,
  SharedSearchBar,
} from "../../src/components/ui/page-header/SearchBar";
import { compileGlobalsCss, loadSourceModules, render } from "./harness";

test("a wrapped validation hint does not displace the search icon or clear button", async ({
  page,
}) => {
  const css = await compileGlobalsCss();
  const field = await loadSourceModules(async (importSource) => {
    const search = await importSource(
      "/src/components/ui/page-header/SearchBar.tsx",
    );
    type ProviderProps = ComponentProps<typeof SearchBarDraftProvider>;
    const Provider = search.SearchBarDraftProvider as ComponentType<
      PropsWithChildren<Omit<ProviderProps, "children">>
    >;
    const Search = search.SharedSearchBar as typeof SharedSearchBar;
    const props = { value: "x".repeat(101), onChange: () => undefined };
    return renderToStaticMarkup(
      createElement(
        Provider,
        {
          ...props,
          debounceMs: 250,
          resetKey: undefined,
          validateDraft: () => "Kürze deine Suche auf höchstens 100 Zeichen.",
        },
        createElement(Search, props),
      ),
    );
  });

  await page.setViewportSize({ width: 320, height: 640 });
  await render(page, css, `<div style="width:175px">${field}</div>`);
  const input = (await page.getByRole("textbox").boundingBox())!;
  const icon = (await page.locator("svg").first().boundingBox())!;
  const clear = (await page
    .getByRole("button", { name: "Suche löschen" })
    .boundingBox())!;
  const hint = (await page.getByRole("alert").boundingBox())!;
  expect(hint.height).toBeGreaterThan(24);
  expect(hint.y).toBeGreaterThan(input.y + input.height);
  for (const control of [icon, clear]) {
    expect(
      Math.abs(control.y + control.height / 2 - input.y - input.height / 2),
    ).toBeLessThan(1);
  }
});
