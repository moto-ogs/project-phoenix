import { describe, expect, it, vi } from "vitest";

import { GET } from "~/app/help/search-index/route";
import { HELP_TOPICS } from "~/lib/help-topics";

import { matchEntries } from "./school-search-catalog";
import { helpSearchEntries } from "./school-search-help";

const CONTEXT = {
  role: "caregiver",
  nfcEnabled: false,
  presenceMode: "detailed",
  groupMode: "fixed_groups",
  returnTo: "/home",
} as const;

describe("helpSearchEntries", () => {
  it("finds the role's articles from the small index and links them with the context", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => GET());
    const entries = await helpSearchEntries(CONTEXT);

    const [vacation] = matchEntries(entries, "urlaub beantragen");
    expect(vacation?.href).toMatch(
      new RegExp(`^/help/${HELP_TOPICS.vacation}\\?role=caregiver&`),
    );
    expect(vacation?.newTab).toBe(true);
    // A lead article and an NFC article stay out for a caregiver without NFC.
    const ids = entries.map((entry) => entry.id);
    expect(ids).not.toContain(`help-${HELP_TOPICS.leadGroups}`);
    expect(ids).not.toContain(`help-${HELP_TOPICS.tabletLogin}`);

    // The index loads once per page, not on every open.
    await helpSearchEntries({ ...CONTEXT, role: "lead" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/help/search-index");
    fetchSpy.mockRestore();
  });
});
