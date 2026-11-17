import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TraegerDemoEntryPage from "./page";

// next/image resolves its src against the stubbed location, which has no href.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt as string} />
  ),
}));

const fetchMock = vi.fn();
const assign = vi.fn();

function json(status: number, body: unknown = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function open(hash: string) {
  globalThis.history.replaceState(null, "", `/demo${hash}`);
  return render(<TraegerDemoEntryPage />);
}

const READY = {
  status: "ready",
  school_name: "OGS Beispiel",
  school_url: "https://ogs-beispiel-k3m9xp.demo.example",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", {
    ...globalThis.location,
    get hash() {
      return new URL(document.URL).hash;
    },
    pathname: "/demo",
    search: "",
    assign,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The Träger-Portal of the public demo (#6193): the same link redeemed at
// the school's own Demo-Träger.
describe("TraegerDemoEntryPage", () => {
  it("redeems the link as the Träger-Büro, signs in and opens the Träger-Portal", async () => {
    fetchMock.mockReturnValueOnce(json(200, READY)).mockReturnValueOnce(
      json(200, {
        session_created: true,
        demo: { access_id: "4711", role: "traeger", traeger: true },
      }),
    );

    open("#token=secret-token&role=traeger&switched=1");

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/demo/access/sessions");
    expect(init.body).toBe(
      JSON.stringify({ token: "secret-token", role: "traeger" }),
    );
    expect(document.URL).not.toContain("secret-token");
    // The banner of the Träger-Portal shows the OGS name and reports the switch.
    expect(JSON.parse(localStorage.getItem("moto-demo-visit") ?? "")).toEqual({
      accessId: "4711",
      role: "traeger",
      traeger: true,
      schoolName: "OGS Beispiel",
      pending: "demo_role_switched",
    });
  });

  // A school under the shared Demo-Träger has no office of its own: the
  // visitor goes on to the role cards of the OGS app, no session is kept.
  it("sends the visitor to the OGS app when the school has no Träger of its own", async () => {
    fetchMock
      .mockReturnValueOnce(json(200, READY))
      .mockReturnValueOnce(
        json(422, { status: 422, code: "identity.demo_access_invalid" }),
      );

    open("#token=secret-token&role=traeger");

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://ogs-beispiel-k3m9xp.demo.example/demo#token=secret-token",
      ),
    );
    expect(localStorage.getItem("moto-demo-visit")).toBeNull();
  });
});
