import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { hasPermission } from "~/lib/auth-utils";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { careOfferingFromContract } from "~/lib/care-offering-api";
import { mapCareOfferingBookingStats } from "~/lib/care-offering-booking-stats";
import {
  initialOfferingPhaseId,
  phaseFromContract,
} from "~/lib/enrollment-phase-api";
import { databaseKeys } from "~/lib/swr/portal-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { mapPeriods } from "~/lib/calendar-period-helpers";
import { mapOfferingTemplates } from "~/lib/timetable-helpers";
import * as timetableContract from "~/lib/contract/timetable.generated";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import PageContent from "./page-content";
import { CareOfferingsSeed } from "./page-seed";

async function loadSeed(slug: string) {
  const context = await readTenantPageContext(slug, "online_anmeldung").catch(
    () => null,
  );
  if (!context || !hasPermission(context.session, "config:manage")) return null;
  const builtAt = Date.now();
  const { snapshot, session, token } = context;
  const phases = seedRead("GET /api/enrollment/phases/", async (signal) => {
    const { data } = await readContract(routes["GET /api/enrollment/phases/"], {
      token,
      signal,
    });
    return data.map(phaseFromContract);
  });
  const entries: ServerSeedEntry[] = [
    { key: enrollmentKeys.phases(), render: true, value: phases },
  ];
  if (hasPermission(session, "schedules:read")) {
    entries.push(
      {
        key: databaseKeys.calendarPeriods(),
        value: seedRead("GET /api/timetable/periods/", async (signal) => {
          const { data } = await readContract(
            timetableContract.routes["GET /api/timetable/periods/"],
            { token, signal },
          );
          return mapPeriods(data);
        }),
      },
      {
        key: enrollmentKeys.offeringTemplates(),
        value: seedRead("GET /api/timetable/templates", async (signal) => {
          const { data } = await readContract(
            timetableContract.routes["GET /api/timetable/templates"],
            { token, signal },
          );
          return mapOfferingTemplates(data);
        }),
      },
    );
  }

  const phaseId = initialOfferingPhaseId((await phases) ?? []);
  if (phaseId) {
    const query = { phase_id: phaseId };
    entries.push(
      {
        key: enrollmentKeys.careOfferings(phaseId),
        render: true,
        value: seedRead(
          "GET /api/enrollment/care-offerings/",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/enrollment/care-offerings/"],
              { token, signal, query },
            );
            return data.map(careOfferingFromContract);
          },
        ),
      },
      {
        key: enrollmentKeys.bookingStats(phaseId),
        value: seedRead(
          "GET /api/enrollment/care-offerings/booking-stats",
          async (signal) => {
            const { data } = await readContract(
              routes["GET /api/enrollment/care-offerings/booking-stats"],
              { token, signal, query },
            );
            return mapCareOfferingBookingStats(data);
          },
        ),
      },
    );
  }
  return seedOf(snapshot, entries, builtAt);
}

export default async function CareOfferingsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <CareOfferingsSeed seed={loadSeed(tenant)}>
      <PageContent />
    </CareOfferingsSeed>
  );
}
