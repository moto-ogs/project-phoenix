import { describe, expect, it } from "vitest";
import {
  noticeOptionsFromBackend,
  type NoticeOptionsWire,
} from "./care-contract-notices";

describe("end-notice reason mapping", () => {
  it.each([
    "letterhead_missing",
    "missing_student",
    "no_permitted_address",
    undefined,
  ] as const)("preserves the recorded reason %s", (reason) => {
    const row: NoticeOptionsWire = {
      contract_id: "25",
      status: "gekuendigt",
      child_name: "Bente Jansen",
      modules: "Kurzbetreuung",
      school_name: "OGS Sonnenhof",
      terms: "",
      ordinary_ends_on: null,
      special_ends_on: null,
      withdrawal_until: null,
      early_start: false,
      notice: {
        kind: "kuendigung",
        termination_kind: "ausserordentlich",
        channel: "eltern_app",
        declared_at: "2026-11-07T09:30:00Z",
        received_on: "2026-11-07",
        ends_on: "2026-12-31",
        recipient: "birgit@example.org",
        confirmation_text: "Eingang bestätigt.",
        end_notice_text: "Der Vertrag endet am 31.12.2026.",
        end_notice_sent: false,
        end_notice_not_sent_reason: reason,
      },
    };
    expect(noticeOptionsFromBackend(row).notice).toMatchObject({
      endNoticeSent: false,
      endNoticeNotSentReason: reason ?? null,
    });
  });

  it("reads a reason it does not know as no recorded reason", () => {
    const row: NoticeOptionsWire = {
      contract_id: "25",
      status: "gekuendigt",
      child_name: "Bente Jansen",
      modules: "Kurzbetreuung",
      school_name: "OGS Sonnenhof",
      terms: "",
      ordinary_ends_on: null,
      special_ends_on: null,
      withdrawal_until: null,
      early_start: false,
      notice: {
        kind: "kuendigung",
        termination_kind: "ausserordentlich",
        channel: "eltern_app",
        declared_at: "2026-11-07T09:30:00Z",
        received_on: "2026-11-07",
        ends_on: "2026-12-31",
        recipient: "birgit@example.org",
        confirmation_text: "Eingang bestätigt.",
        end_notice_text: "Der Vertrag endet am 31.12.2026.",
        end_notice_sent: false,
        end_notice_not_sent_reason: "a_reason_of_a_later_release",
      },
    };
    expect(noticeOptionsFromBackend(row).notice).toMatchObject({
      endNoticeSent: false,
      endNoticeNotSentReason: null,
    });
  });
});

// ADR 0270 point 6 (#2353): a kind or channel a newer backend adds is not
// passed on as a known one.
describe("notice values a newer backend adds", () => {
  it("keeps an unknown kind and channel apart", () => {
    const row: NoticeOptionsWire = {
      contract_id: "25",
      status: "ruhend",
      child_name: "Bente Jansen",
      modules: "Kurzbetreuung",
      school_name: "OGS Sonnenhof",
      terms: "",
      ordinary_ends_on: null,
      special_ends_on: null,
      withdrawal_until: null,
      early_start: false,
      notice: {
        kind: "anfechtung",
        channel: "post",
        declared_at: "2026-11-07T09:30:00Z",
        received_on: "2026-11-07",
        ends_on: null,
        recipient: "birgit@example.org",
        confirmation_text: "",
      },
    };
    const options = noticeOptionsFromBackend(row);
    expect(options.status).toBeUndefined();
    expect(options.notice).toMatchObject({
      kind: undefined,
      channel: undefined,
    });
  });
});
