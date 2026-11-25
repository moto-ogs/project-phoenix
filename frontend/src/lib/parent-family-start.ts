import { isValidISODate } from "~/lib/date-helpers";
import { ApiError } from "~/lib/api-error";
import type * as contract from "~/lib/contract/parent-me.generated";
import { getFamilyStart, UNKNOWN_CHILD_TODAY } from "~/lib/parent-api";

export interface ParentFamily {
  day: string;
  needsDayReconciliation: boolean;
  children: contract.ChildResponse[];
  features: Record<string, contract.ChildFeaturesResponse>;
  today: Record<string, contract.TodayStatusResponse>;
  featureErrors: Record<string, Error>;
  todayErrors: Record<string, Error>;
  confirmedToday: Record<string, boolean>;
  accessVersions: Record<string, string>;
}

const unavailable = new ApiError("Family start data unavailable", 503, {
  code: "general.unavailable",
});

function applyCards(
  previous: ParentFamily | undefined,
  response: Awaited<ReturnType<typeof readCards>>,
  studentId?: string,
): ParentFamily {
  const { day, cards } = response;
  const roster = studentId ? previous : undefined;
  const narrowed = roster?.day === day ? roster : undefined;
  const family: ParentFamily = {
    day,
    needsDayReconciliation:
      !!roster && (roster.day !== day || roster.needsDayReconciliation),
    children: roster ? [...roster.children] : [],
    features: { ...narrowed?.features },
    today: { ...narrowed?.today },
    featureErrors: { ...narrowed?.featureErrors },
    todayErrors: { ...narrowed?.todayErrors },
    confirmedToday: { ...narrowed?.confirmedToday },
    accessVersions: { ...roster?.accessVersions },
  };
  if (studentId) {
    delete family.features[studentId];
    delete family.today[studentId];
    delete family.featureErrors[studentId];
    delete family.todayErrors[studentId];
    delete family.confirmedToday[studentId];
    delete family.accessVersions[studentId];
    if (!cards.length)
      family.children = family.children.filter(
        (c) => c.student_id !== studentId,
      );
  }
  for (const card of cards) {
    const child = card.child;
    const id = child.student_id;
    const index = studentId
      ? family.children.findIndex((c) => c.student_id === id)
      : -1;
    if (index < 0) family.children.push(child);
    else family.children[index] = child;
    const accessVersion = [
      child.tenant_id,
      child.care_ended,
      child.without_care_place,
      card.access_version,
    ].join(":");
    const known =
      previous?.day === day && previous.accessVersions[id] === accessVersion
        ? previous
        : undefined;
    family.accessVersions[id] = accessVersion;
    const flags = card.features ?? known?.features[id];
    if (flags) family.features[id] = flags;
    family.today[id] = card.today ?? known?.today[id] ?? UNKNOWN_CHILD_TODAY;
    if (!card.features) family.featureErrors[id] = unavailable;
    if (!card.today) family.todayErrors[id] = unavailable;
    family.confirmedToday[id] = Boolean(
      card.today || known?.confirmedToday[id],
    );
  }
  return family;
}

// A refresh is carried by SWR's normal revalidation, including its generation
// and refusal guards. Key transient work by the protected snapshot, not by
// account ID: logout, midnight or a discard cannot inherit an old request.
const nextChild = new WeakMap<ParentFamily, string>();
interface FamilyRead {
  roster: Promise<ParentFamily>;
  updates: Map<string, ReturnType<typeof readCards>>;
}
const pending = new WeakMap<ParentFamily, FamilyRead>();

export function narrowNextFamilyRead(family: ParentFamily, studentId: string) {
  nextChild.set(family, studentId);
}

async function readCards(id?: string) {
  const result = await getFamilyStart(id);
  if (!result.day || !isValidISODate(result.day))
    throw new Error("Missing or invalid family start day");
  if (!result.cards) throw new Error("Missing family start cards");
  if (id && result.cards.some((card) => card.child.student_id !== id))
    throw new Error("Unexpected family start child");
  return { day: result.day, cards: result.cards };
}

async function reconcileChildren(read: FamilyRead) {
  const [roster, updates] = await Promise.all([
    read.roster,
    Promise.all(
      Array.from(read.updates, async ([id, request]) => {
        try {
          return { id, response: await request };
        } catch (error) {
          if (!(error instanceof ApiError) || (error.status ?? 0) < 500)
            throw error;
          return { id, error };
        }
      }),
    ),
  ]);
  let family = roster;
  for (const update of updates) {
    if (update.response) {
      family = applyCards(family, update.response, update.id);
    } else {
      // The server did not confirm a removal. Preserve the last confirmed
      // card and report the failure without dropping a successful sibling.
      family = {
        ...family,
        featureErrors: { ...family.featureErrors, [update.id]: update.error },
        todayErrors: { ...family.todayErrors, [update.id]: update.error },
      };
    }
  }
  return family;
}

async function readFullFamily(previous: ParentFamily | undefined) {
  return applyCards(previous, await readCards());
}

export function readParentFamily(previous: ParentFamily | undefined) {
  const id = previous && nextChild.get(previous);
  if (previous) nextChild.delete(previous);
  // SWR commits only the newest revalidation. It must include outstanding
  // sibling updates, but never wait for a superseded read of the same child.
  const prior = previous && pending.get(previous);
  let read: FamilyRead;
  let result: Promise<ParentFamily>;
  if (previous && id) {
    const updates = new Map(prior?.updates);
    updates.set(id, readCards(id));
    read = { roster: prior?.roster ?? Promise.resolve(previous), updates };
    result = reconcileChildren(read);
  } else {
    result = readFullFamily(previous);
    read = { roster: result, updates: new Map() };
  }
  if (previous) {
    pending.set(previous, read);
    const release = () => {
      if (pending.get(previous) === read) pending.delete(previous);
    };
    void result.then(release, release);
  }
  return result;
}
