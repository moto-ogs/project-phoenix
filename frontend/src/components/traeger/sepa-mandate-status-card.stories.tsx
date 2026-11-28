import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SepaMandateStatusView } from "~/components/traeger/sepa-mandate-status-card";
import type { SepaMandate } from "~/lib/traeger-sepa-api";

const MANDATE: SepaMandate = {
  id: "9",
  contractId: "42",
  familyEmail: "eva@example.org",
  partyFirstName: "Eva",
  partyLastName: "Beispiel",
  reference: "SJR-2026-0001",
  signedOn: "2026-09-01",
  kind: "recurring",
  sequence: "recurring",
  creditorId: "DE98ZZZ09999999999",
  creditorCurrent: true,
  accountHolder: "Eva Beispiel",
  ibanMasked: "DE•• •••• •••• •••• ••30 00",
  bic: "",
  source: "office",
  revokedOn: null,
  lastCollectedOn: null,
  expiresOn: "2029-09-01",
  createdAt: "2026-09-01T10:00:00+02:00",
};

const meta = {
  title: "components/traeger/SepaMandateStatusView",
  component: SepaMandateStatusView,
} satisfies Meta<typeof SepaMandateStatusView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mandate in force: the card names reference and account. */
export const InForce: Story = {
  args: {
    contractId: "42",
    read: {
      mandates: [MANDATE],
      failure: null,
      inForce: MANDATE,
      collectable: true,
    },
  },
};

/** No mandate yet: the family gets an invoice to transfer. */
export const Missing: Story = {
  args: {
    contractId: "42",
    read: {
      mandates: [],
      failure: null,
      inForce: undefined,
      collectable: false,
    },
  },
};
