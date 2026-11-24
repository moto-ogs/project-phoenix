import { beforeEach, describe, expect, it, vi } from "vitest";

const { bffJson } = vi.hoisted(() => ({ bffJson: vi.fn() }));
vi.mock("~/lib/bff-fetch", () => ({ bffJson }));

import {
  EMPTY_SCHOOL_PARTY,
  type AreaResponsibility,
  type SchoolParty,
  billingReady,
  fetchResponsibilities,
  removeSchoolParty,
  responsibilityGap,
  responsibleName,
  saveSchoolParty,
} from "./traeger-responsibilities-api";

const gemeinde: SchoolParty = {
  ...EMPTY_SCHOOL_PARTY,
  kind: "gemeinde",
  name: "Gemeinde Hardt",
  street: "Rathausplatz 1",
  postalCode: "41749",
  city: "Viersen",
  version: "v1",
};

function area(
  body: AreaResponsibility["body"],
  effective: AreaResponsibility["effective"],
  name: AreaResponsibility["area"] = "contracts",
): AreaResponsibility {
  return { area: name, body, effective, source: "traeger" };
}

describe("traeger-responsibilities-api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the schools and leaves out what this build does not know", async () => {
    bffJson.mockResolvedValue({
      schools: [
        {
          school_id: "11",
          school_name: "OGS Nord",
          areas: [
            {
              area: "contracts",
              body: "gemeinde",
              source: "school",
              effective: "gemeinde",
            },
            {
              area: "billing",
              body: "gemeinde",
              source: "traeger",
              effective: "traeger",
            },
            {
              area: "catering",
              body: "traeger",
              source: "default",
              effective: "traeger",
            },
          ],
          parties: [
            {
              kind: "gemeinde",
              name: "Gemeinde Hardt",
              street: "Rathausplatz 1",
              postal_code: "41749",
              city: "Viersen",
              contact_name: "",
              contact_phone: "",
              contact_email: "",
              creditor_id: "",
              account_holder: "",
              iban: "",
              bic: "",
              bank_name: "",
              version: "v1",
            },
            { kind: "kirche", name: "Unbekannt", version: "v9" },
          ],
        },
        { school_id: "12", school_name: "OGS Süd", areas: null, parties: null },
      ],
    });

    const schools = await fetchResponsibilities();

    expect(bffJson).toHaveBeenCalledWith(
      "org",
      "GET /traeger/master-data/responsibilities",
    );
    expect(schools).toHaveLength(2);
    expect(schools[0]?.areas).toEqual([
      {
        area: "contracts",
        body: "gemeinde",
        source: "school",
        effective: "gemeinde",
      },
      {
        area: "billing",
        body: "gemeinde",
        source: "traeger",
        effective: "traeger",
      },
    ]);
    expect(schools[0]?.parties).toEqual([gemeinde]);
    expect(schools[1]).toEqual({
      schoolId: "12",
      schoolName: "OGS Süd",
      areas: [],
      parties: [],
    });
  });

  it("saves a body with the version it was read at and trims the texts", async () => {
    bffJson.mockResolvedValue({
      kind: "gemeinde",
      name: "Gemeinde Hardt",
      street: "Rathausplatz 1",
      postal_code: "41749",
      city: "Viersen",
      contact_name: "",
      contact_phone: "",
      contact_email: "",
      creditor_id: "",
      account_holder: "",
      iban: "",
      bic: "",
      bank_name: "",
      version: "v2",
    });

    const saved = await saveSchoolParty(
      "11",
      "gemeinde",
      { ...gemeinde, name: "  Gemeinde Hardt " },
      "v1",
    );

    expect(bffJson).toHaveBeenCalledWith(
      "org",
      "PUT /traeger/master-data/responsibilities/schools/{schoolId}/parties/{kind}",
      {
        params: { schoolId: "11", kind: "gemeinde" },
        body: expect.objectContaining({
          name: "Gemeinde Hardt",
          postal_code: "41749",
          expected_version: "v1",
        }),
      },
    );
    expect(saved.version).toBe("v2");
  });

  it("removes a body of one school", async () => {
    bffJson.mockResolvedValue(undefined);
    await removeSchoolParty("11", "schultraeger");
    expect(bffJson).toHaveBeenCalledWith(
      "org",
      "DELETE /traeger/master-data/responsibilities/schools/{schoolId}/parties/{kind}",
      { params: { schoolId: "11", kind: "schultraeger" } },
    );
  });

  it("names what keeps a chosen body from taking over", () => {
    const without = { parties: [] };
    const withBody = { parties: [gemeinde] };
    expect(responsibilityGap(without, area("traeger", "traeger"))).toBeNull();
    expect(
      responsibilityGap(withBody, area("gemeinde", "gemeinde")),
    ).toBeNull();
    // No name and address yet: the Träger stands in.
    expect(responsibilityGap(without, area("gemeinde", "traeger"))).toBe(
      "missing",
    );
    // Stored, but billing needs creditor identifier and account.
    expect(
      responsibilityGap(withBody, area("gemeinde", "traeger", "billing")),
    ).toBe("billing");
  });

  it("names the responsible body by its stored name", () => {
    expect(responsibleName({ parties: [gemeinde] }, "gemeinde")).toBe(
      "Gemeinde Hardt",
    );
    expect(responsibleName({ parties: [] }, "schultraeger")).toBe(
      "Schulträger",
    );
    expect(responsibleName({ parties: [gemeinde] }, "traeger")).toBe("Träger");
  });

  it("bills only with creditor identifier and account", () => {
    expect(billingReady(gemeinde)).toBe(false);
    expect(
      billingReady({ ...gemeinde, creditorId: "DE98ZZZ09999999999" }),
    ).toBe(false);
    expect(
      billingReady({
        ...gemeinde,
        creditorId: "DE98ZZZ09999999999",
        iban: "DE02120300000000202051",
      }),
    ).toBe(true);
  });
});
