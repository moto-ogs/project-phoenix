import { describe, expect, it } from "vitest";
import type {
  KeyDateReport,
  ReportFigures,
  ReportTemplate,
} from "~/lib/traeger-reports-api";
import {
  demandGap,
  districtNames,
  formatPercent,
  keyDateInYear,
  keyDatePresets,
  lateAttendanceStart,
  latestKeyDate,
  reportRows,
  templateSummary,
  totalRow,
} from "./key-date-report-model";
import { validateTemplateInput } from "./report-template-form";

const FIGURES: ReportFigures = {
  children: 40,
  withoutCareForm: 4,
  staff: 5,
  childrenPerStaff: 8,
  presentDays: 900,
  sickDays: 60,
  excusedDays: 40,
  absenceRate: 10,
  places: 30,
  bookedPlaces: 28,
  freePlaces: 2,
  booked: 36,
  open: 3,
  waitlisted: 2,
  demand: 41,
};

const REPORT: KeyDateReport = {
  keyDate: "2025-10-15",
  asOf: "2026-09-09T10:00:00Z",
  template: { id: "12", name: "Jugendamt" },
  sections: ["children", "demand"],
  absenceWindow: { from: "2025-08-01", to: "2025-10-15" },
  schools: [
    {
      id: "2",
      name: "OGS Am Bach",
      city: "Bissendorf",
      district: "Nord",
      attendanceFrom: "2025-09-01",
      figures: FIGURES,
      careForms: [],
    },
    {
      id: "3",
      name: "OGS Lindenweg",
      city: "Melle",
      district: null,
      attendanceFrom: "2025-06-01",
      figures: FIGURES,
      careForms: [],
    },
  ],
  districts: [
    {
      name: "Nord",
      unmapped: false,
      schools: 1,
      figures: FIGURES,
      careForms: [],
    },
    {
      name: "Ohne Sozialraum",
      unmapped: true,
      schools: 1,
      figures: FIGURES,
      careForms: [],
    },
  ],
  total: { name: "", schools: 2, figures: FIGURES, careForms: [] },
};

describe("latestKeyDate", () => {
  it("takes last year's 15.10. before the key date and this year's from it on", () => {
    expect(latestKeyDate("2026-09-09")).toBe("2025-10-15");
    expect(latestKeyDate("2026-10-14")).toBe("2025-10-15");
    expect(latestKeyDate("2026-10-15")).toBe("2026-10-15");
    expect(latestKeyDate("2026-12-31")).toBe("2026-10-15");
  });

  it("follows the key date of a template", () => {
    expect(latestKeyDate("2026-09-09", 3, 1)).toBe("2026-03-01");
    expect(latestKeyDate("2026-02-28", 3, 1)).toBe("2025-03-01");
  });

  it("moves the 29th of February to the 28th outside leap years", () => {
    expect(keyDateInYear(2027, 2, 29)).toBe("2027-02-28");
    expect(keyDateInYear(2028, 2, 29)).toBe("2028-02-29");
    expect(latestKeyDate("2027-03-01", 2, 29)).toBe("2027-02-28");
  });

  it("offers the last two key dates and today", () => {
    expect(keyDatePresets("2026-11-15")).toEqual([
      { label: "Stichtag 15.10.2026", date: "2026-10-15" },
      { label: "Stichtag 15.10.2025", date: "2025-10-15" },
      { label: "Heute", date: "2026-11-15" },
    ]);
  });
});

describe("report rows", () => {
  it("lists schools, or districts once the template maps them", () => {
    expect(reportRows(REPORT, "schools").map((row) => row.name)).toEqual([
      "OGS Am Bach",
      "OGS Lindenweg",
    ]);
    const districts = reportRows(REPORT, "districts");
    expect(districts.map((row) => [row.name, row.detail])).toEqual([
      ["Nord", "1 Schule"],
      ["Ohne Sozialraum", "1 Schule"],
    ]);
    expect(totalRow(REPORT)).toMatchObject({
      name: "Gesamt",
      detail: "2 Schulen",
    });
  });

  it("falls back to schools without a district", () => {
    const plain = { ...REPORT, districts: [] };
    expect(reportRows(plain, "districts")).toHaveLength(2);
  });

  it("keeps named and unassigned districts distinct even with the same label", () => {
    const report = {
      ...REPORT,
      districts: REPORT.districts.map((group) => ({
        ...group,
        name: "Ohne Sozialraum",
      })),
    };
    const rows = reportRows(report, "districts");
    expect(rows.map((row) => row.name)).toEqual([
      "Ohne Sozialraum",
      "Ohne Sozialraum",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("names the schools whose check-ins start inside the absence window", () => {
    expect(lateAttendanceStart(REPORT)).toEqual({
      schools: 1,
      first: "2025-09-01",
    });
    expect(lateAttendanceStart({ ...REPORT, absenceWindow: null })).toEqual({
      schools: 0,
      first: null,
    });
  });
});

describe("figures", () => {
  it("says how many places the demand lacks or leaves free", () => {
    expect(demandGap(FIGURES)).toBe(11);
    expect(demandGap({ ...FIGURES, demand: 20 })).toBe(-10);
    expect(demandGap({ ...FIGURES, places: 0 })).toBeNull();
  });

  it("formats a share with a German comma", () => {
    expect(formatPercent(12.345)).toBe("12,3 %");
    expect(formatPercent(null)).toBe("–");
  });
});

describe("templates", () => {
  const template: ReportTemplate = {
    id: "12",
    name: "Jugendamt",
    sections: ["children", "staff", "absences", "demand"],
    keyDateMonth: 10,
    keyDateDay: 15,
    districts: [
      { schoolId: "2", district: "Nord" },
      { schoolId: "3", district: "Süd" },
      { schoolId: "4", district: "Nord " },
    ],
    updatedAt: null,
  };

  it("summarises key date, sections and districts", () => {
    expect(templateSummary(template)).toBe(
      "Stichtag 15.10. · 4 Abschnitte · 2 Sozialräume",
    );
    expect(districtNames(template.districts)).toEqual(["Nord", "Süd"]);
  });

  it("checks name, sections and key date before saving", () => {
    expect(
      validateTemplateInput(
        {
          name: " jugendamt ",
          sections: [],
          keyDateMonth: 4,
          keyDateDay: 31,
          districts: [],
        },
        ["Jugendamt"],
      ),
    ).toEqual({
      name: "Eine Vorlage mit diesem Namen gibt es schon.",
      sections: "Bitte wähle mindestens einen Abschnitt.",
      key_date_day: "Diesen Tag gibt es im gewählten Monat nicht.",
    });
    expect(
      validateTemplateInput({
        name: "Kommune",
        sections: ["demand"],
        keyDateMonth: 2,
        keyDateDay: 29,
        districts: [],
      }),
    ).toEqual({});
  });
});
