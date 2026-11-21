import { groupService } from "~/lib/api";
import { groupKeys, type GroupFilters } from "./groups-keys";
export const groups = {
  ...groupKeys,
  fetcher: (params: GroupFilters = {}) => groupService.getGroups(params),
  /**
   * The school's groups as select options, sorted by name: the one fetcher of
   * `tenantAdminKeys.groupOptions()`, so every reader of that cache entry
   * gets the same answer and a failure stays a failure.
   */
  async optionsFetcher(): Promise<Array<{ value: string; label: string }>> {
    const list = await groupService.getGroups();
    return list
      .map((group) => ({ value: String(group.id), label: group.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  },
} as const;
