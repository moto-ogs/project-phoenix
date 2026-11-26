import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { useSWRAuth } from "~/lib/swr";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import type {
  AccountPage,
  AccountPageQuery,
  AccountScope,
  AccountSort,
} from "~/lib/operator/account-pages";
import type {
  OperatorPerson,
  OrganizationSummary,
  SchoolSummary,
} from "~/lib/operator/provisioning-helpers";
import AccountsPage from "./accounts/page-content";
import DevicesPage from "./devices/page-content";
import PersonsPage from "./persons/page-content";
import TagsPage from "./unregistered-tags/page-content";
import OrganizationPage from "./organizations/[slug]/page-content";
import SchoolPage from "./organizations/[slug]/schools/[schoolSlug]/page-content";

vi.unmock("swr");
const { state, api } = vi.hoisted(() => ({
  state: { query: "schoolId=10", account: "account-a", replace: vi.fn() },
  api: {
    listOrganizations: vi.fn(),
    listSchools: vi.fn(),
    listAccountPage: vi.fn(),
    listSchoolDevices: vi.fn(),
    listAllDevices: vi.fn(),
    listOrganizationDevices: vi.fn(),
    listSchoolPersons: vi.fn(),
    listUnregisteredTagScans: vi.fn(),
    listOrganizationSummaries: vi.fn(),
    listSchoolSummaries: vi.fn(),
    listOrganizationSchools: vi.fn(),
    getSchoolPWAUsage: vi.fn(),
  },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: state.account, scope: "platform" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantRoutingModeSafe: () => "path",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => "/operator/accounts",
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
}));
vi.mock("~/lib/breadcrumb-context", () => ({ useSetBreadcrumb: vi.fn() }));
vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: api,
}));
vi.mock("~/components/operator/accounts-table", () => ({
  AccountsTable: ({
    accounts,
    moreAction,
    serverSort,
    onManageTenantAccess,
  }: {
    accounts: AccountPage["rows"];
    moreAction?: { label: string; onClick: () => void; loading?: boolean };
    serverSort: { onChange: (sort: AccountSort) => void };
    onManageTenantAccess?: (account: object) => void;
  }) => (
    <>
      {accounts.map((account) => (
        <p key={account.accountId}>{account.email}</p>
      ))}
      <button
        type="button"
        onClick={() => serverSort.onChange({ key: "email", direction: "desc" })}
      >
        Nach E-Mail sortieren
      </button>
      {moreAction && (
        <button
          type="button"
          disabled={moreAction.loading}
          onClick={moreAction.onClick}
        >
          {moreAction.label}
        </button>
      )}
      <button
        onClick={() =>
          onManageTenantAccess?.({
            accountId: "1",
            firstName: "Test",
            lastName: "Person",
            email: "person@example.test",
          })
        }
      >
        Zugang ändern
      </button>
    </>
  ),
}));
vi.mock("~/components/operator/account-tenant-access-modal", () => ({
  AccountTenantAccessModal: ({
    onUpdated,
  }: {
    onUpdated: () => Promise<void>;
  }) => <button onClick={() => void onUpdated()}>Zugang speichern</button>,
}));

// Exercise the page's post-success callbacks, with the real SWR readers and invalidators.
vi.mock("~/components/operator/staff-person-merge", () => ({
  StaffPersonMerge: ({ onMerged }: { onMerged: () => Promise<unknown> }) => (
    <button onClick={() => void onMerged()}>Zusammenführen bestätigen</button>
  ),
}));
vi.mock("~/components/operator/delete-person-modal", () => ({
  DeletePersonModal: ({
    person,
    onDeleted,
  }: {
    person: OperatorPerson | null;
    onDeleted: (person: OperatorPerson) => Promise<void>;
  }) =>
    person ? (
      <button onClick={() => void onDeleted(person)}>Löschen bestätigen</button>
    ) : null,
}));

const org: OrganizationSummary = {
  version: "v-1",
  id: "1",
  name: "Träger A",
  slug: "org-a",
  active: true,
  testSystem: false,
  deletedAt: null,
  createdAt: "2026-09-09T10:00:00Z",
  updatedAt: "2026-09-09T10:00:00Z",
  schulenCount: 1,
  kontenCount: 1,
  geraeteCount: 0,
  personenCount: 0,
};
const school: SchoolSummary = {
  version: "v-1",
  id: "10",
  organizationId: "1",
  organizationName: org.name,
  name: "Schule A",
  slug: "school-a",
  subdomain: "school-a",
  active: true,
  hidden: false,
  deletedAt: null,
  createdAt: org.createdAt,
  updatedAt: org.updatedAt,
  address: "",
  city: "",
  zip: "",
  phone: "",
  email: "school@example.test",
  kontenCount: 1,
  geraeteCount: 0,
  personenCount: 0,
  childQuotaBundles: null,
  childQuotaBundleSize: 50,
  childQuotaCount: 1,
  deviceSlots: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function renderPage(children: React.ReactNode) {
  const cache = new Map();
  const frame = (content: React.ReactNode) => (
    <SWRConfig value={{ provider: () => cache }}>
      <ToastProvider>
        <SWRScopeBoundary />
        {content}
      </ToastProvider>
    </SWRConfig>
  );
  const view = render(frame(children));
  return { ...view, rerenderPage: () => view.rerender(frame(children)), cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.query = "schoolId=10";
  state.account = "account-a";
  api.listOrganizations.mockResolvedValue([org]);
  api.listSchools.mockResolvedValue([{ ...school, organization: org }]);
  api.listAccountPage.mockResolvedValue({ rows: [], total: 0 });
  api.listSchoolDevices.mockResolvedValue([]);
  api.listSchoolPersons.mockResolvedValue([]);
  api.listUnregisteredTagScans.mockResolvedValue([]);
  api.listOrganizationSummaries.mockResolvedValue([org]);
  api.listSchoolSummaries.mockResolvedValue([school]);
  api.listOrganizationSchools.mockResolvedValue([school]);
  api.getSchoolPWAUsage.mockResolvedValue({
    windowDays: 30,
    staff: { standaloneUsers: 0, eligibleUsers: 0 },
    parent: { standaloneUsers: 0, eligibleUsers: 0 },
  });
});

const accountPage = (name: string, cursor?: string): AccountPage => ({
  rows: [
    {
      accountId: name,
      email: `${name}@example.test`,
      active: true,
      firstName: "",
      lastName: "",
      roleName: "",
      pedagogicRole: "",
      status: "active",
      hasAdminRole: false,
      hasUserRole: false,
      hasCaregiverProfile: false,
      isActiveCaregiver: false,
    },
  ],
  total: cursor ? 101 : 1,
  cursor,
});

describe("operator account pagination with real SWR", () => {
  it.each(["sort", "search", "school", "account"] as const)(
    "discards displayed and in-flight pages after a %s change",
    async (change) => {
      const late = deferred<AccountPage>();
      const otherSchool = { ...school, id: "20", name: "Schule B" };
      api.listSchools.mockResolvedValue([
        { ...school, organization: org },
        { ...otherSchool, organization: org },
      ]);
      api.listAccountPage.mockImplementation(
        (scope: AccountScope, query: AccountPageQuery) => {
          if (query.cursor === "second")
            return Promise.resolve(accountPage("second", "third"));
          if (query.cursor === "third") return late.promise;
          const changed =
            (scope.kind === "school" && scope.id === otherSchool.id) ||
            query.sort === "email" ||
            Boolean(query.search) ||
            state.account !== "account-a";
          return Promise.resolve(
            changed ? accountPage("fresh") : accountPage("first", "second"),
          );
        },
      );
      const view = renderPage(<AccountsPage />);
      expect(await screen.findByText("first@example.test")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Mehr laden" }));
      expect(await screen.findByText("second@example.test")).toBeVisible();
      expect(screen.getByText("first@example.test")).toBeVisible();
      expect(api.listAccountPage).toHaveBeenLastCalledWith(
        { kind: "school", id: "10" },
        { sort: "name", direction: "asc", search: "", cursor: "second" },
      );

      fireEvent.click(screen.getByRole("button", { name: "Mehr laden" }));
      expect(screen.getByRole("button", { name: "Mehr laden" })).toBeDisabled();
      switch (change) {
        case "sort":
          fireEvent.click(
            screen.getByRole("button", { name: "Nach E-Mail sortieren" }),
          );
          break;
        case "search":
          fireEvent.change(screen.getByRole("searchbox"), {
            target: { value: "fresh" },
          });
          expect(
            screen.queryByText("second@example.test"),
          ).not.toBeInTheDocument();
          expect(
            screen.queryByRole("button", { name: "Mehr laden" }),
          ).not.toBeInTheDocument();
          break;
        case "school":
          state.query = "schoolId=20";
          view.rerenderPage();
          break;
        case "account":
          state.account = "account-b";
          view.rerenderPage();
          break;
      }
      expect(await screen.findByText("fresh@example.test")).toBeVisible();
      await act(async () => late.resolve(accountPage("third")));
      expect(screen.getByText("fresh@example.test")).toBeVisible();
      expect(screen.queryByText("first@example.test")).not.toBeInTheDocument();
      expect(screen.queryByText("second@example.test")).not.toBeInTheDocument();
      expect(screen.queryByText("third@example.test")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Mehr laden" }),
      ).not.toBeInTheDocument();
    },
  );

  it("restarts at page one when retrying a failed continuation", async () => {
    api.listAccountPage
      .mockResolvedValueOnce(accountPage("first", "second"))
      .mockRejectedValueOnce(new ApiError("down", 503))
      .mockResolvedValueOnce(accountPage("reloaded"));

    renderPage(<AccountsPage />);
    expect(await screen.findByText("first@example.test")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mehr laden" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      catalogText("general.unavailable", "die Liste der Konten"),
    );
    expect(screen.getByText("first@example.test")).toBeVisible();
    fireEvent.click(within(alert).getByRole("button", { name: "Wiederholen" }));

    expect(await screen.findByText("reloaded@example.test")).toBeVisible();
    expect(api.listAccountPage).toHaveBeenLastCalledWith(
      { kind: "school", id: "10" },
      { sort: "name", direction: "asc", search: "" },
    );
    expect(screen.queryByText("first@example.test")).not.toBeInTheDocument();
  });
});

describe("operator reads with real SWR", () => {
  it.each([
    ["accounts", AccountsPage, api.listAccountPage],
    ["devices", DevicesPage, api.listSchoolDevices],
    ["persons", PersonsPage, api.listSchoolPersons],
    ["RFID", TagsPage, api.listUnregisteredTagScans],
  ] as const)(
    "starts %s from the URL before school options arrive",
    async (_name, Page, read) => {
      api.listSchools.mockReturnValue(new Promise(() => undefined));
      renderPage(<Page />);
      await waitFor(() => {
        if (_name === "accounts") {
          expect(read).toHaveBeenCalledWith(
            { kind: "school", id: "10" },
            { sort: "name", direction: "asc", search: "" },
          );
        } else if (_name === "RFID") {
          expect(read).toHaveBeenCalledWith({
            organizationId: undefined,
            schoolId: "10",
            resolved: "unresolved",
          });
        } else {
          expect(read).toHaveBeenCalledWith("10");
        }
      });
    },
  );

  describe.each([
    ["accounts", AccountsPage, api.listAccountPage, "die Liste der Konten"],
    ["devices", DevicesPage, api.listSchoolDevices, "die Liste der Geräte"],
  ] as const)("%s load failures", (_name, Page, read, object) => {
    it.each(["pending", "failed"])(
      "shows the active school request error and retries while school options are %s",
      async (optionsState) => {
        if (optionsState === "pending") {
          api.listSchools.mockReturnValue(new Promise(() => undefined));
        } else {
          state.query = "orgId=1&schoolId=10";
          api.listSchools.mockRejectedValue(new ApiError("down", 503));
        }
        read.mockRejectedValueOnce(new ApiError("down", 503));
        renderPage(<Page />);

        const message = await screen.findByText(
          catalogText("general.unavailable", object),
        );
        expect(message).toBeInTheDocument();
        const retry = within(
          message.closest<HTMLElement>('[role="alert"]')!,
        ).getByRole("button", { name: "Wiederholen" });
        if (read === api.listAccountPage) {
          expect(read).toHaveBeenCalledWith(
            { kind: "school", id: "10" },
            { sort: "name", direction: "asc", search: "" },
          );
        } else {
          expect(read).toHaveBeenCalledWith("10");
        }
        act(() => retry.click());
        await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      },
    );
  });

  it("starts school and organization lookups together, then the usage of the overview tab", async () => {
    const organizations = deferred<OrganizationSummary[]>();
    api.listOrganizationSummaries.mockReturnValue(organizations.promise);
    const params = Promise.resolve({ slug: org.slug, schoolSlug: school.slug });
    await params;
    await act(async () => {
      renderPage(<SchoolPage params={params} />);
    });
    await waitFor(() =>
      expect(api.listSchoolSummaries).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      organizations.resolve([org]);
    });
    expect(await screen.findByText("Schule A")).toBeInTheDocument();
    expect(api.getSchoolPWAUsage).toHaveBeenCalledWith("10");
    expect(api.listAccountPage).not.toHaveBeenCalled();
    // Anker: the matched school is fully resolved, not a permanent skeleton.
    expect(screen.getByText("Schule A")).toBeInTheDocument();
    expect(api.listOrganizationSchools).not.toHaveBeenCalled();
  });

  it("loads the accounts of a school on its Konten tab, without the usage", async () => {
    state.query = "tab=konten";
    const params = Promise.resolve({ slug: org.slug, schoolSlug: school.slug });
    await params;
    await act(async () => {
      renderPage(<SchoolPage params={params} />);
    });
    expect(await screen.findByText("Schule A")).toBeInTheDocument();
    await waitFor(() =>
      expect(api.listAccountPage).toHaveBeenCalledWith(
        { kind: "school", id: "10" },
        { sort: "name", direction: "asc", search: "" },
      ),
    );
    expect(api.getSchoolPWAUsage).not.toHaveBeenCalled();
    expect(api.listOrganizationSchools).not.toHaveBeenCalled();
  });

  it("does not resolve a school slug under a different organization", async () => {
    api.listSchoolSummaries.mockResolvedValue([
      { ...school, organizationId: "2" },
    ]);
    const params = Promise.resolve({ slug: org.slug, schoolSlug: school.slug });
    await params;
    await act(async () => {
      renderPage(<SchoolPage params={params} />);
    });
    expect(
      await screen.findByText("Schule nicht gefunden."),
    ).toBeInTheDocument();
    // Anker: the wrong-organization route has resolved to its explicit not-found view.
    expect(screen.getByText("Schule nicht gefunden.")).toBeInTheDocument();
    expect(api.listAccountPage).not.toHaveBeenCalled();
    expect(api.getSchoolPWAUsage).not.toHaveBeenCalled();
  });

  it("loads the audited organization-specific school list and excludes another organization", async () => {
    const otherSchool = {
      ...school,
      id: "20",
      name: "Fremde Schule",
      organizationId: "2",
    };
    state.query = "tab=schulen";
    // Even a malformed response may not expose a row from another organization.
    api.listOrganizationSchools.mockResolvedValue([school, otherSchool]);
    const params = Promise.resolve({ slug: org.slug });
    await params;
    let view!: ReturnType<typeof renderPage>;
    await act(async () => {
      view = renderPage(<OrganizationPage params={params} />);
    });
    expect(await screen.findByText(school.name)).toBeInTheDocument();
    expect(api.listOrganizationSchools).toHaveBeenCalledWith(org.id);
    const cached = view.cache.get(
      `operator:account-a:${operatorProvisioningKeys.organizationSchoolSummaries(org.id)}`,
    );
    expect(cached.data.map((row: SchoolSummary) => row.id)).toEqual([
      school.id,
    ]);
    // Anker: the requested organization's own school row has finished loading.
    expect(screen.getByText(school.name)).toBeInTheDocument();
    expect(screen.queryByText(otherSchool.name)).not.toBeInTheDocument();
    expect(api.listSchoolSummaries).not.toHaveBeenCalled();
  });

  it.each(["delete", "merge"])(
    "refreshes all person counters after %s",
    async (action) => {
      let count = 2;
      const person: OperatorPerson = {
        id: "10",
        firstName: "Test",
        lastName: "Person",
        fullName: "Test Person",
        hasAccount: false,
        accountEmail: null,
        hasRfidCard: false,
        // Without a child or staff profile, so the card offers the deletion
        // (#6840).
        isStaff: false,
        isStudent: false,
        schoolId: school.id,
        schoolName: school.name,
        organizationId: org.id,
        organizationName: org.name,
        createdAt: org.createdAt,
      };
      api.listSchoolPersons.mockResolvedValue([
        person,
        { ...person, id: "11", firstName: "Zweite", fullName: "Zweite Person" },
      ]);
      function CounterReaders() {
        const organizations = useSWRAuth(
          operatorProvisioningKeys.organizationSummaries(),
          async () => [{ ...org, personenCount: count }],
        );
        const schools = useSWRAuth(
          operatorProvisioningKeys.schoolSummaries(),
          async () => [{ ...school, personenCount: count }],
        );
        const organizationSchools = useSWRAuth(
          operatorProvisioningKeys.organizationSchoolSummaries(org.id),
          async () => [{ ...school, personenCount: count }],
        );
        return (
          <p>
            Trägerzahl {organizations.data?.[0]?.personenCount} Schulzahl{" "}
            {schools.data?.[0]?.personenCount} Trägerschulen{" "}
            {organizationSchools.data?.[0]?.personenCount}
          </p>
        );
      }
      renderPage(
        <>
          <PersonsPage />
          <CounterReaders />
        </>,
      );
      expect(
        await screen.findByText("Trägerzahl 2 Schulzahl 2 Trägerschulen 2"),
      ).toBeInTheDocument();
      expect(await screen.findByText("Zweite Person")).toBeInTheDocument();
      count = 1;
      api.listSchoolPersons.mockResolvedValue([
        { ...person, firstName: "Bestätigte", fullName: "Bestätigte Person" },
      ]);
      if (action === "delete") {
        // Löschen liegt im Kebab der Karte (#5604).
        act(() =>
          screen.getAllByRole("button", { name: /^Aktionen für/ })[1]!.click(),
        );
        act(() =>
          screen.getByRole("menuitem", { name: "Person löschen" }).click(),
        );
        act(() =>
          screen.getByRole("button", { name: "Löschen bestätigen" }).click(),
        );
      } else {
        act(() =>
          screen
            .getByRole("button", { name: "Zusammenführen bestätigen" })
            .click(),
        );
      }
      expect(
        await screen.findByText("Trägerzahl 1 Schulzahl 1 Trägerschulen 1"),
      ).toBeInTheDocument();
      expect(await screen.findByText("Bestätigte Person")).toBeInTheDocument();
    },
  );

  it("refreshes mounted detail and summary readers after a list write", async () => {
    let revision = 1;
    const detail = vi.fn(async () => `Detail ${revision}`);
    const summary = vi.fn(async () => `Übersicht ${revision}`);
    function DetailReaders() {
      const account = useSWRAuth(
        operatorProvisioningKeys.accountPage(
          { kind: "organization", id: "1" },
          { sort: "schoolName", direction: "asc" },
        ),
        detail,
      );
      const count = useSWRAuth(
        operatorProvisioningKeys.organizationSummaries(),
        summary,
      );
      return (
        <p>
          {account.data} {count.data}
        </p>
      );
    }
    api.listAccountPage.mockResolvedValue({
      rows: [{ accountId: "1" }],
      total: 1,
    });
    renderPage(
      <>
        <AccountsPage />
        <DetailReaders />
      </>,
    );
    expect(await screen.findByText("Detail 1 Übersicht 1")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Zugang ändern" });
    act(() => screen.getByRole("button", { name: "Zugang ändern" }).click());
    revision = 2;
    act(() => screen.getByRole("button", { name: "Zugang speichern" }).click());
    expect(await screen.findByText("Detail 2 Übersicht 2")).toBeInTheDocument();
  });
});
