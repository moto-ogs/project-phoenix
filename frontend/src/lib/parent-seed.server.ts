import { headers } from "next/headers";
import { cache } from "react";
import * as parentMeContract from "~/lib/contract/parent-me.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  readPortalSessionSnapshot,
  type PortalSessionSnapshot,
} from "~/lib/portal-session-snapshot.server";
import {
  PARENT_PUBLIC_PAGES,
  isPortalPublicPath,
} from "~/lib/portal-public-pages";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { parentKeys } from "~/lib/swr/parent-keys";
import type { ServerSeed, ServerSeedEntry } from "~/lib/swr/server-seed";

/**
 * The authorized children of the account, once per server render (#8077):
 * the layout's shell seed and the page's seed share this read. The backend
 * answers only the account's live relationships.
 */
const loadChildren = cache((token: string) =>
  seedRead("parentChildren", async (signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/children"],
      { token, signal },
    );
    return response.data;
  }),
);

/**
 * One read per listed relationship, in parallel. The collection counts only
 * complete: when one child's read fails, the whole key stays unseeded and the
 * browser reader loads it with its partial-failure path.
 */
async function perChild<T>(
  name: string,
  children: readonly parentMeContract.ChildResponse[],
  load: (studentId: string, signal: AbortSignal) => Promise<T>,
): Promise<Record<string, T> | undefined> {
  const values = await Promise.all(
    children.map((child) =>
      seedRead(name, (signal) => load(child.student_id, signal)),
    ),
  );
  const result: Record<string, T> = {};
  for (const [index, child] of children.entries()) {
    const value = values[index];
    if (value === undefined) return undefined;
    result[child.student_id] = value;
  }
  return result;
}

const loadFeatures = cache(async (token: string) => {
  const children = await loadChildren(token);
  if (!children) return undefined;
  return perChild("parentFeatures", children, async (studentId, signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/children/{studentId}/features"],
      { token, signal, params: { studentId } },
    );
    return response.data;
  });
});

// The browser shows a 403/404 as "unknown" and handles the refusal; the
// server seeds only answered states and leaves every failure to it.
const loadToday = cache(async (token: string) => {
  const children = await loadChildren(token);
  if (!children) return undefined;
  return perChild("parentToday", children, async (studentId, signal) => {
    const response = await readContract(
      parentMeContract.routes["GET /parent/me/children/{studentId}/today"],
      { token, signal, params: { studentId } },
    );
    return response.data;
  });
});

/** A parent snapshot that may carry personal data, else null. */
async function parentSnapshot(): Promise<PortalSessionSnapshot | null> {
  const snapshot = await readPortalSessionSnapshot("parent");
  if (
    !snapshot ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "parent"
  ) {
    return null;
  }
  return snapshot;
}

/**
 * The page the browser asked for, as the proxy recorded it (it overwrites
 * any value the client sent), without the query.
 */
export async function parentRequestPath(): Promise<string | null> {
  const original = (await headers()).get("x-moto-original-path");
  if (!original) return null;
  return original.split("?")[0] ?? null;
}

/** Whether the shell may carry personal data on this path. */
export function isProtectedParentPath(path: string | null): path is string {
  return (
    path !== null && !isPortalPublicPath("parent", PARENT_PUBLIC_PAGES, path)
  );
}

/**
 * What a parents seed carries besides the children list, and whether the
 * server render waits for it (`render`).
 */
interface ParentSeedPlan {
  readonly renderChildren: boolean;
  readonly features?: { readonly render: boolean };
  readonly today?: { readonly render: boolean };
  /** The child of the URL; details only when the list names it. */
  readonly studentId?: string;
}

async function parentSeed(
  snapshot: PortalSessionSnapshot,
  builtAt: number,
  plan: ParentSeedPlan,
): Promise<ServerSeed | null> {
  const token = snapshot.accessToken;
  const childrenValue = loadChildren(token);
  const entries: ServerSeedEntry[] = [
    {
      key: parentKeys.shellChildren(),
      value: childrenValue,
      render: plan.renderChildren,
    },
  ];
  const children = await childrenValue;
  // The URL is no permission: for a child the list does not name, nothing
  // beyond the list is read.
  const known =
    plan.studentId === undefined ||
    children?.some((child) => child.student_id === plan.studentId) === true;
  if (children && known) {
    const day = berlinTodayISO();
    if (plan.features) {
      entries.push({
        key: parentKeys.features(children, day),
        value: loadFeatures(token),
        render: plan.features.render,
      });
    }
    if (plan.today) {
      entries.push({
        key: parentKeys.today(children, day),
        value: loadToday(token),
        render: plan.today.render,
      });
    }
  }
  return seedOf(snapshot, entries, builtAt);
}

/**
 * The seed of the protected parents shell: the children list and the
 * features the navigation reads. The layout calls it only for a protected
 * path (isProtectedParentPath); the shell does not wait for it.
 */
export async function loadParentShellSeed(): Promise<ServerSeed | null> {
  const builtAt = Date.now();
  const snapshot = await parentSnapshot();
  if (!snapshot) return null;
  return parentSeed(snapshot, builtAt, {
    renderChildren: false,
    features: { render: false },
  });
}

/**
 * The seed of the start page (children, features and today's status, shown
 * in the server HTML) or a child page (children and today's status; no
 * detail of a child the list does not name).
 */
export async function loadParentPageSeed(
  page: { kind: "start" } | { kind: "child"; studentId: string },
): Promise<ServerSeed | null> {
  const builtAt = Date.now();
  const snapshot = await parentSnapshot();
  if (!snapshot) return null;
  // The start page shows its child cards only with all three; the child
  // page waits for the list alone, as its loading state does.
  return page.kind === "start"
    ? parentSeed(snapshot, builtAt, {
        renderChildren: true,
        features: { render: true },
        today: { render: true },
      })
    : parentSeed(snapshot, builtAt, {
        renderChildren: true,
        features: { render: false },
        today: { render: false },
        studentId: page.studentId,
      });
}
