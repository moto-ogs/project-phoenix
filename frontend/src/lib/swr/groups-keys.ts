import { SWR_FAMILIES } from "./shell-keys";
import { resourceKey } from "./resource-key";
export type GroupFilters = {
  page?: number;
  pageSize?: number;
};
export const groupKeys = {
  family: SWR_FAMILIES.groups,
  /** Prefix of every group's live student list; SSE invalidates by it. */
  liveFamily: "ogs-students-",
  live: (id: string | null) => `ogs-students-${id ?? "auto"}`,
  key: (params: GroupFilters = {}) => resourceKey("groups-list-", params),
  /** The named groups, each read on its own (any number, no list page). */
  byIds: (ids: readonly string[]) =>
    resourceKey("groups-by-id-", { ids: [...ids].sort() }),
} as const;
