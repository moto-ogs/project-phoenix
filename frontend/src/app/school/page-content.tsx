"use client";

// Startseite des Schul-Portals ("moto schule", #2207): die Tagesübersicht
// der Klassenansicht. Die Kinderlisten liegen unter /school/klasse?klasse=…
// (#2294), eine Klasse pro Seite.

import { ClassDayOverview } from "~/components/class-day/class-day-overview";
import { SchoolDayChangesBlock } from "~/components/school/school-day-changes-block";
import { TodayNoticesCard } from "~/components/school/today-notices-card";
import {
  fetchAssignedClassesSchool,
  fetchClassDayClassesSchool,
  fetchSchoolDaySchool,
  reportAbsenceSchool,
  withdrawAbsenceReportSchool,
} from "~/lib/school-class-day-api";

export default function SchoolHomePage() {
  return (
    <ClassDayOverview
      fetchClasses={fetchClassDayClassesSchool}
      fetchAssignedClasses={fetchAssignedClassesSchool}
      fetchSchoolDay={fetchSchoolDaySchool}
      reportAbsence={reportAbsenceSchool}
      withdrawAbsenceReport={withdrawAbsenceReportSchool}
      // „Heute anders“ (#7670) direkt unter dem Kopf, darunter die Hinweise
      // der OGS-Leitung für heute (#2208); ohne Hinweis rendert die Karte
      // nichts.
      notices={
        <>
          <SchoolDayChangesBlock
            fetchAssignedClasses={fetchAssignedClassesSchool}
          />
          <TodayNoticesCard />
        </>
      }
    />
  );
}
