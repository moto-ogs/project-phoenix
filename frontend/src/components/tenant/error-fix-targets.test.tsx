import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { ErrorFixTargetsProvider } from "./error-fix-targets";

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "1", roles: [], permissions: session.permissions },
      expires: "",
    },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "demo",
  useTenantRoutingModeSafe: () => "path",
}));

function refusal(code: string) {
  return { message: "Abgelehnt.", code, attempt: 1 };
}

describe("ErrorFixTargetsProvider: missing privacy notice (#7176)", () => {
  afterEach(() => {
    session.permissions = [];
  });

  it("leads who may write the legal texts to the privacy notice", () => {
    session.permissions = ["config:update", "config:manage"];

    render(
      <ErrorFixTargetsProvider>
        <FormErrorAlert
          message={refusal("settings.enrollment_privacy_notice_missing")}
        />
      </ErrorFixTargetsProvider>,
    );

    expect(
      screen.getByRole("link", { name: "Zur Datenschutzinformation" }),
    ).toHaveAttribute(
      "href",
      "/demo/settings?tab=enrollment&highlight=enrollment.legal_dsgvo_enabled",
    );
  });

  it("shows no link to who may not write the legal texts", () => {
    session.permissions = ["config:update"];

    render(
      <ErrorFixTargetsProvider>
        <FormErrorAlert
          message={refusal("settings.enrollment_privacy_notice_missing")}
        />
      </ErrorFixTargetsProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Abgelehnt.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
