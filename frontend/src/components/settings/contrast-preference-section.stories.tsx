import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { CustomSelect } from "~/components/ui/custom-select";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { Textarea } from "~/components/ui/textarea";
import { installStorybookFetch, jsonResponse } from "~storybook/mocks/fetch";
import { ContrastPreferenceSection } from "./contrast-preference-section";

const meta = {
  title: "components/settings/ContrastPreferenceSection",
  component: ContrastPreferenceSection,
  args: { portal: "tenant" },
  // Das Konto speichert jede Wahl; hier antwortet ein Stub statt des Backends.
  beforeEach: () => {
    let moreContrast: boolean | null = null;
    return installStorybookFetch(({ url, init }) => {
      if (!url.includes("/display-preferences")) return undefined;
      if (init?.method === "PUT" && typeof init.body === "string") {
        moreContrast = (JSON.parse(init.body) as { moreContrast: boolean })
          .moreContrast;
      }
      return jsonResponse({ status: "success", data: { moreContrast } });
    });
  },
} satisfies Meta<typeof ContrastPreferenceSection>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Der Schalter über einem Beispielformular: Umschalten ändert die Ränder. */
export const MitBeispielformular: Story = {
  render: function Render() {
    const [group, setGroup] = useState("");
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <ContrastPreferenceSection portal="tenant" />
        <SectionCard headingLevel={3} title="Beispielformular">
          <div className="flex flex-col gap-4">
            <Input label="E-Mail-Adresse" placeholder="name@schule.de" />
            <CustomSelect
              label="Gruppe"
              placeholder="Gruppe wählen"
              value={group}
              onChange={setGroup}
              options={[
                { value: "a", label: "Bärengruppe" },
                { value: "b", label: "Fuchsgruppe" },
              ]}
            />
            <Textarea
              label="Notiz"
              placeholder="Was sollen die anderen wissen?"
            />
            <label
              htmlFor="contrast-demo-remember"
              className="flex items-center gap-2 text-sm text-gray-900"
            >
              <Checkbox id="contrast-demo-remember" />
              Angemeldet bleiben
            </label>
          </div>
        </SectionCard>
      </div>
    );
  },
};
