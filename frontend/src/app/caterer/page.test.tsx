import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
  type RenderOptions,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  fetchCatererOverview: vi.fn(),
  fetchCatererOrders: vi.fn(),
  downloadCatererDeliveries: vi.fn(),
  confirmCatererOrder: vi.fn(),
}));

vi.mock("~/lib/caterer-api", () => mocks);

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { CatererOverviewPage } from "~/components/caterer/caterer-overview-page";
import { setTestClock, releaseFakeTimers } from "~/test/clock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function week(dayTotals: number[], change = 0) {
  return {
    school: { id: "1", name: "x" },
    deliveryAddress: "Hof",
    rhythm: "daily",
    detail: "total",
    days: [
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ].map((date, index) => ({
      date,
      closed: false,
      deadline: `${date}T07:00:00Z`,
      status: "ordered",
      orderId: String(index + 1),
      confirmedAt: null,
      total: dayTotals[index] ?? 0,
      classes: [],
      children: [],
      changes:
        index === 0 && change !== 0
          ? [
              {
                sequence: 1,
                child: { firstName: "", lastName: "", schoolClass: "" },
                delta: change,
                detectedAt: "",
              },
            ]
          : [],
    })),
  };
}

const north = { id: "1", name: "OGS Nord" };
const south = { id: "2", name: "OGS Süd" };
function summary(school = north, total = 10, added = 1) {
  return {
    ...school,
    deliveryAddress: "Hof",
    grant: "supply/names/by_class",
    failure: null as { code: string; status: number } | null,
    days: week(Array<number>(5).fill(total)).days.map((day, i) => ({
      date: day.date,
      closed: day.closed,
      deadline: day.deadline,
      status: day.status,
      orderId: day.orderId,
      total: day.total,
      added: i === 0 ? added : 0,
      removed: 0,
    })),
  };
}
function overview(...schools: ReturnType<typeof summary>[]) {
  return { catererName: "Küche am Markt", schools };
}
const initialOverview = () => overview(summary(), summary(south, 5, 0));
const openSchool = (name = north.name) =>
  fireEvent.click(screen.getByRole("button", { name: name + " ausklappen" }));
function schoolCard(name = north.name) {
  return within(screen.getByRole("heading", { name }).closest("section")!);
}
async function ready() {
  await screen.findByRole("heading", {
    name: "Bestellungen für Küche am Markt",
  });
}
function Revalidation({
  signal,
}: Readonly<{
  signal: { refresh?: ReturnType<typeof useInvalidateMatching> };
}>) {
  signal.refresh = useInvalidateMatching();
  return null;
}
describe("CatererOverviewPage (#3873)", () => {
  beforeEach(() => {
    // The week fixture and the expected periods are the week of Wednesday 2026-09-09.
    setTestClock("2026-09-09T12:00:00+02:00");
    vi.resetAllMocks();
    sessionState.data = {
      user: { id: "caterer", scope: "caterer" },
      expires: "2099-01-01",
    } as Session;
    mocks.fetchCatererOverview.mockResolvedValue(initialOverview());
    mocks.fetchCatererOrders.mockImplementation((schoolId: string) =>
      Promise.resolve(
        schoolId === "1"
          ? week([10, 10, 10, 10, 10], 1)
          : week([5, 5, 5, 5, 5]),
      ),
    );
  });

  it("shows every school per day with sums per school and per day", async () => {
    render(<CatererOverviewPage />, { wrapper: ToastProvider });

    expect(
      await screen.findByText("Bestellungen für Küche am Markt"),
    ).toBeInTheDocument();
    // The test clock is Wednesday, 2026-09-09: this week opens.
    expect(mocks.fetchCatererOrders).not.toHaveBeenCalled();
    const table = (await screen.findAllByRole("table"))[0]!;
    const sum = within(table)
      .getByText("Summe", { selector: "span" })
      .closest("tr")!;
    expect(within(sum).getAllByText("15")).toHaveLength(5);
    expect(within(sum).getByText("75")).toBeInTheDocument();
    const north = within(table).getByText("OGS Nord").closest("tr")!;
    expect(within(north).getByText("50")).toBeInTheDocument();
    expect(within(north).getByText("+1")).toBeInTheDocument();
  });

  it("reconciles totals and late changes from a newly opened detail without another GET", async () => {
    mocks.fetchCatererOrders.mockResolvedValueOnce(
      week([11, 10, 10, 10, 10], -2),
    );
    render(<CatererOverviewPage />);
    await ready();
    const table = within(screen.getAllByRole("table")[0]!);
    expect(table.getByText("75")).toBeVisible();
    openSchool();
    await schoolCard().findAllByRole("button", { name: "Erhalten bestätigen" });
    expect(await table.findByText("76")).toBeVisible();
    const row = within(table.getByText(north.name).closest("tr")!);
    expect(row.getByText("51")).toBeVisible();
    expect(row.getByText("−2")).toBeVisible();
    expect(row.queryByText("+1")).not.toBeInTheDocument();
    expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending directory refresh when a newer detail arrives", async () => {
    const signal: { refresh?: ReturnType<typeof useInvalidateMatching> } = {};
    render(
      <>
        <Revalidation signal={signal} />
        <CatererOverviewPage />
      </>,
    );
    await ready();
    const pending = deferred<ReturnType<typeof initialOverview>>();
    mocks.fetchCatererOverview.mockReturnValueOnce(pending.promise);
    act(() => {
      void signal.refresh?.((candidate) =>
        candidate.startsWith(catererKeys.overviewFamily),
      );
    });
    await waitFor(() =>
      expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(2),
    );
    mocks.fetchCatererOrders.mockResolvedValue(week([11, 11, 11, 11, 11]));
    openSchool();
    await schoolCard().findAllByRole("button", { name: "Erhalten bestätigen" });
    await act(async () => pending.resolve(overview(summary(north, 11, 0))));
    expect(
      screen.queryByRole("heading", { name: south.name }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getAllByRole("table")[0]!).getByText("55"),
    ).toBeVisible();
    expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)(
    "keeps the directory result when one school's manual retry finishes mid-refresh: %s",
    async (result) => {
      const signal: { refresh?: ReturnType<typeof useInvalidateMatching> } = {};
      const failed = {
        ...summary(),
        failure: { code: "general.server", status: 500 },
        days: [],
      };
      mocks.fetchCatererOverview.mockResolvedValueOnce(
        overview(failed, summary(south)),
      );
      render(
        <>
          <Revalidation signal={signal} />
          <CatererOverviewPage />
        </>,
      );
      await ready();
      openSchool();
      const retry = await schoolCard().findByRole("button", {
        name: "Wiederholen",
      });
      const pending = deferred<ReturnType<typeof initialOverview>>();
      mocks.fetchCatererOverview
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(overview(summary()));
      act(() => {
        void signal.refresh?.((candidate) =>
          candidate.startsWith(catererKeys.overviewFamily),
        );
      });
      await waitFor(() =>
        expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(2),
      );
      await act(async () => fireEvent.click(retry));
      expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(3);
      if (result === "success") {
        await act(async () => pending.resolve(overview(summary())));
        expect(
          screen.queryByRole("heading", { name: south.name }),
        ).not.toBeInTheDocument();
      } else {
        await act(async () => pending.reject(new ApiError("offline", 503)));
        expect(screen.getByRole("heading", { name: south.name })).toBeVisible();
      }
      expect(
        await schoolCard().findAllByRole("button", {
          name: "Erhalten bestätigen",
        }),
      ).toHaveLength(5);
    },
  );

  it("loads the details once on first opening per school and window", async () => {
    render(<CatererOverviewPage />);
    await ready();
    expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCatererOrders).not.toHaveBeenCalled();
    openSchool();
    expect(
      await schoolCard().findAllByRole("button", {
        name: "Erhalten bestätigen",
      }),
    ).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: "OGS Nord einklappen" }),
    );
    openSchool();
    expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "OGS Nord einklappen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));
    await ready();
    expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(2);
    expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1);
    openSchool();
    await waitFor(() =>
      expect(mocks.fetchCatererOrders).toHaveBeenLastCalledWith(
        "1",
        "2026-09-10",
        "2026-09-10",
      ),
    );
  });

  it.each(["success", "failure"] as const)(
    "confirms optimistically and reconciles only this school: %s",
    async (result) => {
      const post = deferred<void>();
      mocks.confirmCatererOrder.mockReturnValue(post.promise);
      render(<CatererOverviewPage />);
      await ready();
      openSchool();
      const buttons = await schoolCard().findAllByRole("button", {
        name: "Erhalten bestätigen",
      });
      fireEvent.click(buttons[0]!);
      expect(await schoolCard().findByText("Bestätigt")).toBeVisible();
      if (result === "success") {
        mocks.fetchCatererOverview.mockResolvedValueOnce(
          overview(summary(north, 12)),
        );
        const detail = week([12, 12, 12, 12, 12]);
        detail.days[0]!.status = "confirmed";
        mocks.fetchCatererOrders.mockResolvedValueOnce(detail);
        await act(async () => post.resolve());
        await waitFor(() =>
          expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(2),
        );
        expect(schoolCard().getByText("Bestätigt")).toBeVisible();
        expect(
          await within(screen.getAllByRole("table")[0]!).findByText("60"),
        ).toBeVisible();
      } else {
        await act(async () => post.reject(new ApiError("unavailable", 503)));
        expect(
          schoolCard().getAllByRole("button", { name: "Erhalten bestätigen" }),
        ).toHaveLength(5);
        expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1);
      }
      expect(mocks.fetchCatererOverview.mock.calls.slice(1)).toEqual(
        result === "success" ? [["2026-09-07", "2026-09-11", north.id]] : [],
      );
    },
  );

  it("preserves expanded controls on a failed background read", async () => {
    const signal: { refresh?: ReturnType<typeof useInvalidateMatching> } = {};
    render(
      <>
        <Revalidation signal={signal} />
        <CatererOverviewPage />
      </>,
    );
    await ready();
    openSchool();
    const [button] = await schoolCard().findAllByRole("button", {
      name: "Erhalten bestätigen",
    });
    mocks.fetchCatererOverview.mockRejectedValueOnce(
      new ApiError("offline", 503),
    );
    mocks.fetchCatererOrders.mockRejectedValueOnce(
      new ApiError("offline", 503),
    );
    await act(async () => {
      await signal.refresh?.((key) => key.startsWith("caterer-"));
    });
    expect(button).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["open", "collapsed"])(
    "refreshes only changed school details after an overview read (%s)",
    async (state) => {
      const signal: { refresh?: ReturnType<typeof useInvalidateMatching> } = {};
      render(
        <>
          <Revalidation signal={signal} />
          <CatererOverviewPage />
        </>,
      );
      await ready();
      openSchool();
      openSchool(south.name);
      await schoolCard().findAllByRole("button", {
        name: "Erhalten bestätigen",
      });
      await schoolCard(south.name).findAllByRole("button", {
        name: "Erhalten bestätigen",
      });
      if (state === "collapsed")
        fireEvent.click(
          screen.getByRole("button", { name: north.name + " einklappen" }),
        );
      mocks.fetchCatererOverview.mockResolvedValue(
        overview(summary(north, 12), summary(south, 5, 0)),
      );
      mocks.fetchCatererOrders.mockResolvedValue(week([12, 12, 12, 12, 12]));
      await act(async () => {
        await signal.refresh?.((key) =>
          key.startsWith(catererKeys.overviewFamily),
        );
      });
      if (state === "collapsed") {
        expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(2);
        openSchool();
      }
      await waitFor(() =>
        expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(3),
      );
      expect(mocks.fetchCatererOrders.mock.calls.at(-1)?.[0]).toBe(north.id);
      expect((await schoolCard().findAllByText("12")).length).toBeGreaterThan(
        0,
      );
    },
  );

  it.each(["ended", "narrowed", "replaced"])(
    "never reopens a detail under an old grant: %s",
    async (reason) => {
      const signal: { refresh?: ReturnType<typeof useInvalidateMatching> } = {};
      render(
        <>
          <Revalidation signal={signal} />
          <CatererOverviewPage />
        </>,
      );
      await ready();
      openSchool();
      await schoolCard().findAllByRole("button", {
        name: "Erhalten bestätigen",
      });
      const pending = deferred<ReturnType<typeof week>>();
      mocks.fetchCatererOrders.mockReturnValue(pending.promise);
      const row = { ...summary(), grant: reason };
      mocks.fetchCatererOverview.mockResolvedValue(
        reason === "ended"
          ? overview(summary(south, 5))
          : overview(row, summary(south, 5)),
      );
      await act(async () => {
        await signal.refresh?.((key) =>
          key.startsWith(catererKeys.overviewFamily),
        );
      });
      if (reason === "ended") {
        expect(
          screen.queryByRole("heading", { name: north.name }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          schoolCard().queryByRole("button", { name: "Erhalten bestätigen" }),
        ).not.toBeInTheDocument();
        await waitFor(() =>
          expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(2),
        );
      }
      await act(async () => pending.resolve(week([3])));
    },
  );

  it.each(["success", "refusal"] as const)(
    "does not apply a late detail after account switch: %s",
    async (outcome) => {
      const pending = deferred<ReturnType<typeof week>>();
      mocks.fetchCatererOrders.mockReturnValueOnce(pending.promise);
      const { rerender } = render(<CatererOverviewPage />);
      await ready();
      openSchool();
      await waitFor(() =>
        expect(mocks.fetchCatererOrders).toHaveBeenCalledTimes(1),
      );
      sessionState.data = {
        ...sessionState.data!,
        user: { ...sessionState.data!.user, id: "other" },
      };
      mocks.fetchCatererOverview.mockResolvedValue(overview(summary(south, 5)));
      rerender(<CatererOverviewPage />);
      await screen.findByRole("heading", { name: south.name });
      await act(async () => {
        if (outcome === "success") pending.resolve(week([999]));
        else
          pending.reject(
            new ApiError("supply ended", 403, { code: "meals.not_supplied" }),
          );
      });
      expect(screen.queryByText("999")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: north.name }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: south.name })).toBeVisible();
    },
  );
  it.each(["meals.not_supplied", "meals.plan_disabled"] as const)(
    "applies a late confirmation refusal only to its school in the selected period: %s",
    async (code) => {
      const post = deferred<void>();
      mocks.confirmCatererOrder.mockReturnValueOnce(post.promise);
      render(<CatererOverviewPage />);
      await ready();
      openSchool();
      const [button] = await schoolCard().findAllByRole("button", {
        name: "Erhalten bestätigen",
      });
      fireEvent.click(button!);
      fireEvent.click(screen.getByRole("button", { name: "Morgen" }));
      await screen.findByRole("heading", { name: south.name });
      await waitFor(() =>
        expect(mocks.fetchCatererOrders).toHaveBeenCalledWith(
          "1",
          "2026-09-10",
          "2026-09-10",
        ),
      );
      await act(async () => post.reject(new ApiError("denied", 403, { code })));
      if (code === "meals.not_supplied") {
        expect(
          screen.queryByRole("heading", { name: north.name }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          await schoolCard().findByRole("button", { name: "Wiederholen" }),
        ).toBeVisible();
        expect(screen.getAllByText("Unvollständig").length).toBeGreaterThan(0);
      }
      expect(screen.getByRole("heading", { name: south.name })).toBeVisible();
      expect(
        mocks.fetchCatererOrders.mock.calls.every(
          ([school]) => school === north.id,
        ),
      ).toBe(true);
    },
  );

  it("does not replace a newer successful retry with an older school snapshot", async () => {
    mocks.fetchCatererOverview.mockResolvedValueOnce(
      overview(
        {
          ...summary(),
          failure: { code: "general.server", status: 500 },
          days: [],
        },
        summary(south),
      ),
    );
    const first = deferred<ReturnType<typeof initialOverview>>();
    const last = deferred<ReturnType<typeof initialOverview>>();
    mocks.fetchCatererOverview
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    render(<CatererOverviewPage />);
    await ready();
    openSchool();
    const retry = await schoolCard().findByRole("button", {
      name: "Wiederholen",
    });
    fireEvent.click(retry);
    fireEvent.click(retry);
    // The open card reads its detail after the successful retry.
    mocks.fetchCatererOrders.mockResolvedValueOnce(
      week([12, 12, 12, 12, 12], 1),
    );
    await act(async () => last.resolve(overview(summary(north, 12))));
    await act(async () => first.resolve(overview(summary(north, 99))));
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("60")).toBeVisible();
    expect(within(table).queryByText("495")).not.toBeInTheDocument();
  });
  it("prints from one button and offers the file formats in the menu", async () => {
    mocks.downloadCatererDeliveries.mockResolvedValue(undefined);
    render(<CatererOverviewPage />, { wrapper: ToastProvider });
    await screen.findByText("Bestellungen für Küche am Markt");

    // Anker: Drucken steht als einzige Aktion neben dem Zeitraum.
    expect(screen.getByRole("button", { name: "Drucken" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "PDF" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Herunterladen")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["PDF", "Excel", "CSV"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Excel" }));
    await waitFor(() =>
      expect(mocks.downloadCatererDeliveries).toHaveBeenCalledWith(
        "2026-09-07",
        "2026-09-11",
        "xlsx",
      ),
    );
  });

  it("loads inside the orders card instead of covering the page", async () => {
    const pending = deferred<ReturnType<typeof initialOverview>>();
    mocks.fetchCatererOverview.mockReturnValueOnce(pending.promise);
    const { container } = render(<CatererOverviewPage />, {
      wrapper: ToastProvider,
    });

    // Anker: die Karte steht schon, die Tabelle zeigt ihr Skelett.
    expect(
      screen.getByRole("heading", { name: "Bestellungen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wird geladen…")).toBeInTheDocument();
    expect(container.querySelector(".fixed.inset-0")).toBeNull();

    await act(async () => {
      pending.resolve(initialOverview());
    });
    expect(
      screen.getByText("Bestellungen für Küche am Markt"),
    ).toBeInTheDocument();
  });

  it("shows a failed load with its retry inside the orders card", async () => {
    mocks.fetchCatererOverview.mockRejectedValueOnce(new ApiError("down", 503));
    render(<CatererOverviewPage />, { wrapper: ToastProvider });

    const retry = await screen.findByRole("button", { name: "Wiederholen" });
    const card = screen
      .getByRole("heading", { name: "Bestellungen" })
      .closest("section")!;
    expect(within(card).getByRole("alert")).toContainElement(retry);

    fireEvent.click(retry);
    expect(
      await screen.findByText("Bestellungen für Küche am Markt"),
    ).toBeInTheDocument();
  });

  it("says in the orders card when no school is supplied", async () => {
    mocks.fetchCatererOverview.mockResolvedValueOnce({
      catererName: "Küche am Markt",
      schools: [],
    });
    render(<CatererOverviewPage />, { wrapper: ToastProvider });

    const sentence = await screen.findByText(
      "Du belieferst zurzeit keine Schule. Sobald eine Schule dich einlädt, siehst du hier ihre Bestellungen.",
    );
    const card = screen
      .getByRole("heading", { name: "Bestellungen für Küche am Markt" })
      .closest("section")!;
    expect(card).toContainElement(sentence);
  });

  it("shows the school's actual disabled-plan reason before a retry", async () => {
    mocks.fetchCatererOverview.mockResolvedValue(
      overview(
        {
          ...summary(),
          failure: { code: "meals.plan_disabled", status: 403 },
          days: [],
        },
        summary(south),
      ),
    );
    render(<CatererOverviewPage />);
    await ready();
    openSchool();
    expect(
      await schoolCard().findByText(/Bitte frage deine Ansprechperson/),
    ).toBeVisible();
    expect(mocks.fetchCatererOverview).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCatererOrders).not.toHaveBeenCalled();
  });
  it("marks missing totals and retries only failed schools without fetching details", async () => {
    const both = initialOverview();
    mocks.fetchCatererOverview.mockResolvedValueOnce(
      overview(
        ...both.schools.map((row) => ({
          ...row,
          failure: { code: "general.server", status: 500 },
          days: [],
        })),
      ),
    );
    render(<CatererOverviewPage />);
    await ready();
    expect(screen.getAllByText("Unvollständig").length).toBeGreaterThan(0);
    const first = deferred<ReturnType<typeof initialOverview>>();
    const second = deferred<ReturnType<typeof initialOverview>>();
    mocks.fetchCatererOverview
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    openSchool();
    openSchool(south.name);
    fireEvent.click(
      await schoolCard().findByRole("button", { name: "Wiederholen" }),
    );
    fireEvent.click(
      await schoolCard(south.name).findByRole("button", {
        name: "Wiederholen",
      }),
    );
    expect(mocks.fetchCatererOrders).not.toHaveBeenCalled();
    expect(mocks.fetchCatererOverview.mock.calls.slice(1)).toEqual([
      ["2026-09-07", "2026-09-11", "1"],
      ["2026-09-07", "2026-09-11", "2"],
    ]);
    await act(async () => {
      second.resolve(overview(both.schools[1]!));
      first.resolve(overview(both.schools[0]!));
    });
    expect(await screen.findByText("75")).toBeVisible();
    expect(screen.queryByText("Unvollständig")).not.toBeInTheDocument();
  });

  it("withdraws a school when its opened detail refuses the supply", async () => {
    mocks.fetchCatererOrders.mockRejectedValueOnce(
      new ApiError("ended", 403, { code: "meals.not_supplied" }),
    );
    render(<CatererOverviewPage />);
    await ready();
    openSchool();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: north.name }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: south.name })).toBeVisible();
  });
  it("advances reads and exports across Berlin midnight", async () => {
    vi.useFakeTimers();
    setTestClock("2026-09-09T23:59:30+02:00");
    await act(async () => {
      render(<CatererOverviewPage />, { wrapper: ToastProvider });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Morgen" }));
    });
    expect(mocks.fetchCatererOverview).toHaveBeenLastCalledWith(
      "2026-09-10",
      "2026-09-10",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.fetchCatererOverview).toHaveBeenLastCalledWith(
      "2026-09-11",
      "2026-09-11",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    });
    expect(mocks.downloadCatererDeliveries).toHaveBeenCalledWith(
      "2026-09-11",
      "2026-09-11",
      "pdf",
    );
  });

  it("keeps the chosen period when an older overview arrives", async () => {
    const first = deferred<ReturnType<typeof initialOverview>>();
    mocks.fetchCatererOverview.mockReturnValueOnce(first.promise);
    render(<CatererOverviewPage />);
    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));
    await ready();
    await act(async () =>
      first.resolve(overview({ ...summary(), name: "Alte Woche" })),
    );
    expect(screen.queryByText("Alte Woche")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Morgen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  afterEach(() => {
    if (vi.isFakeTimers()) releaseFakeTimers();
  });
});

vi.unmock("swr");
import { SWRConfig } from "~/lib/swr/testing";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import type { Session } from "next-auth";
import type { ReactElement } from "react";
import { useInvalidateMatching } from "~/lib/swr";
import { catererKeys } from "~/lib/swr/portal-keys";
const sessionState = vi.hoisted(() => ({ data: null as Session | null }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: sessionState.data,
    status: sessionState.data ? "authenticated" : "unauthenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({ useTenantSlugSafe: () => null }));
function render(ui: ReactElement, options?: RenderOptions) {
  const Wrapper = options?.wrapper ?? ToastProvider;
  const cache = new Map();
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }) => (
      <SWRConfig value={{ provider: () => cache, shouldRetryOnError: false }}>
        <Wrapper>
          <SWRScopeBoundary />
          {children}
        </Wrapper>
      </SWRConfig>
    ),
  });
}

import { resumeSWRSession } from "~/lib/swr/scope";
afterEach(() => resumeSWRSession());
