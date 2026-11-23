// Activity Entity Configuration

import { defineEntityConfig } from "@/lib/database/types";
import {
  mapActivityResponse,
  mapSupervisorOption,
  type Activity,
  type ActivitySupervisor,
} from "@/lib/activity-helpers";
import type {
  ActivityRequest,
  ActivityUpdateRequest,
} from "~/lib/contract/activities.generated";
import { bffJson } from "~/lib/bff-fetch";
import { activitiesConcept } from "~/lib/concepts/activities";
import { staffConcept } from "~/lib/concepts/staff";

// Emoji mapping rules: [emoji, ...keywords]
// Rules are checked in order; first match wins
type EmojiRule = readonly [emoji: string, ...keywords: string[]];

const NAME_EMOJI_RULES: readonly EmojiRule[] = [
  // Sports
  ["⚽", "fußball", "fussball"],
  ["🏀", "basketball"],
  ["🏐", "volleyball"],
  ["🎾", "tennis"],
  ["🏊", "schwimm"],
  ["🏃", "lauf", "athletik", "sport"],
  ["🤸", "turnen", "gym"],
  // Creative
  ["🎨", "kunst", "mal", "zeich"],
  ["🎵", "musik", "chor", "band"],
  ["🎭", "theater", "drama"],
  ["💃", "tanz", "dance"],
  ["📸", "foto", "photo"],
  ["🎬", "film", "video"],
  // Academic
  ["🔢", "mathematik", "mathe"],
  ["🔬", "physik", "chemie", "labor"],
  ["🌿", "biologie", "natur"],
  ["💻", "computer", "informatik", "coding"],
  ["🤖", "robotik", "technik"],
  ["🗣️", "sprach", "english", "französisch"],
  ["📚", "lesen", "buch", "literatur"],
  ["✍️", "schreib", "journal"],
  // Practical
  ["🍳", "koch", "küche", "back"],
  ["🌱", "garten", "pflanzen"],
  ["🔨", "werk", "holz", "handwerk"],
  ["🧵", "näh", "textil", "schneid"],
  // Games
  ["♟️", "schach"],
  ["🎲", "spiel", "game"],
  ["🧩", "puzzle", "rätsel"],
  // Other
  ["🧘", "meditation", "yoga", "entspann"],
  ["🚑", "erste hilfe", "sanitäter"],
  ["♻️", "umwelt", "recycl", "nachhaltig"],
  ["🔥", "feuer", "pfadfinder"],
  // Meals
  ["🍽️", "mensa", "essen", "mittag"],
] as const;

const CATEGORY_EMOJI_RULES: readonly EmojiRule[] = [
  ["🏃", "sport"],
  ["🍽️", "mensa"],
  ["🌳", "draußen"],
  ["🏠", "gruppenraum"],
  ["📖", "lernen"],
  ["🎨", "kreativ"],
  ["📝", "hausaufgaben"],
] as const;

function matchEmojiRule(
  text: string | undefined,
  rules: readonly EmojiRule[],
): string | null {
  if (!text) return null;
  for (const [emoji, ...keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return emoji;
    }
  }
  return null;
}

function getActivityEmoji(activity: Activity): string {
  const name = activity.name?.toLowerCase();
  const category = activity.category_name?.toLowerCase();

  return (
    matchEmojiRule(name, NAME_EMOJI_RULES) ??
    matchEmojiRule(category, CATEGORY_EMOJI_RULES) ??
    (activity.name ? activity.name.substring(0, 2).toUpperCase() : "AG")
  );
}

// The available supervisors as select options. A failure rejects with the
// catalog error; an empty list would look like a school without supervisors
// (#2517, #2353).
async function loadSupervisorOptions(): Promise<
  Array<{ value: string; label: string }>
> {
  const supervisors = await bffJson(
    "tenant",
    "GET /api/activities/supervisors/available",
    { errorMessage: "failed to load supervisors" },
  );
  return supervisors.map(mapSupervisorOption).map((sup) => ({
    value: sup.id,
    label: sup.name,
  }));
}

/** The body of an activity write: the contract's names for the form's fields. */
export function toActivityRequest(data: Partial<Activity>): ActivityRequest {
  // A cleared number field holds "" instead of a number.
  const limit: unknown = data.max_participant;
  return {
    name: data.name,
    max_participants: typeof limit === "number" ? limit : null,
    category_id: data.ag_category_id || undefined,
    // Backend expects supervisor_ids as an array even for single primary
    ...(data.supervisor_id ? { supervisor_ids: [data.supervisor_id] } : {}),
  };
}

/**
 * The body of a save from the database form, which shows the name, the
 * limit, the category and the primary supervisor only. The route keeps what
 * the body does not name (opening, planned room, schedules), and a changed
 * primary supervisor travels with the co-supervisors the form read, so they
 * stay. `version` is the stored state the form was filled from (ADR 0311).
 */
export function toActivityUpdateRequest(
  data: Partial<Activity>,
): ActivityUpdateRequest {
  const limit: unknown = data.max_participant;
  const request: ActivityUpdateRequest = {
    name: data.name,
    max_participants: typeof limit === "number" ? limit : null,
    category_id: data.ag_category_id || undefined,
    expected_version: data.version,
  };
  const read = data.supervisors ?? [];
  const readPrimary = read.find((s) => s.is_primary)?.staff_id ?? "";
  const primary = data.supervisor_id ?? "";
  if (primary !== readPrimary) {
    const others = read
      .map((s) => s.staff_id)
      .filter((id) => id !== primary && id !== readPrimary);
    request.supervisor_ids = primary ? [primary, ...others] : others;
  }
  return request;
}

export const activitiesConfig = defineEntityConfig<Activity>({
  name: {
    singular: "Aktivität",
    plural: "Aktivitäten",
  },

  concept: activitiesConcept,

  backUrl: "/database",

  api: {
    list: async () =>
      (
        await bffJson("tenant", "GET /api/activities/", {
          // Admin view keeps showing system activities (Schulhof Freispiel,
          // WC) — they are rendered greyed-out via isSystemActivity instead
          // of hidden.
          query: { include_system: "true" },
        })
      ).map(mapActivityResponse),
    get: async (id) =>
      mapActivityResponse(
        await bffJson("tenant", "GET /api/activities/{id}", { params: { id } }),
      ),
    create: async (data) =>
      mapActivityResponse(
        await bffJson("tenant", "POST /api/activities/", {
          body: toActivityRequest(data),
        }),
      ),
    update: async (id, data) =>
      mapActivityResponse(
        await bffJson("tenant", "PUT /api/activities/{id}", {
          params: { id },
          body: toActivityUpdateRequest(data),
        }),
      ),
    delete: (id) =>
      bffJson("tenant", "DELETE /api/activities/{id}", { params: { id } }),
  },

  form: {
    sections: [
      {
        title: "Grundinformationen",
        concept: activitiesConcept,
        columns: 2,
        fields: [
          {
            name: "name",
            label: "Name",
            type: "text",
            required: true,
            placeholder: "z.B. Fußball AG",
            colSpan: 2,
          },
          {
            name: "ag_category_id",
            label: "Kategorie",
            type: "select",
            required: true,
            optionsResource: "activity-category-choice",
            options: async () => {
              // A failure throws the ApiError: the form shows the catalog
              // text with retry instead of an empty choice (#2517).
              const categories = await bffJson(
                "tenant",
                "GET /api/activities/categories",
                { errorMessage: "failed to load activity categories" },
              );
              return categories.map((cat) => ({
                value: cat.id,
                label: cat.name,
              }));
            },
          },
          {
            name: "max_participant",
            label: "Maximale Teilnehmer (optional)",
            type: "number",
            required: false,
            min: 1,
            placeholder: "Keine Begrenzung",
          },
        ],
      },
      {
        title: "Betreuer",
        concept: staffConcept,
        fields: [
          {
            name: "supervisor_id",
            label: "Hauptbetreuung",
            type: "select",
            required: false,
            placeholder: "Keine Hauptbetreuung",
            optionsResource: "activity-supervisor-choice",
            options: loadSupervisorOptions,
          },
        ],
      },
    ],

    defaultValues: {
      max_participant: 20,
    },
  },

  detail: {
    header: {
      title: (activity) => activity.name,
      subtitle: (activity) => activity.category_name ?? "Keine Kategorie",
      avatar: {
        text: getActivityEmoji,
        size: "lg",
      },
    },

    sections: [
      {
        title: "Grundinformationen",
        items: [
          {
            label: "Name",
            value: (activity) => activity.name,
          },
          {
            label: "Kategorie",
            value: (activity) => activity.category_name ?? "Keine Kategorie",
          },
          {
            label: "Beschreibung",
            value: (_activity) => "Keine Beschreibung",
          },
          {
            label: "Maximale Teilnehmer",
            value: (activity: Activity) =>
              activity.max_participant?.toString() ?? "Unbegrenzt",
          },
          {
            label: "Aktuelle Teilnehmer",
            value: (activity: Activity) =>
              String(activity.participant_count ?? 0),
          },
        ],
      },
      {
        title: "Betreuer",
        items: [
          {
            label: "Hauptbetreuung",
            value: (activity: Activity) => {
              const primary = activity.supervisors?.find(
                (s: ActivitySupervisor) => s.is_primary,
              );
              return primary
                ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
                : "Keine Hauptbetreuung eingetragen";
            },
          },
          {
            label: "Weitere Betreuer",
            value: (activity: Activity) => {
              const secondary =
                activity.supervisors?.filter(
                  (s: ActivitySupervisor) => !s.is_primary,
                ) ?? [];
              return secondary.length > 0
                ? secondary
                    .map((s: ActivitySupervisor) =>
                      `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
                    )
                    .join(", ")
                : "Keine weiteren Betreuer";
            },
          },
        ],
      },
    ],

    actions: {
      edit: true,
      delete: true,
    },
  },

  list: {
    title: "Aktivität auswählen",
    description: "Verwalte Aktivitäten und deren Teilnehmer",
    searchPlaceholder: "Aktivität suchen…",

    // Frontend search for better UX
    searchStrategy: "frontend",
    searchableFields: ["name", "category_name", "description"],
    minSearchLength: 0,

    filters: [
      {
        id: "ag_category_id",
        label: "Kategorie",
        type: "select",
        options: "dynamic", // Will be extracted from the loaded data
      },
      {
        id: "supervisor_id",
        label: "Betreuer",
        type: "select",
        loadOptions: loadSupervisorOptions,
      },
    ],

    item: {
      title: (activity: Activity) => activity.name,
      subtitle: (activity: Activity) => {
        const primary = activity.supervisors?.find(
          (s: ActivitySupervisor) => s.is_primary,
        );
        return primary
          ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
          : "Keine Hauptbetreuung";
      },
      description: (activity: Activity) => {
        if (activity.is_open_ags) {
          return "Anmeldung offen";
        }
        return "Anmeldung geschlossen";
      },
      avatar: {
        text: getActivityEmoji,
      },
    },
  },

  labels: {
    createButton: "Neue Aktivität erstellen",
    createModalTitle: "Neue Aktivität",
    detailModalTitle: "Aktivitätsdetails",
    deleteConfirmation:
      "Bist du sicher, dass du diese Aktivität löschen möchtest?",
  },
});
