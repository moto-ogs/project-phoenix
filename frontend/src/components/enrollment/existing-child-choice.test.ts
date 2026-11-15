import { describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import {
  DUPLICATE_ENROLLMENT_REASON,
  REJECT_DUPLICATE_CHOICE,
  existingChildChoiceDescription,
  existingChildChoiceOf,
  existingChildChoiceOptions,
  existingChildHint,
  possiblyEnrolledCandidates,
  renewedChildNameOf,
  sendWithExistingChildChoice,
} from "./existing-child-choice";

const candidate = {
  student_id: "42",
  first_name: "Mara",
  last_name: "Papier",
  date_of_birth: "2019-03-01",
  school_class: "1a",
};

function possiblyEnrolled(candidates: unknown = [candidate]) {
  return new ApiError("child may already be enrolled", 409, {
    code: "enrollment.child_possibly_enrolled",
    details: { candidates },
  });
}

describe("possiblyEnrolledCandidates (#6148)", () => {
  it("reads the candidates of the refusal", () => {
    expect(possiblyEnrolledCandidates(possiblyEnrolled())).toEqual([candidate]);
  });

  it("ignores other errors and a refusal without usable candidates", () => {
    expect(
      possiblyEnrolledCandidates(
        new ApiError("full", 409, { code: "students.child_quota_reached" }),
      ),
    ).toBeNull();
    expect(possiblyEnrolledCandidates(possiblyEnrolled([]))).toBeNull();
    expect(
      possiblyEnrolledCandidates(possiblyEnrolled([{ first_name: "Mara" }])),
    ).toBeNull();
    expect(possiblyEnrolledCandidates(new Error("offline"))).toBeNull();
  });
});

describe("sendWithExistingChildChoice (#6148)", () => {
  it("sends once without a choice when no child matches", async () => {
    const send = vi.fn().mockResolvedValue("created");
    const ask = vi.fn();

    await expect(sendWithExistingChildChoice(send, ask)).resolves.toBe(
      "created",
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(undefined);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the office and sends again with the chosen child", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(possiblyEnrolled())
      .mockResolvedValueOnce("renewed");
    const ask = vi.fn().mockResolvedValue({ existingStudentId: "42" });

    await expect(sendWithExistingChildChoice(send, ask)).resolves.toBe(
      "renewed",
    );
    expect(ask).toHaveBeenCalledWith([candidate]);
    expect(send).toHaveBeenLastCalledWith({ existingStudentId: "42" });
  });

  it("sends again as a new child when the office says so", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(possiblyEnrolled())
      .mockResolvedValueOnce("created");
    const choice = { createNewStudent: true, shownStudentIds: ["42"] };
    const ask = vi.fn().mockResolvedValue(choice);

    await sendWithExistingChildChoice(send, ask);
    expect(send).toHaveBeenLastCalledWith(choice);
  });

  // Another child was enrolled after the office saw the list (#6247): the
  // new child is refused again, and the office answers with the new list.
  it("asks again when the answer meets a candidate the office did not see", async () => {
    const appeared = { ...candidate, student_id: "43" };
    const send = vi
      .fn()
      .mockRejectedValueOnce(possiblyEnrolled())
      .mockRejectedValueOnce(possiblyEnrolled([candidate, appeared]))
      .mockResolvedValueOnce("renewed");
    const ask = vi
      .fn()
      .mockResolvedValueOnce({
        createNewStudent: true,
        shownStudentIds: ["42"],
      })
      .mockResolvedValueOnce({ existingStudentId: "43" });

    await expect(sendWithExistingChildChoice(send, ask)).resolves.toBe(
      "renewed",
    );
    expect(ask).toHaveBeenLastCalledWith([candidate, appeared]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith({ existingStudentId: "43" });
  });

  it("gives up after a few refusals in a row", async () => {
    const refusal = possiblyEnrolled();
    const send = vi.fn().mockRejectedValue(refusal);
    const ask = vi
      .fn()
      .mockResolvedValue({ createNewStudent: true, shownStudentIds: [] });

    await expect(sendWithExistingChildChoice(send, ask)).rejects.toBe(refusal);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("stops without saving when the office cancels", async () => {
    const send = vi.fn().mockRejectedValueOnce(possiblyEnrolled());
    const ask = vi.fn().mockResolvedValue(null);

    await expect(sendWithExistingChildChoice(send, ask)).resolves.toBeNull();
    expect(send).toHaveBeenCalledOnce();
  });

  it("passes every other failure on", async () => {
    const failure = new ApiError("full", 409, {
      code: "students.child_quota_reached",
    });
    const send = vi.fn().mockRejectedValue(failure);
    const ask = vi.fn();

    await expect(sendWithExistingChildChoice(send, ask)).rejects.toBe(failure);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("existingChildChoiceOptions for the manual enrollment", () => {
  it("offers the candidate and a new child, like the detail view", () => {
    expect(
      existingChildChoiceOptions({
        first_name: "Mara",
        last_name: "Papier",
        possible_existing_children: [candidate],
      }),
    ).toEqual([
      {
        value: "42",
        label: "Bestehendes Kind verwenden",
        description: "Mara Papier · Klasse 1a · geboren am 01.03.2019",
      },
      {
        value: "new",
        label: "Als neues Kind anlegen",
        description: "Wählen Sie dies nur, wenn es ein anderes Kind ist.",
      },
    ]);
  });
});

describe("renewedChildNameOf (#6148)", () => {
  it("names the chosen enrolled child as the school knows it", () => {
    expect(
      renewedChildNameOf({ existingStudentId: "42" }, [
        { ...candidate, first_name: "Mara-Sophie" },
      ]),
    ).toBe("Mara-Sophie Papier");
  });

  it("names no child for a new child or no choice", () => {
    expect(
      renewedChildNameOf({ createNewStudent: true, shownStudentIds: ["42"] }, [
        candidate,
      ]),
    ).toBe(null);
    expect(renewedChildNameOf(undefined, [candidate])).toBe(null);
  });
});

describe("existingChildChoiceOf (#6247)", () => {
  it("sends a new child with every candidate the dialog showed", () => {
    expect(
      existingChildChoiceOf("new", {
        possible_existing_children: [
          candidate,
          { ...candidate, student_id: "43" },
        ],
      }),
    ).toEqual({ createNewStudent: true, shownStudentIds: ["42", "43"] });
    expect(existingChildChoiceOf("new", {})).toEqual({
      createNewStudent: true,
      shownStudentIds: [],
    });
    expect(existingChildChoiceOf("42", {})).toEqual({
      existingStudentId: "42",
    });
  });
});

// Two parents enrolled the same new child; the first enrollment is approved
// and holds the child in the phase (#6247).
describe("a duplicate of another enrollment of the phase", () => {
  const held = {
    ...candidate,
    phase_request: {
      request_id: "77",
      child_status: "approved" as const,
      guardian_first_name: "Derya",
      guardian_last_name: "Kaya",
    },
  };
  const child = {
    id: "child-1",
    first_name: "Mara",
    last_name: "Papier",
    date_of_birth: "2019-03-01",
    status: "submitted" as const,
    activation_mode: "scheduled",
    possible_existing_children: [held],
  };

  it("names the other enrollment and the next steps on the card", () => {
    expect(existingChildHint(child, "Emre Kaya")).toEqual({
      title: "Mara Papier ist in dieser Phase schon angemeldet",
      message:
        "Derya Kaya hat Mara schon angemeldet. Ist es dasselbe Kind, lehnen Sie diese Anmeldung ab. Tragen Sie Emre Kaya dann in der Akte als Elternteil ein.",
      duplicate: true,
      listsCandidates: true,
    });
  });

  it("blocks renewing the held child and offers to refuse the duplicate", () => {
    const options = existingChildChoiceOptions(child, {
      canRejectDuplicate: true,
    });
    expect(options.map((option) => option.value)).toEqual([
      "42",
      REJECT_DUPLICATE_CHOICE,
      "new",
    ]);
    expect(options[0]).toMatchObject({
      disabled: true,
      disabledReason:
        "Das Kind ist in dieser Phase schon angemeldet. Lehnen Sie diese Anmeldung ab.",
      description:
        "Mara Papier · Klasse 1a · geboren am 01.03.2019 · schon angemeldet von Derya Kaya",
    });
    expect(options[1]).toMatchObject({ primary: true });
    expect(
      existingChildChoiceDescription(child, { canRejectDuplicate: true }),
    ).toBe(
      "Derya Kaya hat Mara Papier in dieser Phase schon angemeldet. Ist es dasselbe Kind, lehnen Sie diese Anmeldung als doppelt ab.",
    );
  });

  it("offers no refusal where the form has no enrollment to refuse", () => {
    expect(
      existingChildChoiceOptions(child).map((option) => option.value),
    ).toEqual(["42", "new"]);
  });

  it("refuses with a reason that names no other family", () => {
    expect(DUPLICATE_ENROLLMENT_REASON).not.toMatch(/Derya|Kaya/);
  });
});
