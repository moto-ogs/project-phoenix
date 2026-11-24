import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentMailStatus } from "~/components/calendar/appointment-mail-status";
import { useRequestMails } from "~/components/enrollment/request-mail-status";
import {
  useAbsenceDecisionMails,
  useOwnAbsenceRequestMails,
} from "~/components/staff/absence-mail-status";
import {
  useThreadMails,
  useGroupThreadMails,
} from "~/lib/hooks/use-message-mails";
import { useSwrPollingRecovery } from "~/lib/hooks/use-swr-polling-recovery";
import * as backoff from "~/lib/rate-limit-backoff";
import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";
import { releaseFakeTimers } from "~/test/clock";

vi.unmock("swr");
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { id: "1" } } }),
}));
vi.mock("~/lib/enrollment-admin-api", () => ({ getAdminRequestMails: read }));
vi.mock("~/lib/personal-calendar-api", () => ({
  getStaffAppointmentMails: read,
}));
vi.mock("~/lib/staff-api", () => ({
  staffAbsenceService: { decisionMails: read },
}));
vi.mock("~/lib/time-tracking-api", () => ({
  timeTrackingService: { getAbsenceRequestMails: read },
}));

vi.mock("~/lib/parent-group-threads-api", () => ({
  fetchGroupThreadMails: read,
}));
vi.mock("~/lib/parent-messages-api", () => ({ fetchThreadMails: read }));

function Thread() {
  useThreadMails("1");
  return null;
}
function GroupThread() {
  useGroupThreadMails("1");
  return null;
}

function Enrollment() {
  useRequestMails("1");
  return null;
}
function Appointment() {
  return <AppointmentMailStatus appointmentId="1" />;
}
function Decision() {
  useAbsenceDecisionMails(["1"]);
  return null;
}
function OwnRequest() {
  useOwnAbsenceRequestMails(["1"]);
  return null;
}

const views = [
  {
    name: "enrollment",
    View: Enrollment,
    fast: 15_000,
    result: (outcome: string, active: boolean) =>
      outcome
        ? [{ kind: "enrollment_approved", outcome, awaiting_feedback: active }]
        : [],
  },
  {
    name: "appointment",
    View: Appointment,
    fast: 15_000,
    result: (outcome: string, active: boolean) => ({
      kinds: outcome ? { appointment_published: { [outcome]: 1 } } : {},
      awaitingFeedback: active,
    }),
  },
  {
    name: "decision",
    View: Decision,
    fast: 30_000,
    result: (outcome: string, active: boolean) => ({
      mails: outcome ? { "1": outcome } : {},
      awaitingFeedback: active,
    }),
  },
  {
    name: "notice",
    View: OwnRequest,
    fast: 30_000,
    result: (outcome: string, active: boolean) => ({
      mails: outcome ? { "1": { [outcome]: 1 } } : {},
      awaitingFeedback: active,
    }),
  },
];

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe.each(views)("$name mail reader", ({ View, fast, result }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    read.mockReset();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    releaseFakeTimers();
  });
  function mount() {
    return render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <View />
      </SWRConfig>,
    );
  }
  it.each(["", "delivered", "accepted", "overdue"])(
    "reconciles quiet status %j and follows a new delivery",
    async (outcome) => {
      read
        .mockResolvedValueOnce(result(outcome, false))
        .mockResolvedValueOnce(result("accepted", true))
        .mockResolvedValue(result("delivered", false));
      const view = mount();
      await tick(0);
      expect(read).toHaveBeenCalledTimes(1);
      await tick(299_999);
      expect(read).toHaveBeenCalledTimes(1);
      await tick(1);
      expect(read).toHaveBeenCalledTimes(2);
      await tick(fast);
      expect(read).toHaveBeenCalledTimes(3);
      await tick(fast);
      expect(read).toHaveBeenCalledTimes(3);
      view.unmount();
    },
  );
  it("skips active polls while hidden or offline", async () => {
    read.mockResolvedValue(result("queued", true));
    const view = mount();
    await tick(0);
    expect(read).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await tick(fast * 2);
    expect(read).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    window.dispatchEvent(new Event("offline"));
    await tick(fast * 2);
    expect(read).toHaveBeenCalledTimes(1);
    view.unmount();
    window.dispatchEvent(new Event("online"));
  });
  it("does not recover a refused read on its own", async () => {
    read.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const view = mount();
    await tick(0);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(600_000);
    expect(read).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe.each([Thread, GroupThread])("%s chat mail reader", (View) => {
  it("polls tracked sends, reconciles late feedback slowly, then stops", async () => {
    vi.useFakeTimers();
    const result = (outcome: string, awaitingFeedback: boolean) => ({
      mails: { "1": View === Thread ? outcome : { [outcome]: 1 } },
      awaitingFeedback,
    });
    read
      .mockReset()
      .mockResolvedValueOnce(result("accepted", true))
      .mockResolvedValueOnce(result("accepted", false))
      .mockResolvedValue(result("delivered", false));
    const view = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <View />
      </SWRConfig>,
    );
    try {
      await tick(0);
      await tick(15_000);
      expect(read).toHaveBeenCalledTimes(2);
      await tick(299_999);
      expect(read).toHaveBeenCalledTimes(2);
      await tick(1);
      expect(read).toHaveBeenCalledTimes(3);
      await tick(600_000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      releaseFakeTimers();
    }
  });
});

it("resumes recovery only when online and the GET backoff has expired", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const remaining = vi
    .spyOn(backoff, "remainingRateLimitMs")
    .mockReturnValue(15_000);
  const reload = vi.fn().mockResolvedValue(undefined);
  const failure = new ApiError("Rate limit", 429);
  const view = renderHook(() => useSwrPollingRecovery(failure, reload, 15_000));
  try {
    await tick(15_000);
    expect(reload).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await tick(15_000);
    expect(remaining).toHaveBeenCalledWith("GET");
    expect(reload).not.toHaveBeenCalled();
    remaining.mockReturnValue(0);
    await tick(15_000);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    releaseFakeTimers();
  }
});
