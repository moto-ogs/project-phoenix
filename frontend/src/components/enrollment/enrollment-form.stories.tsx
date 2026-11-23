import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { EnrollmentForm } from "./enrollment-form";
import type { PublicFormSchema } from "~/lib/enrollment-form-schema-api";
import type { CareOffering } from "~/lib/care-offering-api";

// With prefetchedData the form renders the phase synchronously, as the phase
// pages do; without it the form would load a template preview.
function schema(): PublicFormSchema {
  return {
    id: "7",
    version: 1,
    fields: [
      {
        key: "allergies",
        label: "Allergien",
        type: "text",
        required: false,
        applies_to_child: true,
        sort_order: 0,
      },
    ],
  };
}

function offerings(): CareOffering[] {
  return [
    {
      id: "11",
      phase_id: "5",
      name: "Flexible Betreuung",
      description: "Eltern wählen die Tage",
      days_of_week_mode: "parent_choice",
      available_days: ["mon", "wed", "fri"],
      includes_holiday_care: true,
      includes_lunch: true,
      is_active: true,
      is_required: false,
      capacity: undefined,
      counts_as_care: true,
      auto_add_grade_levels: [],
      auto_add_trigger_offering_ids: [],
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];
}

const meta: Meta<typeof EnrollmentForm> = {
  title: "enrollment/EnrollmentForm",
  component: EnrollmentForm,
};

export default meta;
type Story = StoryObj<typeof EnrollmentForm>;

export const Default: Story = {
  args: {
    gradeLevelMax: 4,
    onSubmitted: () => {
      // no-op: story just needs a valid callback
    },
    prefetchedData: {
      schema: schema(),
      offerings: offerings(),
      careOfferingSelectionMode: "optional",
      captchaConfig: null,
      legalTexts: {
        agb: "AGB Text",
        agb_document_url: "",
        dsgvo: "Datenschutz Text",
        email_contact: "",
        photo: "",
        terms_enabled: true,
        dsgvo_enabled: true,
        email_contact_enabled: false,
        photo_enabled: false,
        blocks: [
          {
            key: "agb",
            kind: "terms",
            title: "AGB / Teilnahmebedingungen",
            label: "Ich akzeptiere die AGB / Teilnahmebedingungen.",
            text: "AGB Text",
            required: true,
          },
          {
            key: "data_processing",
            kind: "privacy_notice",
            title: "Datenschutzinformation",
            label:
              "Ich habe die Datenschutzinformation der Schule zur Kenntnis genommen.",
            text: "Datenschutz Text",
            required: true,
          },
        ],
      },
      profile: null,
    },
  },
};
