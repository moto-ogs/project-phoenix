import { isAccessRefusal, isRefusal } from "~/lib/access-refusal";
import { ApiError } from "~/lib/api-error";
import { getFamilyStart } from "~/lib/parent-api";
import {
  FAMILY_FIELD_UNAVAILABLE,
  applyCards,
  familyCards,
  type ParentFamily,
} from "~/lib/parent-family-cards";

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
  return familyCards(await getFamilyStart(id), id);
}

async function reconcileChildren(read: FamilyRead) {
  const [roster, updates] = await Promise.all([
    read.roster,
    Promise.all(
      Array.from(read.updates, async ([id, request]) => {
        try {
          return { id, response: await request };
        } catch (error) {
          // Access decisions belong to the shared refusal boundary. Other
          // failures describe this card, not a successful sibling update.
          if (isRefusal(error) || isAccessRefusal(error)) throw error;
          return {
            id,
            error: error instanceof ApiError ? error : FAMILY_FIELD_UNAVAILABLE,
          };
        }
      }),
    ),
  ]);
  let family = roster;
  for (const update of updates) {
    if (update.response) {
      family = applyCards(family, update.response, update.id);
    } else if (Object.hasOwn(family.accessVersions, update.id)) {
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
    // A full read may be deciding a revocation. Do not obtain a card
    // before that read settles and then apply its older access to the roster.
    const request = prior
      ? prior.roster.then(() => readCards(id))
      : readCards(id);
    updates.set(id, request);
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
