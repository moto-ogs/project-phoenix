import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";

const meta: Meta<typeof Collection> = {
  title: "components/ui/Collection",
  component: Collection,
};

export default meta;
type Story = StoryObj<typeof Collection>;

const MISSING = ["Aida Amini", "Baran Amini", "Lina Amini"];
const PRESENT = ["Ben Hartmann", "Bente Jansen", "Mia Kaya", "Emma Klein"];

export const Gruppiert: Story = {
  render: () => (
    <Collection label="Kinder">
      <CollectionGroup title="Fehlt noch" count={MISSING.length}>
        {MISSING.map((name) => (
          <CollectionRow
            key={name}
            href="#"
            title={name}
            subtitle="Klasse 2a · Sternengruppe"
            leading={<Avatar name={name} size="sm" decorative />}
            meta="14:00"
            action={
              <Button
                type="button"
                variant="outline"
                size="compact"
                tooltip="Meldet das Kind als da."
              >
                Da
              </Button>
            }
          />
        ))}
      </CollectionGroup>
      <CollectionGroup title="Da" count={PRESENT.length}>
        {PRESENT.map((name) => (
          <CollectionRow
            key={name}
            href="#"
            title={name}
            subtitle="Klasse 1a · Bärengruppe"
            leading={<Avatar name={name} size="sm" decorative />}
            meta="Gehzeit 16:00"
          />
        ))}
      </CollectionGroup>
    </Collection>
  ),
};
