import type { Pagination } from "~/lib/contract/runtime";
import type { OrgAccount, SchoolAccount } from "./provisioning-helpers";

export type AccountScope =
  { kind: "all" } | { kind: "school" | "organization"; id: string };

export interface AccountSort {
  key: string;
  direction: "asc" | "desc";
}

export interface AccountPageQuery {
  sort?: string;
  direction?: "asc" | "desc";
  search?: string;
  cursor?: string;
}

export interface AccountPage {
  rows: (SchoolAccount | OrgAccount)[];
  total: number;
  cursor?: string;
}

export function defaultAccountSort(scope: AccountScope): AccountSort {
  return {
    key: scope.kind === "school" ? "name" : "schoolName",
    direction: "asc",
  };
}

export function initialAccountQuery(scope: AccountScope): AccountPageQuery {
  const { key, direction } = defaultAccountSort(scope);
  return { sort: key, direction };
}

export function accountPage(
  rows: AccountPage["rows"],
  pagination: Pagination,
): AccountPage {
  return {
    rows,
    total: pagination.total_records,
    cursor: pagination.next_cursor,
  };
}
