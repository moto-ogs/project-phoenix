import { ApiError } from "~/lib/api-error";
import type * as contract from "~/lib/contract/parent-me.generated";
import { getFamilyStart, UNKNOWN_CHILD_TODAY } from "~/lib/parent-api";

export interface ParentFamily {
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
  cards: contract.FamilyStartCardResponse[],
  studentId?: string,
): ParentFamily {
  const narrowed = studentId ? previous : undefined;
  const family: ParentFamily = {
    children: narrowed ? [...narrowed.children] : [],
    features: { ...narrowed?.features },
    today: { ...narrowed?.today },
    featureErrors: { ...narrowed?.featureErrors },
    todayErrors: { ...narrowed?.todayErrors },
    confirmedToday: { ...narrowed?.confirmedToday },
    accessVersions: { ...narrowed?.accessVersions },
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
      previous?.accessVersions[id] === accessVersion ? previous : undefined;
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
  updates: Map<string, Promise<contract.FamilyStartCardResponse[]>>;
}
const pending = new WeakMap<ParentFamily, FamilyRead>();

export function narrowNextFamilyRead(family: ParentFamily, studentId: string) {
  nextChild.set(family, studentId);
}

async function readCards(day: string, id?: string) {
  const result = await getFamilyStart(id);
  if (result.day !== day)
    throw new Error("Family start belongs to another Berlin day");
  if (!result.cards) throw new Error("Missing family start cards");
  if (id && result.cards.some((card) => card.child.student_id !== id))
    throw new Error("Unexpected family start child");
  return result.cards;
}

async function reconcileChildren(read: FamilyRead) {
  const [roster, updates] = await Promise.all([
    read.roster,
    Promise.all(
      Array.from(read.updates, async ([id, request]) => {
        try {
          return { id, cards: await request };
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
    if (update.cards) {
      family = applyCards(family, update.cards, update.id);
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

export function readParentFamily(
  previous: ParentFamily | undefined,
  day: string,
) {
  const id = previous && nextChild.get(previous);
  if (previous) nextChild.delete(previous);
  // SWR commits only the newest revalidation. It must include outstanding
  // sibling updates, but never wait for a superseded read of the same child.
  const prior = previous && pending.get(previous);
  let read: FamilyRead;
  let result: Promise<ParentFamily>;
  if (previous && id) {
    const updates = new Map(prior?.updates);
    updates.set(id, readCards(day, id));
    read = { roster: prior?.roster ?? Promise.resolve(previous), updates };
    result = reconcileChildren(read);
  } else {
    result = readCards(day).then((cards) => applyCards(previous, cards));
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
