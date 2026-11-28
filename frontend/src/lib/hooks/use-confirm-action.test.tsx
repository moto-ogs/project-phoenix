import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { ApiError } from "~/lib/api-error";
import { useActionOn } from "~/lib/swr/read-draft";
import { catalogText } from "~/test/error-catalog-text";

import { useConfirmAction } from "./use-confirm-action";

const OBJECT = "das Veröffentlichen der Umfrage";

interface DialogProps<T> {
  readonly run: () => Promise<T>;
  readonly onDone: (saved: T) => Promise<void> | void;
  readonly onClose: () => void;
}

function Dialog<T>({ run, onDone, onClose }: DialogProps<T>) {
  const action = useConfirmAction(run, {
    onDone,
    onClose,
    object: OBJECT,
    logEvent: "confirm_failed",
  });
  return (
    <div>
      <FormErrorAlert message={action.error} />
      <button type="button" onClick={() => void action.confirm()}>
        {action.pending ? "Läuft" : "Bestätigen"}
      </button>
    </div>
  );
}

/** A dialog that sends the version it shows (ADR 0311). */
function ReadDialog({
  version,
  send,
  reload,
  onClose,
}: {
  readonly version: string;
  readonly send: (version: string) => Promise<void>;
  readonly reload: () => Promise<unknown>;
  readonly onClose: () => void;
}) {
  const read = useActionOn(
    { opening: "7", data: { version }, reload },
    { token: (shown) => shown.version },
  );
  const action = useConfirmAction(() => send(version), {
    onDone: vi.fn(),
    onClose,
    object: OBJECT,
    logEvent: "confirm_failed",
    read,
  });
  return (
    <div>
      <FormErrorAlert message={action.error} />
      <button type="button" onClick={() => void action.confirm()}>
        Bestätigen
      </button>
      <output>{action.blocked ? action.blockedReason : "bereit"}</output>
    </div>
  );
}

const changedSinceRead = () =>
  new ApiError("changed since it was read", 409, {
    code: "general.changed_since_read",
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const confirmButton = () => screen.getByRole("button", { name: "Bestätigen" });

describe("useConfirmAction", () => {
  it("hands the confirmed answer to onDone and closes once it settled", async () => {
    const done = deferred<void>();
    const onDone = vi.fn(() => done.promise);
    const onClose = vi.fn();
    render(
      <Dialog
        run={() => Promise.resolve(3)}
        onDone={onDone}
        onClose={onClose}
      />,
    );

    fireEvent.click(confirmButton());

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(3));
    expect(screen.getByRole("button", { name: "Läuft" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      done.resolve();
      await done.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure in the open dialog and retries with the current step", async () => {
    const first = vi.fn(() =>
      Promise.reject(new ApiError("boom", 500, { code: "general.server" })),
    );
    const second = vi.fn(() => Promise.resolve("ok"));
    const onClose = vi.fn();
    const onDone = vi.fn();
    const view = render(
      <Dialog run={first} onDone={onDone} onClose={onClose} />,
    );

    fireEvent.click(confirmButton());

    expect(
      await screen.findByText(catalogText("general.server", OBJECT)),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    // The dialog shows another state by now: „Wiederholen“ sends that one.
    view.rerender(<Dialog run={second} onDone={onDone} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("ok");
  });

  it("sends once when confirm is clicked again before the answer", async () => {
    const sent = deferred<void>();
    const send = vi.fn(() => sent.promise);
    const onClose = vi.fn();
    render(
      <ReadDialog
        version="v1"
        send={send}
        reload={vi.fn(() => Promise.resolve())}
        onClose={onClose}
      />,
    );

    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    await act(async () => {
      sent.resolve();
      await sent.promise;
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the stored state after a refusal instead of offering a retry", async () => {
    const send = vi.fn(() => Promise.reject(changedSinceRead()));
    const reload = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <ReadDialog version="v1" send={send} reload={reload} onClose={onClose} />,
    );

    fireEvent.click(confirmButton());

    expect(await screen.findByText(/inzwischen geändert/)).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Wiederholen" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends nothing while the stored state could not be read", async () => {
    const send = vi.fn(() => Promise.reject(changedSinceRead()));
    const reload = vi.fn(() =>
      Promise.reject(
        new ApiError("down", 503, { code: "general.unavailable" }),
      ),
    );
    render(
      <ReadDialog version="v1" send={send} reload={reload} onClose={vi.fn()} />,
    );

    fireEvent.click(confirmButton());
    expect(
      await screen.findByText(/neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /konnten nicht geladen werden/,
    );

    await act(async () => {
      fireEvent.click(confirmButton());
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
