import { routes } from "~/lib/contract/holiday-guests.generated";
import { mapHolidayGuestBadges } from "~/lib/holiday-host-api";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { holidayKeys } from "~/lib/swr/portal-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";

export function holidayGuestBadgeSeed(
  token: string,
  guestIds: readonly string[],
): ServerSeedEntry {
  return {
    key: holidayKeys.guestBadges(guestIds),
    value: seedRead("GET /api/holiday-guests/", async (signal) => {
      const { data } = await readContract(routes["GET /api/holiday-guests/"], {
        token,
        signal,
      });
      return mapHolidayGuestBadges(data, guestIds);
    }),
  };
}
