import * as absenceContract from "~/lib/contract/absence-types.generated";
import * as shiftContract from "~/lib/contract/staff-shifts.generated";
import { routes } from "~/lib/contract/staff.generated";
import * as trackingContract from "~/lib/contract/time-tracking.generated";
import { mapAbsenceType, mapAllowance } from "~/lib/absence-type-api";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { mapStaffShift } from "~/lib/shift-helpers";
import {
  loadStaffProjectionRange,
  mapScheduleResponse,
  mapStaffAbsenceRow,
  mapStaffHistoryDetails,
  mapStaffPayrollNumber,
  minimalProfile,
} from "~/lib/staff-api";
import {
  overviewAbsence,
  overviewSession,
  staffBalanceEntry,
  staffTableShift,
} from "~/lib/staff-tab-projections";
import { mapTraegerProof } from "~/lib/staff-qualification-api";
import { mapStaffTargetOverride } from "~/lib/staff-target-overrides-api";
import { staffAbsenceKeys, staffKeys } from "~/lib/swr/staff-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import {
  mapBalanceAdjustmentResponse,
  mapClosingDaysResponse,
  mapDailyProjectionResponse,
  mapHolidaysResponse,
  mapMonthSummaryResponse,
} from "~/lib/time-tracking-helpers";
import {
  staffAllowancesKey,
  staffAllowanceTypes,
  staffOverviewReads,
  staffTabOpening,
  type StaffDetailOpening,
} from "./staff-detail-seed-keys";
import { staffDetailAccess } from "./staff-detail-tabs";

type Range = { from: string; to: string };

export async function loadStaffDetailSeed(
  slug: string,
  opening: StaffDetailOpening,
  builtAt: number,
) {
  const context = await readTenantPageContext(slug).catch(() => null);
  if (!context) return null;
  const { snapshot, session, tenant, token } = context;
  const access = staffDetailAccess(session, tenant.bookedModules);
  const { id, today } = opening;
  const params = { id };
  const entries: ServerSeedEntry[] = [];
  const readRecord = () =>
    seedRead(
      "staff record",
      async (signal) =>
        (
          await readContract(routes["GET /api/staff/{id}"], {
            token,
            signal,
            params,
          })
        ).data,
    );

  let active: Promise<boolean>;
  if (access.limitedProfile) {
    const limited = access.limitedProfile;
    const profile = seedRead("staff identity", async (signal) => {
      const route =
        limited === "financial"
          ? routes["GET /api/staff/financial-profile/{id}"]
          : routes["GET /api/staff/documents-profile/{id}"];
      return minimalProfile(
        (await readContract(route, { token, signal, params })).data,
        limited,
      );
    });
    entries.push({
      key: staffKeys.profileKey(id),
      render: true,
      value: profile,
    });
    active = profile.then((person) => !!person && !person.endedOn);
    if (access.viewRecord) {
      entries.push({
        key: staffKeys.recordKey(id),
        value: active.then((isActive) => (isActive ? readRecord() : undefined)),
      });
    }
  } else if (access.viewRecord) {
    const record = readRecord();
    entries.push({ key: staffKeys.recordKey(id), render: true, value: record });
    active = record.then((person) => !!person && !person.ended_on);
  } else {
    return null;
  }

  // Former employment shows the identity-only Beschäftigung tab, regardless
  // of the URL. An unavailable identity must not start any tab GETs either.
  const afterIdentity = <T>(
    name: string,
    load: (signal: AbortSignal) => Promise<T>,
  ) => active.then((isActive) => (isActive ? seedRead(name, load) : undefined));
  const entry = <T>(
    key: string | null,
    name: string,
    load: (signal: AbortSignal) => Promise<T>,
  ) => {
    if (key !== null) entries.push({ key, value: afterIdentity(name, load) });
  };

  // The badge and the absence tab share one Go GET when their windows match,
  // but only the absence tab gets the rows under its own display key.
  const absences = new Map<
    string,
    Promise<Awaited<ReturnType<typeof readAbsences>> | undefined>
  >();
  function readAbsences(signal: AbortSignal, query: Range) {
    return readContract(routes["GET /api/staff/{id}/absences"], {
      token,
      signal,
      params,
      query,
    }).then(({ data }) => data ?? []);
  }
  function loadAbsences(query: Range) {
    const range = `${query.from}/${query.to}`;
    const value =
      absences.get(range) ??
      afterIdentity("staff absences", (signal) => readAbsences(signal, query));
    absences.set(range, value);
    return value;
  }
  if (access.manageAbsences) {
    const year = today.slice(0, 4);
    const rows = loadAbsences({ from: `${year}-01-01`, to: `${year}-12-31` });
    entries.push({
      key: staffAbsenceKeys.pendingForStaff(id),
      value: rows.then(
        (data) =>
          data?.filter(
            ({ status }) => status === "requested" || status === "question",
          ).length,
      ),
    });
  }

  const loadConfig = async (signal: AbortSignal) => {
    const { data } = await readContract(
      trackingContract.routes["GET /api/time-tracking/config"],
      { token, signal },
    );
    return { accountStartDate: data.account_start_date };
  };
  const loadMonth =
    ({ year, month }: { year: number; month: number }) =>
    async (signal: AbortSignal) => {
      const { data } = await readContract(
        routes["GET /api/staff/{id}/time-tracking/month-summary"],
        {
          token,
          signal,
          params,
          query: { year, month },
        },
      );
      return mapMonthSummaryResponse(data);
    };
  const loadHistory = async (query: Range, signal: AbortSignal) =>
    (
      await readContract(routes["GET /api/staff/{id}/time-tracking/history"], {
        token,
        signal,
        params,
        query,
      })
    ).data;
  const loadTargets = (query: Range, signal: AbortSignal) =>
    readContract(routes["GET /api/staff/{id}/time-tracking/schedule-targets"], {
      token,
      signal,
      params,
      query: { from: query.from, to: query.to },
    }).then(({ data }) => mapDailyProjectionResponse(data));
  const loadSchedule = async (signal: AbortSignal) =>
    mapScheduleResponse(
      (
        await readContract(routes["GET /api/staff/{id}/schedule"], {
          token,
          signal,
          params,
        })
      ).data,
    );

  const tab = staffTabOpening(opening, access);
  switch (tab.tab) {
    case "uebersicht": {
      const config = afterIdentity("time tracking config", loadConfig);
      entries.push({ key: tab.configKey, value: config });
      const settings = await config;
      // A failed config read must not seed a guessed account anchor. The
      // browser keeps its existing fallback and can recover the real anchor.
      if (!settings) break;
      if (settings.accountStartDate <= today) {
        entry(tab.monthKey, "staff month summary", loadMonth(tab));
      }
      const {
        from,
        to,
        historyFrom,
        adjustmentTo,
        history,
        absences,
        adjustments,
        targets,
      } = staffOverviewReads(id, today, settings.accountStartDate);
      entry(history, "staff overview history", async (signal) =>
        mapStaffHistoryDetails(
          await loadHistory({ from: historyFrom, to }, signal),
        ).sessions.map(overviewSession),
      );
      entries.push({
        key: absences,
        value: loadAbsences({ from, to }).then((rows) =>
          rows?.map(overviewAbsence),
        ),
      });
      entry(adjustments, "staff balance adjustments", async (signal) => {
        const { data } = await readContract(
          routes["GET /api/staff/{id}/time-tracking/adjustments"],
          {
            token,
            signal,
            params,
            query: { from, to: adjustmentTo },
          },
        );
        return (data ?? []).map((row) =>
          staffBalanceEntry(mapBalanceAdjustmentResponse(row)),
        );
      });
      entry(targets, "staff overview targets", (signal) =>
        loadStaffProjectionRange(from, to, (range) =>
          loadTargets(range, signal),
        ),
      );
      break;
    }
    case "zeiterfassung": {
      const { keys, visible, current } = tab;
      const { from, to, historyFrom } = visible;
      const query = { from, to };
      entry(keys.schedule, "staff schedule", loadSchedule);
      entry(keys.config, "time tracking config", loadConfig);
      entry(keys.month, "staff month summary", loadMonth(tab));
      entry(keys.history, "staff week history", async (signal) =>
        mapStaffHistoryDetails(
          await loadHistory({ from: historyFrom, to }, signal),
        ),
      );
      entries.push({
        key: keys.absences,
        value: loadAbsences(query).then((rows) =>
          rows?.map(mapStaffAbsenceRow),
        ),
      });
      entry(keys.shifts, "staff shifts", async (signal) => {
        const { data } = await readContract(
          shiftContract.routes["GET /api/staff-shifts/"],
          {
            token,
            signal,
            query: { staff_id: id, from, to },
          },
        );
        return (data ?? []).map(mapStaffShift).map(staffTableShift);
      });
      entry(keys.targets, "staff week targets", (signal) =>
        loadTargets(query, signal),
      );
      if (keys.currentTargets !== keys.targets) {
        entry(keys.currentTargets, "staff current week targets", (signal) =>
          loadTargets(current, signal),
        );
      }
      entry(keys.holidays, "staff table holidays", async (signal) => {
        const { data } = await readContract(
          trackingContract.routes["GET /api/time-tracking/holidays"],
          { token, signal, query },
        );
        return mapHolidaysResponse(data);
      });
      entry(keys.closingDays, "staff table closing days", async (signal) => {
        const { data } = await readContract(
          trackingContract.routes["GET /api/time-tracking/closing-days"],
          { token, signal, query },
        );
        return mapClosingDaysResponse(data, from, to);
      });
      break;
    }
    case "arbeitszeitmodell": {
      const { keys, preview } = tab;
      const schedule = afterIdentity("staff schedule", loadSchedule);
      entries.push({ key: keys.schedule, value: schedule });
      entry(keys.month, "staff month summary", loadMonth(tab));
      // Both sections mount only after the browser has a schedule (an empty
      // schedule still shows Sonderarbeitszeiten and the four-week display).
      entries.push(
        {
          key: keys.overrides,
          value: schedule.then(
            (data) =>
              data &&
              seedRead("staff target overrides", async (signal) =>
                (
                  (
                    await readContract(
                      routes["GET /api/staff/{id}/target-overrides"],
                      { token, signal, params },
                    )
                  ).data ?? []
                ).map(mapStaffTargetOverride),
              ),
          ),
        },
        {
          key: keys.preview,
          value: schedule.then(
            (data) =>
              data &&
              seedRead("staff four-week preview", (signal) =>
                loadTargets(preview, signal),
              ),
          ),
        },
      );
      break;
    }
    case "abwesenheiten": {
      const { keys, range, year } = tab;
      entry(
        keys.quota,
        "staff vacation quota",
        async (signal) =>
          (
            await readContract(routes["GET /api/staff/{id}/vacation/quota"], {
              token,
              signal,
              params,
              query: { year },
            })
          ).data,
      );
      entries.push({
        key: keys.absences,
        value: loadAbsences(range).then((rows) =>
          rows?.map(mapStaffAbsenceRow),
        ),
      });
      const types = afterIdentity("absence types", async (signal) =>
        (
          await readContract(
            absenceContract.routes["GET /api/absence-types/"],
            {
              token,
              signal,
            },
          )
        ).data.map(mapAbsenceType),
      );
      entries.push({ key: keys.types, value: types });
      const loadedTypes = await types;
      if (!loadedTypes) break;
      const withAllowance = staffAllowanceTypes(loadedTypes);
      entry(
        staffAllowancesKey(id, year, withAllowance),
        "staff absence allowances",
        (signal) =>
          Promise.all(
            withAllowance.map(async (type) => {
              const { data } = await readContract(
                absenceContract.routes[
                  "GET /api/absence-types/{id}/allowances/{staffId}"
                ],
                {
                  token,
                  signal,
                  params: { id: type.id, staffId: id },
                  query: { year },
                },
              );
              return { type, summary: mapAllowance(data) };
            }),
          ),
      );
      break;
    }
    case "stammdaten": {
      const { keys } = tab;
      entry(keys.payroll, "staff payroll number", async (signal) =>
        mapStaffPayrollNumber(
          (
            await readContract(routes["GET /api/staff/{id}/payroll-number"], {
              token,
              signal,
              params,
            })
          ).data,
        ),
      );
      entry(keys.proofs, "staff Träger proofs", async (signal) =>
        (
          await readContract(routes["GET /api/staff/{id}/traeger-proofs"], {
            token,
            signal,
            params,
          })
        ).data.map(mapTraegerProof),
      );
      // Master data and qualification status ensure standard qualification
      // kinds on read. The masked financial GET writes an access log.
      break;
    }
    case "klassen":
      entry(tab.key, "staff assigned classes", async (signal) => {
        const { data } = await readContract(
          routes["GET /api/staff/{id}/school-classes"],
          { token, signal, params },
        );
        return { classes: data.school_classes ?? [], version: data.version };
      });
      break;
    case "dokumente":
    // The list GET queues retries of pending file cleanup after commit.
    case "konto":
      break;
  }
  return seedOf(snapshot, entries, builtAt);
}
