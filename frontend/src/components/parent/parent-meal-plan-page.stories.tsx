import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { storyNow } from "~storybook/clock";
import { installStorybookFetch, jsonResponse } from "~storybook/mocks/fetch";
import { berlinTodayISO } from "~/lib/date-helpers";
import { ParentMealPlanPage } from "./parent-meal-plan-page";
import type { MealParticipation, MealPlanEntry } from "~/lib/parent-api";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const baseFeatures = {
  conference_book_allowed: false,
  care_ended: false,
  excused_note_enabled: false,
  pickup_change_mode_enabled: false,
  pickup_change_cutoff_time: "",
  pickup_change_today_closed: false,
  pickup_change_care_day_ended: false,
  pickup_manage_allowed: false,
  emergency_contact_manage_allowed: false,
  absence_request_edit_enabled: false,
  reason_required: false,
  care_facility_term: "",
  sick_note_enabled: true,
  sick_requires_approval: false,
  notes_enabled: true,
  excused_requires_approval: false,
  request_submit_enabled: true,
  pickup_change_enabled: true,
  guardian_contact_manage_allowed: true,
  related_accounts_invite_enabled: true,
  related_accounts_remove_enabled: true,
  master_data_edit_enabled: true,
  master_data_contact_edit_enabled: true,
  master_data_request_enabled: true,
  meal_plan_enabled: true,
  meal_registration_enabled: false,
  has_open_change_request: false,
  parent_news_enabled: true,
} satisfies parentMeContract.ChildFeaturesResponse;

const childrenWithMealPlans: parentMeContract.ChildResponse[] = [
  {
    care_ended: false,
    student_id: "child-1",
    tenant_id: "school-1",
    first_name: "Mia",
    last_name: "Schmidt",
    school_class: "3b",
    status: "active",
    enrolled_from: "2025-08-01",
    school_name: "OGS Am Berg",
    school_slug: "am-berg",
  },
  {
    care_ended: false,
    student_id: "child-2",
    tenant_id: "school-2",
    first_name: "Ben",
    last_name: "Schmidt",
    school_class: "1a",
    status: "active",
    enrolled_from: "2025-08-01",
    school_name: "OGS Sonnenhof",
    school_slug: "sonnenhof",
  },
];

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayISOFromOffset(weekOffset: number): string {
  const date = storyNow();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + weekOffset * 7);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toISODate(date);
}

function dateFromMonday(mondayISO: string, dayOffset: number): string {
  const parts = mondayISO.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + dayOffset);
  return toISODate(date);
}

function mealPlanForWeek(mondayISO: string): MealPlanEntry[] {
  return [
    {
      date: dateFromMonday(mondayISO, 0),
      position: 1,
      dish: "Gemüse-Lasagne",
      note: "mit Salat",
      allergens: ["gluten", "eggs", "milk"],
    },
    {
      date: dateFromMonday(mondayISO, 1),
      position: 1,
      dish: "Kartoffel-Gemüse-Eintopf",
      allergens: ["celery"],
    },
    {
      date: dateFromMonday(mondayISO, 2),
      position: 1,
      dish: "Hähnchen-Reis-Pfanne",
      note: "vegetarische Alternative verfügbar",
      allergens: ["soybeans"],
    },
    {
      date: dateFromMonday(mondayISO, 3),
      position: 1,
      dish: "Nudeln mit Tomatensoße",
      allergens: ["gluten"],
    },
    {
      date: dateFromMonday(mondayISO, 4),
      position: 1,
      dish: "Fischstäbchen mit Kartoffelpüree",
      note: "Obst zum Nachtisch",
      allergens: ["fish", "gluten", "milk"],
    },
  ];
}

function participationForFourWeeks(): MealParticipation {
  const monday = mondayISOFromOffset(0);
  const today = toISODate(storyNow());
  const days = Array.from({ length: 26 }, (_, offset) => ({
    date: dateFromMonday(monday, offset),
    offset,
  }))
    .filter(({ date }) => {
      const day = new Date(`${date}T12:00:00`).getDay();
      return day >= 1 && day <= 5;
    })
    .map(({ date, offset }) => ({
      date,
      participating: offset !== 4,
      regular_participating: true,
      source: offset === 4 ? ("override" as const) : ("regular" as const),
      changeable: date >= today,
      can_register: date >= today,
      can_cancel: date >= today,
      register_until: `${date}T07:00:00Z`,
      cancel_until: `${date}T07:00:00Z`,
    }));

  return {
    weekdays: [1, 2, 3, 4, 5],
    effective_from: monday,
    cutoff_time: "09:00",
    model: "ongoing_single",
    schedule_changeable: true,
    sick_cancels_after_deadline: false,
    version: "v1",
    days,
  };
}

function mockParentMealPlan({
  childrenData,
  enabledStudentIds = new Set(childrenData.map((child) => child.student_id)),
  registrationEnabledStudentIds = new Set<string>(),
  entriesByStudent = {},
  shouldFail = false,
}: {
  childrenData: parentMeContract.ChildResponse[];
  enabledStudentIds?: ReadonlySet<string>;
  registrationEnabledStudentIds?: ReadonlySet<string>;
  entriesByStudent?: Record<string, MealPlanEntry[]>;
  shouldFail?: boolean;
}) {
  return installStorybookFetch(({ url, method }) => {
    const requestUrl = new URL(url, "http://storybook.test");
    const { pathname } = requestUrl;

    if (pathname === "/api/parent/me/family-start") {
      if (shouldFail) {
        return jsonResponse(
          { error: "Interner Serverfehler" },
          { status: 500 },
        );
      }
      const studentId = requestUrl.searchParams.get("student_id");
      return jsonResponse({
        data: {
          day: berlinTodayISO(storyNow()),
          cards: childrenData
            .filter((child) => !studentId || child.student_id === studentId)
            .map((child) => ({
              child,
              access_version: "story",
              features: {
                ...baseFeatures,
                meal_plan_enabled: enabledStudentIds.has(child.student_id),
                meal_registration_enabled: registrationEnabledStudentIds.has(
                  child.student_id,
                ),
              },
              today: { state: "unknown", at_ogs: null },
            })),
        } satisfies parentMeContract.FamilyStartResponse,
      });
    }

    const participationMatch = pathname.match(
      /^\/api\/parent\/me\/children\/([^/]+)\/meal-participation(?:\/weeks)?(?:\/[^/]+)?$/,
    );
    if (participationMatch) {
      if (method === "GET") {
        return jsonResponse({ data: participationForFourWeeks() });
      }
      return jsonResponse({ data: { effective_from: mondayISOFromOffset(1) } });
    }

    const childMatch = pathname.match(
      /^\/api\/parent\/me\/children\/([^/]+)\/meal-plan$/,
    );
    if (!childMatch) return undefined;

    const studentId = decodeURIComponent(childMatch[1] ?? "");
    return jsonResponse({ data: entriesByStudent[studentId] ?? [] });
  });
}

const meta = {
  title: "components/parent/ParentMealPlanPage",
  component: ParentMealPlanPage,
  parameters: {
    docs: {
      description: {
        component:
          "Loads the parent's children, per-child feature flags, and the selected school's weekly meal plan via mocked parent API responses.",
      },
    },
  },
} satisfies Meta<typeof ParentMealPlanPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  beforeEach: () =>
    mockParentMealPlan({
      childrenData: childrenWithMealPlans,
      entriesByStudent: {
        "child-1": mealPlanForWeek(mondayISOFromOffset(0)),
        "child-2": mealPlanForWeek(mondayISOFromOffset(0)),
      },
    }),
};

export const WithRegistration: Story = {
  beforeEach: () => {
    const felix: parentMeContract.ChildResponse = {
      ...childrenWithMealPlans[0]!,
      first_name: "Felix",
      last_name: "Schneider",
    };
    return mockParentMealPlan({
      childrenData: [felix],
      registrationEnabledStudentIds: new Set([felix.student_id]),
      entriesByStudent: {
        [felix.student_id]: mealPlanForWeek(mondayISOFromOffset(0)),
      },
    });
  },
};

export const EmptyWeek: Story = {
  beforeEach: () =>
    mockParentMealPlan({
      childrenData: [childrenWithMealPlans[0]!],
      entriesByStudent: { "child-1": [] },
    }),
};

export const NoEnabledSchools: Story = {
  beforeEach: () =>
    mockParentMealPlan({
      childrenData: [childrenWithMealPlans[0]!],
      enabledStudentIds: new Set(),
    }),
};

export const LoadError: Story = {
  beforeEach: () =>
    mockParentMealPlan({
      childrenData: [],
      shouldFail: true,
    }),
};
