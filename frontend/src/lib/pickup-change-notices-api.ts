// Geänderte Abholzeit für einen Tag (#6855): API client for the unread
// markers of the staff responsible for a child. The backend stores one
// marker per approved one-day pickup request and staff member; a corrected
// decision sets it unread again as taken back.

import { bffJson } from "./bff-fetch";
import type { pickupChangeNoticeResponse } from "./contract/students.generated";

/** A changed pickup time of a child the reader looks after, not yet seen. */
export interface PickupChangeNotice {
  requestId: string;
  studentId: string;
  /** First name only: enough to find the child, no more. */
  studentFirstName: string;
  /** The day as "YYYY-MM-DD". */
  date: string;
  /** The approved time ("15:00"); empty when the change was taken back. */
  pickupTime: string;
  /** Who the family named to collect the child (#8162); empty for none. */
  pickupPerson: string;
  /** A corrected decision took the time back; the regular time applies. */
  withdrawn: boolean;
  informedAt: string;
}

export type PickupChangeNoticeRevision = Pick<
  PickupChangeNotice,
  "requestId" | "informedAt"
>;

function mapNotice(data: pickupChangeNoticeResponse): PickupChangeNotice {
  return {
    requestId: data.request_id,
    studentId: data.student_id,
    studentFirstName: data.student_first_name,
    date: data.date,
    pickupTime: data.pickup_time ?? "",
    pickupPerson: data.pickup_person ?? "",
    withdrawn: data.withdrawn,
    informedAt: data.informed_at,
  };
}

export const pickupChangeNoticesService = {
  /** The reader's unseen changes on days from today on, newest first. */
  async list(): Promise<PickupChangeNotice[]> {
    const notices = await bffJson(
      "tenant",
      "GET /api/students/pickup-change-notices",
    );
    return notices.map(mapNotice);
  },

  /**
   * Marks only the revisions the reader saw as seen; answers with the
   * changes still unseen. A change told again meanwhile stays unseen.
   */
  async markRead(
    studentId: string,
    observed: readonly PickupChangeNoticeRevision[],
  ): Promise<PickupChangeNotice[]> {
    const notices = await bffJson(
      "tenant",
      "POST /api/students/{id}/pickup-change-notices/read",
      {
        params: { id: studentId },
        body: {
          notices: observed.map((notice) => ({
            request_id: notice.requestId,
            informed_at: notice.informedAt,
          })),
        },
      },
    );
    return notices.map(mapNotice);
  },
};
