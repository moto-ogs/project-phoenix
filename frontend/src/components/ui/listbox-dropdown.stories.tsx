import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, screen, userEvent, within } from "storybook/test";

import {
  ListboxDropdown,
  type ListboxDropdownOption,
} from "~/components/ui/listbox-dropdown";

const fruitOptions: readonly ListboxDropdownOption<string>[] = [
  { value: "apple", label: "Apfel" },
  { value: "banana", label: "Banane" },
  { value: "cherry", label: "Kirsche", disabled: true },
];

function ControlledListboxDropdown(
  props: Omit<
    Parameters<typeof ListboxDropdown<string>>[0],
    "value" | "onChange"
  > & { initialValue: string },
) {
  const { initialValue, ...rest } = props;
  const [value, setValue] = useState(initialValue);
  return <ListboxDropdown {...rest} value={value} onChange={setValue} />;
}

const meta: Meta<typeof ControlledListboxDropdown> = {
  title: "components/ui/ListboxDropdown",
  component: ControlledListboxDropdown,
  args: {
    initialValue: "apple",
    options: fruitOptions,
    ariaLabel: "Frucht auswählen",
    className: "w-64",
  },
};

export default meta;

type Story = StoryObj<typeof ControlledListboxDropdown>;

export const Default: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
};

/** Offene Liste: `play` klickt den Auslöser (Vorlage für offene Zustände, #6562). */
export const Opened: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Frucht auswählen" }),
    );
    await expect(await screen.findByRole("listbox")).toBeVisible();
  },
};

export const Compact: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    size: "dense",
  },
};

export const Disabled: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    disabled: true,
  },
};

export const Invalid: Story = {
  // axe meldet hier noch aria-allowed-attr, label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    invalid: true,
    required: true,
  },
};

export const EmptyValuePlaceholder: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    initialValue: "",
    placeholder: "Bitte wählen",
  },
};
