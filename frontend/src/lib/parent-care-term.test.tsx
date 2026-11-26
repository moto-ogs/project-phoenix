import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import {
  accountCareTerm,
  ParentCareTermScope,
  ParentChildCareTermScope,
  ParentSchoolCareTermScope,
  useParentCareTerms,
} from "./parent-care-term";
import { useErrorCareFacilityTerm } from "./care-facility-term-context";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const resources = vi.hoisted(() => ({
  children: [] as parentMeContract.ChildResponse[],
  features: {} as Record<
    string,
    Partial<parentMeContract.ChildFeaturesResponse>
  >,
}));

vi.mock("~/lib/hooks/use-parent-resources", () => ({
  useParentChildren: () => ({ data: resources.children }),
  useParentFeatures: (
    children: readonly parentMeContract.ChildResponse[] | undefined,
  ) => ({
    data: children ? resources.features : undefined,
  }),
}));

function child(
  studentId: string,
  schoolName: string,
): parentMeContract.ChildResponse {
  return {
    care_ended: false,
    student_id: studentId,
    tenant_id: `t-${schoolName}`,
    first_name: `Kind ${studentId}`,
    last_name: "Muster",
    status: "active",
    school_name: schoolName,
    school_slug: schoolName.toLowerCase(),
  };
}

function link(
  ...rows: [
    parentMeContract.ChildResponse,
    string | undefined,
    article?: string,
  ][]
) {
  resources.children = rows.map(([row]) => row);
  resources.features = Object.fromEntries(
    rows.map(([row, term, article]) => [
      row.student_id,
      { care_facility_term: term, care_facility_article: article },
    ]),
  );
}

function Today() {
  const t = useCareTermTranslations("parentToday");
  return <p>{t("atOgs")}</p>;
}

describe("care term in the parents portal (#6082)", () => {
  it("names one term when all schools share it, else every term once", () => {
    expect(accountCareTerm([])).toBeUndefined();
    expect(accountCareTerm(["GTS", " GTS "])).toBe("GTS");
    expect(accountCareTerm(["OGS", "GTS", "OGS"])).toBe("OGS/GTS");
    expect(accountCareTerm([undefined, "GTS"])).toBe("GTS");
  });

  it("names each child's care with its own school's term", () => {
    link([child("1", "Barnstorf"), "GTS"], [child("2", "Sonnenschule"), "OGS"]);
    render(
      <ParentCareTermScope enabled>
        <ParentChildCareTermScope studentId="1">
          <Today />
        </ParentChildCareTermScope>
        <ParentChildCareTermScope studentId="2">
          <Today />
        </ParentChildCareTermScope>
      </ParentCareTermScope>,
    );
    expect(screen.getByText("In der GTS")).toBeInTheDocument();
    expect(screen.getByText("In der OGS")).toBeInTheDocument();
  });

  it("uses the account's term for texts without a child", () => {
    link([child("1", "Barnstorf"), "GTS"], [child("2", "Barnstorf"), "GTS"]);
    const { unmount } = render(
      <ParentCareTermScope enabled>
        <Today />
      </ParentCareTermScope>,
    );
    expect(screen.getByText("In der GTS")).toBeInTheDocument();
    unmount();

    link([child("1", "Barnstorf"), "GTS"], [child("2", "Sonnenschule"), "OGS"]);
    render(
      <ParentCareTermScope enabled>
        <Today />
      </ParentCareTermScope>,
    );
    expect(screen.getByText("In der GTS/OGS")).toBeInTheDocument();
  });

  // #8136: each school's own article declines its name; an account with
  // schools of different articles reads each name with its own.
  it("declines each school's name with its own article", () => {
    link(
      [child("1", "Barnstorf"), "Hort", "der"],
      [child("2", "Sonnenschule"), "Lernhaus", "das"],
      [child("3", "Talschule"), "OGS", "die"],
    );
    render(
      <ParentCareTermScope enabled>
        <ParentChildCareTermScope studentId="1">
          <Today />
        </ParentChildCareTermScope>
        <ParentChildCareTermScope studentId="2">
          <Today />
        </ParentChildCareTermScope>
        <Today />
      </ParentCareTermScope>,
    );
    expect(screen.getByText("Im Hort")).toBeInTheDocument();
    expect(screen.getByText("Im Lernhaus")).toBeInTheDocument();
    expect(
      screen.getByText("Im Hort/im Lernhaus/in der OGS"),
    ).toBeInTheDocument();
  });

  it("hands rows of several children each school's declined name", () => {
    link(
      [child("1", "Barnstorf"), "Hort", "der"],
      [child("2", "Sonnenschule"), "GTS"],
    );
    let terms: ReturnType<typeof useParentCareTerms> | undefined;
    function Probe() {
      terms = useParentCareTerms();
      return null;
    }
    render(
      <ParentCareTermScope enabled>
        <Probe />
      </ParentCareTermScope>,
    );
    expect(terms?.valuesOf("1").careAcc).toBe("den Hort");
    expect(terms?.valuesOf("2").careAcc).toBe("die GTS");
    expect(terms?.valuesOfSchool("Barnstorf").careVon).toBe("vom Hort");
    expect(terms?.valuesOf(undefined).careNom).toBe("der Hort/die GTS");
    expect(terms?.termOf("1")).toBe("Hort");
    expect(terms?.account).toBe("Hort/GTS");
  });

  it("keeps a child's subtree mounted when its term arrives late", () => {
    link([child("1", "Barnstorf"), undefined]);
    function Draft() {
      const [draft, setDraft] = useState("");
      return (
        <>
          <Today />
          <input
            aria-label="Entwurf"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </>
      );
    }
    const tree = () => (
      <ParentCareTermScope enabled>
        <ParentChildCareTermScope studentId="1">
          <Draft />
        </ParentChildCareTermScope>
      </ParentCareTermScope>
    );
    const { rerender } = render(tree());
    fireEvent.change(screen.getByLabelText("Entwurf"), {
      target: { value: "Bis gleich" },
    });
    expect(screen.getByText("In der OGS")).toBeInTheDocument();

    link([child("1", "Barnstorf"), "GTS"]);
    rerender(tree());
    expect(screen.getByText("In der GTS")).toBeInTheDocument();
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Bis gleich");
  });

  it("says OGS outside the parents shell", () => {
    let terms: ReturnType<typeof useParentCareTerms> | undefined;
    function Probe() {
      terms = useParentCareTerms();
      return null;
    }
    render(
      <ParentChildCareTermScope studentId="1">
        <Today />
        <Probe />
      </ParentChildCareTermScope>,
    );
    expect(screen.getByText("In der OGS")).toBeInTheDocument();
    expect(terms?.termOf("1")).toBe("OGS");
  });

  it("keeps OGS while no school named its term", () => {
    link([child("1", "Sonnenschule"), undefined]);
    render(
      <ParentCareTermScope enabled>
        <ParentChildCareTermScope studentId="1">
          <Today />
        </ParentChildCareTermScope>
      </ParentCareTermScope>,
    );
    expect(screen.getByText("In der OGS")).toBeInTheDocument();
  });

  it("finds a school's term for rows that name a school, not a child", () => {
    link([child("1", "Barnstorf"), "GTS"], [child("2", "Sonnenschule"), "OGS"]);
    let terms: ReturnType<typeof useParentCareTerms> | undefined;
    function Probe() {
      terms = useParentCareTerms();
      return null;
    }
    render(
      <ParentCareTermScope enabled>
        <Probe />
      </ParentCareTermScope>,
    );
    expect(terms?.termOfSchool("Barnstorf")).toBe("GTS");
    expect(terms?.termOfSchool("Sonnenschule")).toBe("OGS");
    expect(terms?.termOfSchool("Unbekannt")).toBe("GTS/OGS");
    expect(terms?.termOf("2")).toBe("OGS");
  });

  it("names a letter's own school in its texts and error messages (#6258)", () => {
    link([child("1", "Barnstorf"), "GTS"], [child("2", "Sonnenschule"), "OGS"]);
    function ErrorTerm() {
      return <p>Fehler: {useErrorCareFacilityTerm()}</p>;
    }
    render(
      <ParentCareTermScope enabled>
        <ParentSchoolCareTermScope schoolName="Barnstorf">
          <Today />
          <ErrorTerm />
        </ParentSchoolCareTermScope>
        <ParentSchoolCareTermScope schoolName="Unbekannt">
          <ErrorTerm />
        </ParentSchoolCareTermScope>
      </ParentCareTermScope>,
    );
    expect(screen.getByText("In der GTS")).toBeInTheDocument();
    expect(screen.getByText("Fehler: GTS")).toBeInTheDocument();
    expect(screen.getByText("Fehler: GTS/OGS")).toBeInTheDocument();
  });
});
