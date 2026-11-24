import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

// The session gate is session-cache.test.ts's case; here it lets every
// request through.
vi.mock("./session-cache", () => ({
  requireTenantSession: vi.fn(() => Promise.resolve()),
  renewTenantSession: vi.fn(() => Promise.resolve()),
}));

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EditActions } from "~/components/ui/edit-actions";
import { SearchBar } from "~/components/ui/page-header/SearchBar";
import type { bffFile, bffJson } from "./bff-fetch";

/** The proxy's refusal of a call from an older bundle (proxy.ts). */
const refusal = () =>
  Response.json(
    {
      type: "about:blank",
      title: "Precondition Failed",
      status: 412,
      code: "general.route_not_found",
    },
    {
      status: 412,
      headers: { "X-Moto-Deployment-ID": "new-release" },
    },
  );

describe("a tab of an earlier deployment, refused by the proxy", () => {
  let reload: ReturnType<typeof vi.spyOn>;
  // Draft tracking and the started reload live for the page's lifetime: a
  // fresh module per case is a fresh page.
  let read: typeof bffJson;
  let download: typeof bffFile;

  /** The reload started and the call is still open after its answer. */
  async function expectReloadInsteadOfAnswer(call: Promise<unknown>) {
    let settled = false;
    void call.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
  }

  async function expectRefusalReachesCaller(call: Promise<unknown>) {
    await expect(call).rejects.toMatchObject({
      status: 412,
      code: "general.route_not_found",
    });
    expect(reload).not.toHaveBeenCalled();
  }

  beforeEach(async () => {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "old-release");
    sessionStorage.clear();
    mockFetch.mockReset().mockImplementation(() => Promise.resolve(refusal()));
    vi.stubGlobal("fetch", mockFetch);
    reload = vi
      .spyOn(globalThis.location, "reload")
      .mockImplementation(() => undefined);
    vi.resetModules();
    ({ bffJson: read, bffFile: download } = await import("./bff-fetch"));
  });

  afterEach(() => {
    reload.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    cleanup();
    document.body.innerHTML = "";
  });

  it("reloads by itself instead of showing the „neue Version“ message", async () => {
    await expectReloadInsteadOfAnswer(read("tenant", "GET /api/groups/"));
  });

  it("holds every further refused call of the reloading page back as well", async () => {
    await expectReloadInsteadOfAnswer(read("tenant", "GET /api/groups/"));
    await expectReloadInsteadOfAnswer(
      download("tenant", "GET /api/meal-plan/orders/month/export", {
        query: { month: "2026-09", format: "pdf" },
      }),
    );
  });

  it("leaves a 412 of the same deployment to the caller", async () => {
    mockFetch.mockResolvedValue(
      Response.json(
        { status: 412, code: "general.route_not_found" },
        { status: 412, headers: { "X-Moto-Deployment-ID": "old-release" } },
      ),
    );

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("shows the message when it reloaded less than a minute ago, so a mismatch cannot loop", async () => {
    sessionStorage.setItem(
      "moto:deployment-skew-reload-at",
      String(Date.now()),
    );

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("shows the message for a refused save, whose edit the page may not show as a draft", async () => {
    await expectRefusalReachesCaller(
      read("tenant", "POST /api/activities/categories", {
        body: { name: "Sport", color: "#83CD2D" },
      }),
    );
  });

  it("shows the message while a dialog is open", async () => {
    document.body.innerHTML = '<div role="dialog"></div>';

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("shows the message while an edit state is open, whose controls may fire no input", async () => {
    // The note editor changes its kind by buttons only, then saves through
    // EditActions; a poll refused before Save must not reload over it.
    render(<EditActions onCancel={() => undefined} onSave={() => undefined} />);

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("shows the message while a page guards unsaved changes", async () => {
    const { registerNavigationBlocker } =
      await import("./hooks/navigation-guard-store");
    const release = registerNavigationBlocker(() => undefined);

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
    release();
  });

  it("shows the message while a form someone typed into is on screen", async () => {
    document.body.innerHTML = "<form><input /></form>";
    document
      .querySelector("input")
      ?.dispatchEvent(new Event("input", { bubbles: true }));

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("shows the message while an editor outside a form holds a draft", async () => {
    // The student notes edit in a textarea without a form element.
    document.body.innerHTML = "<div><textarea></textarea></div>";
    document
      .querySelector("textarea")
      ?.dispatchEvent(new Event("input", { bubbles: true }));

    await expectRefusalReachesCaller(read("tenant", "GET /api/groups/"));
  });

  it("reloads although someone typed into the page's search", async () => {
    render(<SearchBar value="" onChange={() => undefined} />);
    fireEvent.input(screen.getByPlaceholderText("Name suchen..."), {
      target: { value: "Mia" },
    });
    const landmark = document.createElement("div");
    landmark.innerHTML =
      '<div role="search"><input /></div><input type="search" />';
    document.body.append(landmark);
    for (const input of landmark.querySelectorAll("input")) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await expectReloadInsteadOfAnswer(read("tenant", "GET /api/groups/"));
  });

  it("reloads once the typed-in form has left the page, such as the login", async () => {
    document.body.innerHTML = "<form><input /></form>";
    document
      .querySelector("input")
      ?.dispatchEvent(new Event("input", { bubbles: true }));
    document.body.innerHTML = "";

    await expectReloadInsteadOfAnswer(read("tenant", "GET /api/groups/"));
  });
});
