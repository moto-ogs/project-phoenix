// Student entity configuration. The Kinder database page creates children
// through StudentCreateModal (`createStudent`) and edits them on the child
// page, so the config carries only the names and the list title the page
// reads, and no calls.

import type { EntityConfig } from "@/lib/database/types";
import type { Student } from "~/lib/student-helpers";
import { childrenConcept } from "~/lib/concepts/children";

export const studentsConfig: Omit<EntityConfig<Student>, "api"> = {
  name: {
    singular: "Kinder",
    plural: "Kinder",
  },

  concept: childrenConcept,

  backUrl: "/database",

  form: { sections: [] },

  detail: { sections: [] },

  list: {
    title: "Kinder auswählen",
    description: "Verwalte Kinderdaten und Gruppenzuweisungen",
    searchPlaceholder: "Kinder suchen…",
    item: {
      title: (student: Student) =>
        `${student.first_name} ${student.second_name}`,
    },
  },

  labels: {
    createButton: "Neues Kind erstellen",
    detailModalTitle: "Kinddetails",
    deleteConfirmation: "Bist du sicher, dass du dieses Kind löschen möchtest?",
  },
};
