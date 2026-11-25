import { beforeEach, vi } from "vitest";
import * as parentApi from "~/lib/parent-api";
import type * as parent from "~/lib/contract/parent-me.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { isAccessRefusal } from "~/lib/access-refusal";
import { ApiError } from "~/lib/api-error";

// One browser response. Each test supplies only the school/child facts its
// component uses; a failed card field is null on the wire, not a failed GET.
export function parentFamilyFixture(currentDay = berlinTodayISO) {
  type Child = Pick<parent.ChildResponse, "tenant_id" | "student_id"> &
    Partial<parent.ChildResponse>;
  const children = vi.fn<() => Promise<Child[]>>(async () => []);
  const features = vi.fn<
    (id: string) => Promise<Partial<parent.ChildFeaturesResponse>>
  >(async () => ({}));
  const today = vi.fn<(id: string) => Promise<parent.TodayStatusResponse>>(
    async () => ({ at_ogs: null, state: "unknown" }),
  );
  beforeEach(() => {
    children.mockReset();
    features.mockReset();
    today.mockReset();
  });
  function missing(error: unknown): null {
    if (
      error instanceof ApiError &&
      (isAccessRefusal(error) || error.status === 429)
    )
      throw error;
    return null;
  }
  async function read(studentId?: string): Promise<parent.FamilyStartResponse> {
    const rows = (await children()).filter(
      (c) => !studentId || c.student_id === studentId,
    );
    return {
      day: currentDay(),
      day_remaining_seconds: 86400,
      cards: await Promise.all(
        rows.map(async (child) => ({
          child: {
            first_name: "",
            last_name: "",
            status: "active",
            school_slug: "school",
            school_name: "School",
            care_ended: false,
            ...child,
          },
          access_version: "fixture",
          features: (await features(child.student_id).catch(
            missing,
          )) as parent.ChildFeaturesResponse | null,
          today: await today(child.student_id).catch(missing),
        })),
      ),
    };
  }
  return {
    children,
    features,
    today,
    read,
    mockRead: () =>
      vi.spyOn(parentApi, "getFamilyStart").mockImplementation(read),
  };
}
