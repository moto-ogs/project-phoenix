import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { EnrollmentPrivacyNoticeWarning } from "./enrollment-privacy-notice-warning";

const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "1", permissions: mocks.permissions },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/demo${path}`,
}));

const running = {
  enrollmentEnabled: true,
  noticePresent: false,
  notificationRecipients: "",
};

beforeEach(() => {
  mocks.permissions = ["config:update", "config:manage"];
});

// A school whose form went online before #7176 keeps it online and sees a
// warning that cannot be closed until the notice is there.
describe("EnrollmentPrivacyNoticeWarning", () => {
  it("warns while enrollment runs without a notice and leads to it", () => {
    render(<EnrollmentPrivacyNoticeWarning state={running} />);

    expect(screen.getByText("Datenschutzinformation fehlt")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Zur Datenschutzinformation" }),
    ).toHaveAttribute(
      "href",
      "/demo/settings?tab=enrollment&highlight=enrollment.legal_dsgvo_enabled",
    );
    expect(screen.queryByRole("button", { name: /schließen/i })).toBeNull();
  });

  it("names who acts when the person may not write the notice", () => {
    mocks.permissions = ["config:update"];
    render(<EnrollmentPrivacyNoticeWarning state={running} />);

    expect(
      screen.getByText(/Eintragen kann sie eine Person mit dem Recht/),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Zur Datenschutzinformation" }),
    ).toBeNull();
  });

  it.each([
    [
      "the notice is there",
      { ...running, noticePresent: true },
      ["config:update"],
    ],
    [
      "enrollment is off",
      { ...running, enrollmentEnabled: false },
      ["config:update"],
    ],
    ["the person may not change settings", running, ["config:read"]],
  ])("stays hidden when %s", (_case, state, permissions) => {
    mocks.permissions = permissions;
    const { container } = render(
      <div data-testid="anchor">
        <EnrollmentPrivacyNoticeWarning state={state} />
      </div>,
    );

    expect(screen.getByTestId("anchor")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Datenschutzinformation fehlt");
  });
});
