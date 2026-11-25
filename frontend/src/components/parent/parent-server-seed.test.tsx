import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSWRAuth } from "~/lib/swr";
import { _resetSWRFallbacksForTests } from "~/lib/swr/generation";
import { parentKeys } from "~/lib/swr/parent-keys";
import { resetSWRScope, resumeSWRSession } from "~/lib/swr/scope";
import type { ServerSeed } from "~/lib/swr/server-seed";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { ParentServerSeed } from "./parent-server-seed";

vi.unmock("swr");

const { session } = vi.hoisted(() => ({
  session: { user: { id: "41", scope: "parent" }, expires: "2099-01-01" },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: "authenticated" }),
}));

const messages = parentKeys.messages();
const groups = parentKeys.groupThreads();

function Reader({
  browserMessages,
  browserGroups,
}: Readonly<{
  browserMessages: () => Promise<string[]>;
  browserGroups: () => Promise<string[]>;
}>) {
  const threads = useSWRAuth(messages, browserMessages);
  const groupThreads = useSWRAuth(groups, browserGroups);
  return (
    <>
      <p>{threads.data?.join(", ") ?? "Messages loading"}</p>
      <p>{groupThreads.data?.join(", ") ?? "Groups loading"}</p>
    </>
  );
}

const seed = (entries: ServerSeed["entries"]): ServerSeed => ({
  builtAt: Date.now(),
  generation: sessionGeneration(session)!,
  entries,
});

describe("parent inbox first display", () => {
  beforeEach(() => {
    _resetSWRFallbacksForTests();
    resetSWRScope({ revalidate: false });
    resumeSWRSession();
  });

  it("renders the server's inbox rows in the first HTML", () => {
    const browser = vi.fn(async () => ["not from server"]);
    const rows = ["Seeded messages"];
    const resolved = Object.assign(Promise.resolve(rows), {
      status: "fulfilled",
      value: rows,
    });
    const html = renderToString(
      <ParentServerSeed
        seed={seed([{ key: messages, value: resolved, render: true }])}
        page={{ kind: "messages" }}
        day="2026-09-09"
        render
      >
        <Reader browserMessages={browser} browserGroups={browser} />
      </ParentServerSeed>,
    );
    expect(html).toContain("Seeded messages");
    expect(browser).not.toHaveBeenCalled();
  });

  it("waits for the pending inbox seed and retries only the failed key in the browser", async () => {
    const browserMessages = vi.fn(async () => ["Browser messages"]);
    const browserGroups = vi.fn(async () => ["Browser groups"]);
    let deliver: (value: ServerSeed) => void = () => undefined;
    const pending = new Promise<ServerSeed>((resolve) => {
      deliver = resolve;
    });

    render(
      <ParentServerSeed
        seed={pending}
        page={{ kind: "messages" }}
        day="2026-09-09"
      >
        <Reader
          browserMessages={browserMessages}
          browserGroups={browserGroups}
        />
      </ParentServerSeed>,
    );

    expect(screen.getByText("Messages loading")).toBeInTheDocument();
    await act(async () => {
      deliver(
        seed([
          { key: messages, value: Promise.resolve(["Seeded messages"]) },
          { key: groups, value: Promise.resolve(undefined) },
        ]),
      );
    });

    expect(await screen.findByText("Seeded messages")).toBeInTheDocument();
    expect(await screen.findByText("Browser groups")).toBeInTheDocument();
    expect(browserMessages).not.toHaveBeenCalled();
    expect(browserGroups).toHaveBeenCalledTimes(1);
  });
});
