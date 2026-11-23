import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import deMessages from "~/i18n/messages/de.generated";
import { ApiError } from "~/lib/api-error";
import {
  getChildConversation,
  getChildFeatures,
  getGroupThread,
  listMyChildren,
  postChildMessage,
} from "~/lib/parent-api";
import {
  PARENT_RESOURCE_OPTIONS,
  useParentResourceEvents,
} from "~/lib/hooks/use-parent-resources";
import { useSWRAuth } from "~/lib/swr";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import { parentKeys } from "~/lib/swr/parent-keys";
import { catalogText } from "~/test/error-catalog-text";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { ParentGroupThreadView } from "./group-thread-view";

vi.unmock("swr");

const loadAttachment = vi.hoisted(() => vi.fn<() => Promise<Response>>());

vi.mock("~/lib/parent-url", () => ({
  parentPath: (path: string) => path,
}));

vi.mock("~/lib/bff-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/bff-fetch")>()),
  bffFile: loadAttachment,
}));

vi.mock("~/lib/parent-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-api")>()),
  getGroupThread: vi.fn(),
  getChildConversation: vi.fn(),
  getChildFeatures: vi.fn(),
  listMyChildren: vi.fn(),
  postChildMessage: vi.fn(),
}));

const mockedThread = vi.mocked(getGroupThread);
const mockedFeatures = vi.mocked(getChildFeatures);
const mockedPost = vi.mocked(postChildMessage);
const mockedChildren = vi.mocked(listMyChildren);

const felix = { student_id: "42", first_name: "Felix", last_name: "Schneider" };
const mia = { student_id: "43", first_name: "Mia", last_name: "Schneider" };

const sommerfest = {
  id: "9",
  title: "Sommerfest am Freitag",
  target_label: "Gruppe Sonnenblumen",
  school_name: "Schule am Berg",
  counterpart_name: "OGS Schule am Berg",
  closed: false,
  last_message_at: "2026-09-09T08:00:00Z",
  last_message_body: "Bitte an die Kopfbedeckung denken.",
  unread: 0,
  children: [felix],
  messages: [
    {
      id: "1",
      body: "Wer kann einen Kuchen mitbringen?",
      created_at: "2026-09-09T07:00:00Z",
    },
    {
      id: "2",
      body: "Bitte an die Kopfbedeckung denken.",
      created_at: "2026-09-09T08:00:00Z",
    },
  ],
};

function features(notesEnabled: boolean) {
  return { notes_enabled: notesEnabled } as unknown as Awaited<
    ReturnType<typeof getChildFeatures>
  >;
}

function linked(child: typeof felix) {
  return { ...child, tenant_id: "7" } as unknown as Awaited<
    ReturnType<typeof listMyChildren>
  >[number];
}

function renderView() {
  return render(
    <ParentResourceTestProvider>
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <ParentGroupThreadView groupThreadId="9" />
      </NextIntlClientProvider>
    </ParentResourceTestProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFeatures.mockResolvedValue(features(true));
  mockedChildren.mockResolvedValue([linked(felix), linked(mia)]);
});

describe("ParentGroupThreadView (#4784)", () => {
  it("keeps an open PDF across draft edits and thread refreshes, but reloads for another child", async () => {
    const attachment = {
      id: "12",
      filename: "bastelliste.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
    };
    const thread = {
      ...sommerfest,
      messages: [{ ...sommerfest.messages[0]!, attachments: [attachment] }],
    };
    mockedThread.mockResolvedValue(thread);
    loadAttachment.mockImplementation(
      async () => new Response(new Blob(["%PDF-1.7"])),
    );
    URL.createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    URL.revokeObjectURL = vi.fn();
    let read!: ReturnType<
      typeof useSWRAuth<Awaited<ReturnType<typeof getGroupThread>>>
    >;
    function Probe() {
      read = useSWRAuth(parentInboxKeys.groupThread("9"), () =>
        getGroupThread("9"),
      );
      return null;
    }
    const { unmount } = render(
      <ParentResourceTestProvider>
        <NextIntlClientProvider locale="de" messages={deMessages}>
          <ParentGroupThreadView groupThreadId="9" />
          <Probe />
        </NextIntlClientProvider>
      </ParentResourceTestProvider>,
    );
    await screen.findByRole("textbox", { name: "Antwort" });
    fireEvent.click(
      screen.getByRole("button", { name: "Datei öffnen: bastelliste.pdf" }),
    );
    const frame = await screen.findByTitle("bastelliste.pdf");
    expect(frame).toHaveAttribute("src", "blob:first#view=FitH&navpanes=0");
    expect(loadAttachment).toHaveBeenCalledWith(
      "parent",
      "GET /parent/me/messages/children/{studentId}/attachments/{attachmentId}/download",
      expect.objectContaining({
        params: { studentId: "42", attachmentId: "12" },
      }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Antwort" }), {
      target: { value: "Wir bringen Kuchen." },
    });
    mockedThread.mockResolvedValue({
      ...thread,
      children: [{ ...felix }],
      messages: [
        {
          ...thread.messages[0]!,
          body: "Aktualisierte Nachricht",
          attachments: [{ ...attachment }],
        },
      ],
    });
    await act(async () => {
      await read.mutate();
    });
    expect(screen.getByText("Aktualisierte Nachricht")).toBeVisible();
    expect(screen.getByTitle("bastelliste.pdf")).toBe(frame);
    expect(frame).toHaveAttribute("src", "blob:first#view=FitH&navpanes=0");
    expect(loadAttachment).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    mockedThread.mockResolvedValue({ ...thread, children: [mia] });
    await act(async () => {
      await read.mutate();
    });
    expect(screen.getByTitle("bastelliste.pdf")).toHaveAttribute(
      "src",
      "blob:second#view=FitH&navpanes=0",
    );
    expect(loadAttachment).toHaveBeenCalledTimes(2);
    expect(loadAttachment).toHaveBeenLastCalledWith(
      "parent",
      "GET /parent/me/messages/children/{studentId}/attachments/{attachmentId}/download",
      expect.objectContaining({
        params: { studentId: "43", attachmentId: "12" },
      }),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });

  it("withdraws a deleted cached thread and its composer after a 404", async () => {
    mockedThread.mockResolvedValue(sommerfest);
    let read!: ReturnType<
      typeof useSWRAuth<Awaited<ReturnType<typeof getGroupThread>>>
    >;
    function Probe() {
      read = useSWRAuth(parentInboxKeys.groupThread("9"), () =>
        getGroupThread("9"),
      );
      return null;
    }
    render(
      <ParentResourceTestProvider>
        <NextIntlClientProvider locale="de" messages={deMessages}>
          <ParentGroupThreadView groupThreadId="9" />
          <Probe />
        </NextIntlClientProvider>
      </ParentResourceTestProvider>,
    );
    expect(
      await screen.findByText("Wer kann einen Kuchen mitbringen?"),
    ).toBeVisible();
    mockedThread.mockRejectedValue(new ApiError("gone", 404));
    await act(async () => {
      await read.mutate();
    });
    // Anker: nach dem geladenen Thread erscheint die Fehlermeldung.
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.queryByText("Wer kann einen Kuchen mitbringen?"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(read.readCurrent?.().data).toBeUndefined();
    mockedThread.mockRejectedValue(new ApiError("offline", 503));
    await act(async () => {
      await read.mutate();
    });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByText("Wer kann einen Kuchen mitbringen?"),
    ).not.toBeInTheDocument();
  });

  it("zeigt die Nachrichten der OGS und sagt, wer die Antwort sieht", async () => {
    mockedThread.mockResolvedValue(sommerfest);

    renderView();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Sommerfest am Freitag",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Gruppe Sonnenblumen")).toBeInTheDocument();
    expect(
      screen.getByText("Wer kann einen Kuchen mitbringen?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deine Antwort geht nur an die OGS. Andere Eltern sehen sie nicht.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zurück zu Nachrichten" }),
    ).toHaveAttribute("href", "/parents/messages");
  });

  it("schickt die Antwort fuer das gewaehlte Kind an die OGS", async () => {
    mockedThread.mockResolvedValue({ ...sommerfest, children: [felix, mia] });
    mockedPost.mockResolvedValue(
      {} as Awaited<ReturnType<typeof postChildMessage>>,
    );

    renderView();

    fireEvent.click(
      await screen.findByRole("button", { name: "Mia Schneider" }),
    );
    fireEvent.change(screen.getByLabelText("Antwort"), {
      target: { value: "Wir bringen Muffins." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        "43",
        "Wir bringen Muffins.",
        "9",
        "team",
        expect.any(String),
      ),
    );
    expect(
      await screen.findByText("Deine Antwort ist bei der OGS."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zum Chat mit der OGS" }),
    ).toHaveAttribute("href", "/parents/messages/43");
  });

  it("bietet bei einer geschlossenen Gruppennachricht nur den Chat an", async () => {
    mockedThread.mockResolvedValue({ ...sommerfest, closed: true });

    renderView();

    expect(
      await screen.findByText(
        "Diese Gruppennachricht ist geschlossen. Du kannst der OGS weiter im Chat zu deinem Kind schreiben.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zum Chat mit der OGS" }),
    ).toHaveAttribute("href", "/parents/messages/42");
    expect(screen.queryByLabelText("Antwort")).not.toBeInTheDocument();
  });

  // #4803: ein Kind ohne OGS-Platz hat keinen Chat mit der OGS.
  it("führt nur zum Chat eines Kindes mit OGS-Platz", async () => {
    mockedChildren.mockResolvedValue([
      { ...linked(felix), without_care_place: true },
      linked(mia),
    ]);
    mockedThread.mockResolvedValue({
      ...sommerfest,
      closed: true,
      children: [felix, mia],
    });

    const { unmount } = renderView();

    expect(
      await screen.findByRole("link", { name: "Zum Chat mit der OGS" }),
    ).toHaveAttribute("href", "/parents/messages/43");
    unmount();

    mockedThread.mockResolvedValue({ ...sommerfest, closed: true });
    renderView();
    expect(
      await screen.findByText("Diese Gruppennachricht ist geschlossen."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/weiter im Chat/)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Zum Chat mit der OGS" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt ohne Schreibrecht keinen Antwortweg", async () => {
    mockedThread.mockResolvedValue(sommerfest);
    mockedFeatures.mockResolvedValue(features(false));

    renderView();

    expect(
      await screen.findByText(
        "Du kannst auf diese Nachricht nicht antworten. Lesen kannst du sie weiterhin.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Antwort")).not.toBeInTheDocument();
  });

  it("zeigt eine geschlossene Gruppennachricht beim Senden als Formularfehler", async () => {
    mockedThread.mockResolvedValue(sommerfest);
    mockedPost.mockRejectedValue(
      new ApiError("closed", 409, {
        code: "communication.group_thread_closed",
      }),
    );

    renderView();

    fireEvent.change(await screen.findByLabelText("Antwort"), {
      target: { value: "Hallo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));

    expect(
      await screen.findByText(
        catalogText("communication.group_thread_closed", "die Antwort"),
      ),
    ).toBeInTheDocument();
  });
});

it("confirms the retried private answer when the group closed after response loss", async () => {
  mockedThread.mockResolvedValue(sommerfest);
  mockedPost.mockRejectedValueOnce(
    new ApiError("response lost", 503, { code: "general.unavailable" }),
  );
  renderView();
  fireEvent.change(await screen.findByLabelText("Antwort"), {
    target: { value: "Wir bringen Kuchen" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  await screen.findByText(catalogText("general.unavailable", "die Antwort"));
  const key = mockedPost.mock.calls[0]?.[4];
  expect(key).toEqual(expect.any(String));
  // The second POST returns the original reply despite the intervening close.
  mockedPost.mockResolvedValue({
    messages: [
      {
        id: "saved",
        kind: "message",
        sender_kind: "guardian",
        sender_name: "Ich",
        body: "Wir bringen Kuchen",
        created_at: "2026-09-09T10:05:00Z",
        client_message_id: key,
      },
    ],
  } as Awaited<ReturnType<typeof postChildMessage>>);
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  expect(
    await screen.findByText("Deine Antwort ist bei der OGS."),
  ).toBeInTheDocument();
  expect(mockedPost.mock.calls[1]?.[4]).toBe(key);
  expect(
    screen.getByRole("link", { name: "Zum Chat mit der OGS" }),
  ).toHaveAttribute("href", "/parents/messages/42");
  expect(
    screen.queryByText("Wir bringen Kuchen", { selector: "span" }),
  ).not.toBeInTheDocument();
  mockedThread.mockResolvedValue({ ...sommerfest, closed: true });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(
    await screen.findByText("Deine Antwort ist bei der OGS."),
  ).toBeInTheDocument();
});

it("liest die Gruppennachricht beim Öffnen einmal, ohne sich selbst neu auszulösen", async () => {
  // A second read stays pending, so a refetch loop shows as a count.
  mockedThread
    .mockResolvedValueOnce(sommerfest)
    .mockReturnValue(new Promise(() => {}));
  function Events() {
    useParentResourceEvents();
    return null;
  }
  render(
    <ParentResourceTestProvider>
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <Events />
        <ParentGroupThreadView groupThreadId="9" />
      </NextIntlClientProvider>
    </ParentResourceTestProvider>,
  );
  expect(await screen.findByText("Sommerfest am Freitag")).toBeInTheDocument();
  // The read nudges the unread refresh; that refresh must not read the
  // thread again, which would nudge again and mark it read in a hidden tab.
  await act(async () => {
    window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
  });
  await waitFor(() => expect(mockedChildren).toHaveBeenCalled());
  expect(mockedThread).toHaveBeenCalledTimes(1);
});

it("lässt den Chat des Kindes nach einer Antwort neu laden", async () => {
  mockedThread.mockResolvedValue(sommerfest);
  mockedPost.mockResolvedValue(
    {} as Awaited<ReturnType<typeof postChildMessage>>,
  );
  const mockedConversation = vi.mocked(getChildConversation);
  mockedConversation.mockResolvedValueOnce({
    messages: [{ id: "1", body: "Alter Stand" }],
  } as unknown as Awaited<ReturnType<typeof getChildConversation>>);
  mockedConversation.mockResolvedValueOnce({
    messages: [{ id: "2", body: "Wir bringen Muffins." }],
  } as unknown as Awaited<ReturnType<typeof getChildConversation>>);
  function CachedChat() {
    const { data } = useSWRAuth(
      parentKeys.conversation("42", "team"),
      () => getChildConversation("42", "team"),
      PARENT_RESOURCE_OPTIONS,
    );
    return <p>{data?.messages[0]?.body ?? "lädt"}</p>;
  }
  function Fixture({ chat }: Readonly<{ chat: boolean }>) {
    return (
      <ParentResourceTestProvider>
        <NextIntlClientProvider locale="de" messages={deMessages}>
          {chat ? <CachedChat /> : <ParentGroupThreadView groupThreadId="9" />}
        </NextIntlClientProvider>
      </ParentResourceTestProvider>
    );
  }
  const view = render(<Fixture chat />);
  expect(await screen.findByText("Alter Stand")).toBeInTheDocument();
  view.rerender(<Fixture chat={false} />);
  fireEvent.change(await screen.findByLabelText("Antwort"), {
    target: { value: "Wir bringen Muffins." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
  expect(
    await screen.findByText("Deine Antwort ist bei der OGS."),
  ).toBeInTheDocument();
  view.rerender(<Fixture chat />);
  expect(screen.queryByText("Alter Stand")).not.toBeInTheDocument();
  expect(await screen.findByText("Wir bringen Muffins.")).toBeInTheDocument();
  expect(mockedConversation).toHaveBeenCalledTimes(2);
});
