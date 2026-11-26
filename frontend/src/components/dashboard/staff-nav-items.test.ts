import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_SUB_PAGES,
  PARENT_SUB_PAGES,
  STAFF_FLAT_PAGES,
} from "~/lib/section-navigation";
import { PLANNING_SUB_PAGES } from "~/lib/planning-navigation";
import {
  STAFF_NAV_BOTTOM,
  STAFF_NAV_CONCEPTS,
  STAFF_NAV_GROUPS,
  STAFF_NAV_TOP,
} from "~/lib/staff-navigation";
import {
  STAFF_NAV_BINARY_HIDDEN_HREFS,
  STAFF_NAV_ITEMS,
  STAFF_NAV_ITEMS_BY_HREF,
  staffNavBorrowedActiveHref,
  staffNavItemPermitted,
  staffNavPageState,
  staffNavPathActive,
  staffNavSettingOn,
  type StaffNavItem,
  type StaffNavPageInputs,
  type StaffNavPageRules,
} from "./staff-nav-items";

// Seitenleiste und mobile Leiste lesen ihre Seiten aus einer Liste (#6580).

const CATALOG_HREFS = new Set(
  [...PARENT_SUB_PAGES, ...COMMUNICATION_SUB_PAGES, ...PLANNING_SUB_PAGES].map(
    (page) => page.href,
  ),
);

const TREE_PAGE_HREFS = [
  ...STAFF_NAV_TOP,
  ...STAFF_NAV_GROUPS.flatMap((group) => group.entries),
  ...STAFF_NAV_BOTTOM,
].flatMap((entry) => (entry.kind === "page" ? [entry.href] : []));

function session(permissions: string[]): Session {
  return {
    user: { id: "1", permissions },
    expires: "2099-01-01",
  } as unknown as Session;
}

const STAFF = {
  isAdmin: false,
  isCaregiver: true,
  openCareGroupMode: false,
  hasOwnStaff: true,
};

describe("staff navigation items (#6580)", () => {
  it("lists every page of the tree once, here or in a catalog with an image", () => {
    for (const href of TREE_PAGE_HREFS) {
      const inList = STAFF_NAV_ITEMS_BY_HREF.has(href);
      const inCatalog = CATALOG_HREFS.has(href);
      expect({ href, sources: Number(inList) + Number(inCatalog) }).toEqual({
        href,
        sources: 1,
      });
      if (inCatalog) expect(STAFF_NAV_CONCEPTS[href]).toBeDefined();
    }
  });

  it("has no entry outside the tree and no href twice", () => {
    const hrefs = STAFF_NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.filter((href) => !TREE_PAGE_HREFS.includes(href))).toEqual([]);
  });

  it("hides the room and visit pages in binary mode", () => {
    expect([...STAFF_NAV_BINARY_HIDDEN_HREFS].sort()).toEqual(
      ["/activities", "/rooms", "/tagesplan"].sort(),
    );
  });

  // #8134: der Plan steht im Tagesbetrieb für das ganze Team. Lesen darf
  // ihn, wer den Plan und das Team sieht; planen bleibt bei schedules:manage
  // und entscheidet die Seite (Leseansicht, #2283).
  describe("Betreuungsplan (#8134)", () => {
    const carePlan = STAFF_NAV_ITEMS_BY_HREF.get("/betreuungsplan")!;
    const permitted = (permissions: string[], isAdmin = false) =>
      staffNavItemPermitted(carePlan, {
        ...STAFF,
        isAdmin,
        session: session(permissions),
      });

    it("opens for the team with schedules:read and users:read, without schedules:manage", () => {
      expect(permitted(["schedules:read", "users:read"])).toBe(true);
    });

    // Bis #8134 hing der Eintrag allein an schedules:manage; eine
    // Leitungsrolle der Schule (#3469) verliert ihn nicht.
    it("stays open for whoever plans, with schedules:manage alone", () => {
      expect(permitted(["schedules:manage"])).toBe(true);
    });

    it("stays away from the AG-Leitung, who holds schedules:read alone (ADR 0091)", () => {
      expect(permitted(["schedules:read"])).toBe(false);
      expect(permitted(["users:read"])).toBe(false);
    });

    it("opens for the admin role and follows only the school switch, not binary mode", () => {
      expect(permitted([], true)).toBe(true);
      expect(carePlan.setting).toBe("timetable");
      expect(STAFF_NAV_BINARY_HIDDEN_HREFS.has(carePlan.href)).toBe(false);
    });

    it("carries the calendar, today the clock", () => {
      const today = STAFF_NAV_ITEMS_BY_HREF.get("/tagesplan")!;
      expect(carePlan.concept.icon).not.toBe(today.concept.icon);
    });
  });

  describe("staffNavItemPermitted", () => {
    const item = (fields: Partial<StaffNavItem>): StaffNavItem => ({
      href: "/x",
      label: "X",
      concept: STAFF_NAV_ITEMS[0]!.concept,
      ...fields,
    });

    it("needs one of the listed permissions", () => {
      const rooms = item({ requiresPermission: ["rooms:read", "x:y"] });
      expect(
        staffNavItemPermitted(rooms, { ...STAFF, session: session([]) }),
      ).toBe(false);
      expect(
        staffNavItemPermitted(rooms, {
          ...STAFF,
          session: session(["rooms:read"]),
        }),
      ).toBe(true);
    });

    it("needs all permissions of requiresAllPermissions", () => {
      const statistics = item({
        requiresAllPermissions: ["config:read", "users:read"],
      });
      expect(
        staffNavItemPermitted(statistics, {
          ...STAFF,
          session: session(["config:read"]),
        }),
      ).toBe(false);
      expect(
        staffNavItemPermitted(statistics, {
          ...STAFF,
          session: session(["config:read", "users:read"]),
        }),
      ).toBe(true);
    });

    it("keeps admin-only pages from others, opens open-care pages by their permission", () => {
      const planning = item({
        requiresPermission: "groups:manage",
        openCarePermission: "groups:update",
      });
      const viewer = { ...STAFF, session: session(["groups:update"]) };
      expect(staffNavItemPermitted(planning, viewer)).toBe(false);
      expect(
        staffNavItemPermitted(planning, { ...viewer, openCareGroupMode: true }),
      ).toBe(true);
      expect(
        staffNavItemPermitted(item({ requiresAdmin: true }), {
          ...viewer,
          openCareGroupMode: true,
        }),
      ).toBe(false);
    });

    it("lets admins pass but hides caregiver entries from them", () => {
      const admin = {
        isAdmin: true,
        isCaregiver: false,
        openCareGroupMode: false,
        hasOwnStaff: true,
        session: session([]),
      };
      expect(
        staffNavItemPermitted(item({ requiresPermission: "x:y" }), admin),
      ).toBe(true);
      expect(
        staffNavItemPermitted(
          item({ requiresPermission: "x:y", hideForAdmin: true }),
          admin,
        ),
      ).toBe(false);
      expect(
        staffNavItemPermitted(
          item({ requiresPermission: "x:y", hideForAdmin: true }),
          { ...admin, isCaregiver: true },
        ),
      ).toBe(true);
    });

    it("hides own-data pages without a staff profile, also from admins (#7306)", () => {
      const own = item({
        requiresPermission: "time_tracking:own",
        requiresOwnStaff: true,
      });
      const admin = {
        isAdmin: true,
        isCaregiver: false,
        openCareGroupMode: false,
        hasOwnStaff: false,
        session: session([]),
      };
      expect(staffNavItemPermitted(own, admin)).toBe(false);
      expect(staffNavItemPermitted(own, { ...admin, hasOwnStaff: true })).toBe(
        true,
      );
      expect(
        staffNavItemPermitted(own, {
          ...STAFF,
          hasOwnStaff: false,
          session: session(["time_tracking:own"]),
        }),
      ).toBe(false);
      // Pages without own data stay for an admin without a profile.
      expect(
        staffNavItemPermitted(item({ requiresPermission: "x:y" }), admin),
      ).toBe(true);
    });

    it("marks exactly the three own-data pages", () => {
      expect(
        STAFF_NAV_ITEMS.filter((entry) => entry.requiresOwnStaff)
          .map((entry) => entry.href)
          .sort(),
      ).toEqual(["/calendar", "/mein-dienstplan", "/time-tracking"]);
    });
  });

  it("drops a page whose school setting is off", () => {
    const dayLog = STAFF_NAV_ITEMS_BY_HREF.get(STAFF_FLAT_PAGES.dayLog.href)!;
    const all = { timetable: true, display: true, attendanceLog: true };
    expect(staffNavSettingOn(dayLog, all)).toBe(true);
    expect(staffNavSettingOn(dayLog, { ...all, attendanceLog: false })).toBe(
      false,
    );
    expect(staffNavSettingOn({}, { ...all, attendanceLog: false })).toBe(true);
  });

  it("does not let /calendar light up on /calendar-periods", () => {
    expect(staffNavPathActive("/calendar", "/calendar")).toBe(true);
    expect(staffNavPathActive("/calendar", "/calendar/3")).toBe(true);
    expect(staffNavPathActive("/calendar", "/calendar-periods")).toBe(false);
    expect(staffNavPathActive("/rooms", "/rooms/5")).toBe(true);
  });

  it("names the entry that marks a borrowed page", () => {
    expect(staffNavBorrowedActiveHref("/active-supervisions", null, true)).toBe(
      "/rooms",
    );
    expect(
      staffNavBorrowedActiveHref("/rooms/unterwegs", "/students/search", false),
    ).toBe("/students/search");
    expect(
      staffNavBorrowedActiveHref("/rooms/unterwegs", "/rooms", false),
    ).toBeNull();
  });
});

describe("staffNavPageState: one rule for sidebar and mobile navigation", () => {
  const SIDEBAR: StaffNavPageRules = {
    tagesplanRouteRightForAdmins: false,
    staffNoticesOpenForAdminRole: false,
    loadSchoolSwitches: true,
  };
  const MOBILE: StaffNavPageRules = {
    tagesplanRouteRightForAdmins: true,
    staffNoticesOpenForAdminRole: true,
    loadSchoolSwitches: true,
  };

  function inputs(
    overrides: Partial<StaffNavPageInputs> = {},
  ): StaffNavPageInputs {
    return {
      viewer: { session: session([]), ...STAFF },
      modulePage: () => "open",
      isBinaryMode: false,
      settings: { timetable: true, display: true, attendanceLog: true },
      canOpenRequestsPage: false,
      staffMessagingEnabled: true,
      parentNewsEnabled: true,
      mealPlanEnabled: true,
      ...overrides,
    };
  }

  it("shows a page of an unbooked module locked, whatever the right", () => {
    const state = staffNavPageState(
      "/meal-plan",
      inputs({ modulePage: () => "locked", mealPlanEnabled: false }),
      SIDEBAR,
    );
    expect(state).toBe("locked");
    expect(
      staffNavPageState(
        "/meal-plan",
        inputs({ modulePage: () => "hidden" }),
        SIDEBAR,
      ),
    ).toBeNull();
  });

  it("needs right and school switch for an open catalog page", () => {
    const canAnnounce = { session: session(["admin:*"]), ...STAFF };
    expect(
      staffNavPageState(
        "/parent-announcements",
        inputs({ viewer: canAnnounce }),
        SIDEBAR,
      ),
    ).toBe("open");
    expect(
      staffNavPageState(
        "/parent-announcements",
        inputs({ viewer: canAnnounce, parentNewsEnabled: false }),
        SIDEBAR,
      ),
    ).toBeNull();
    expect(
      staffNavPageState("/parent-announcements", inputs(), SIDEBAR),
    ).toBeNull();
    expect(
      staffNavPageState(
        "/team-chat",
        inputs({ staffMessagingEnabled: false }),
        SIDEBAR,
      ),
    ).toBeNull();
  });

  it("drops binary-hidden pages without a lock and unknown addresses", () => {
    expect(
      staffNavPageState(
        "/activities",
        inputs({ isBinaryMode: true, modulePage: () => "locked" }),
        SIDEBAR,
      ),
    ).toBeNull();
    expect(staffNavPageState("/nirgends", inputs(), SIDEBAR)).toBeNull();
  });

  it("keeps the two surfaces' differing rules for the admin role (#6708)", () => {
    const admin = {
      session: session([]),
      isAdmin: true,
      isCaregiver: true,
      openCareGroupMode: false,
      hasOwnStaff: true,
    };
    expect(
      staffNavPageState("/tagesplan", inputs({ viewer: admin }), SIDEBAR),
    ).toBe("open");
    expect(
      staffNavPageState("/tagesplan", inputs({ viewer: admin }), MOBILE),
    ).toBeNull();
    expect(
      staffNavPageState(
        "/tagesinformationen",
        inputs({ viewer: admin }),
        SIDEBAR,
      ),
    ).toBeNull();
    expect(
      staffNavPageState(
        "/tagesinformationen",
        inputs({ viewer: admin }),
        MOBILE,
      ),
    ).toBe("open");
  });
});
