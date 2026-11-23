import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type { Room } from "~/lib/room-helpers";
import { RoomStammdatenTab } from "./room-stammdaten-tab";

// The tab holds the draft (ADR 0311); the stand-in edits its name and saves
// it through the tab.
vi.mock("~/components/database/database-form", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/database/database-form")
  >()),
  DatabaseForm: function DatabaseFormStandIn({
    onSubmit,
    onCancel,
    draft,
  }: {
    onSubmit: (data: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
    draft?: {
      values: Record<string, unknown>;
      setValues: (
        next: (current: Record<string, unknown>) => Record<string, unknown>,
      ) => void;
      blocked?: string;
    };
  }) {
    return (
      <div data-testid="database-form">
        <input
          aria-label="Name"
          value={String(draft?.values.name ?? "")}
          onChange={(event) =>
            draft?.setValues((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
        />
        <button
          type="button"
          disabled={draft?.blocked !== undefined}
          title={draft?.blocked}
          // The real form shows a refused save on its error path.
          onClick={() =>
            void onSubmit({ ...draft?.values }).catch(() => undefined)
          }
        >
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  },
}));

// The error path itself is tested in DatabaseForm; here it only travels.
const errorPath = {
  error: null,
  show: vi.fn(),
  invalid: vi.fn(),
  fieldError: () => undefined,
  clear: vi.fn(),
};

const room: Room = {
  id: "1",
  name: "Raum 101",
  category: "Normaler Raum",
  building: "Hauptgebäude",
  floor: 1,
  capacity: 24,
  color: "#4F46E5",
  isOccupied: false,
  version: "v1",
};

const nameField = () => screen.getByRole("textbox", { name: "Name" });
const type = (value: string) =>
  fireEvent.change(nameField(), { target: { value } });

/** The page: a save and a read write the room into its read. */
function Page({
  initial,
  onSave,
  reload,
}: {
  initial: Room;
  onSave: (data: Partial<Room>, version: string | undefined) => Promise<Room>;
  reload: () => Promise<Room>;
}) {
  const [shown, setShown] = useState(initial);
  return (
    <RoomStammdatenTab
      errorPath={errorPath}
      room={shown}
      showOccupancy
      onSave={async (data, version) => {
        const stored = await onSave(data, version);
        setShown(stored);
        return stored;
      }}
      reload={async () => {
        const stored = await reload();
        setShown(stored);
        return stored;
      }}
    />
  );
}

function renderTab(
  props: Partial<Parameters<typeof RoomStammdatenTab>[0]> = {},
) {
  const all = {
    errorPath,
    room,
    showOccupancy: true,
    onSave: vi.fn((data: Partial<Room>) =>
      Promise.resolve({ ...room, ...data, version: "v2" }),
    ),
    reload: vi.fn(() => Promise.resolve(room)),
    ...props,
  };
  const view = render(<RoomStammdatenTab {...all} />);
  return {
    ...all,
    rerender: (next: Partial<typeof all>) =>
      view.rerender(<RoomStammdatenTab {...all} {...next} />),
  };
}

describe("RoomStammdatenTab", () => {
  beforeEach(() => {
    errorPath.show.mockReset();
  });

  it("shows the occupancy summary and the form for the room", () => {
    renderTab({
      room: {
        ...room,
        isOccupied: true,
        activityName: "Fußball AG",
        groupName: "Füchse",
      },
    });

    expect(screen.getByText("Belegt")).toBeInTheDocument();
    expect(screen.getByText("24 Plätze")).toBeInTheDocument();
    expect(screen.getByText("Fußball AG")).toBeInTheDocument();
    expect(screen.getByText("Füchse")).toBeInTheDocument();
    expect(screen.queryByText("Systemraum")).not.toBeInTheDocument();
    expect(nameField()).toHaveValue("Raum 101");
  });

  it("marks system rooms", () => {
    renderTab({ room: { ...room, name: "Schulhof" } });
    expect(screen.getByText("Systemraum")).toBeInTheDocument();
  });

  it("saves the draft with its version and shows the stored room after", async () => {
    const onSave = vi.fn((_data: Partial<Room>, version?: string) =>
      Promise.resolve({
        ...room,
        name: "Raum 101 neu",
        version: version === "v1" ? "v2" : "v3",
      }),
    );
    render(<Page initial={room} onSave={onSave} reload={vi.fn()} />);
    type("Raum 101 neu ");
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Raum 101 neu " }),
        "v1",
      ),
    );
    // The stored answer replaces the draft; the next save sends its version.
    await waitFor(() => expect(nameField()).toHaveValue("Raum 101 neu"));
    type("Raum 101 neuer");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(expect.anything(), "v2"),
    );
  });

  it("drops the draft when the user cancels", () => {
    renderTab();
    type("Entwurf");
    fireEvent.click(screen.getByText("Cancel"));
    expect(nameField()).toHaveValue("Raum 101");
  });

  it("shows the new room's values when the room changes", () => {
    const { rerender } = renderTab();
    type("Entwurf");
    rerender({ room: { ...room, id: "2", name: "Raum 202" } });
    expect(nameField()).toHaveValue("Raum 202");
  });

  // ADR 0311 rule 2: a live reload of the room (a check-in, a colleague's
  // save) keeps the typed draft and the version it was typed over.
  it("keeps the draft and its version across a live reload of the room", async () => {
    const { rerender, onSave } = renderTab();
    type("Entwurf");
    rerender({ room: { ...room, isOccupied: true } });
    rerender({ room: { ...room, name: "Raum der Kollegin", version: "v2" } });
    expect(nameField()).toHaveValue("Entwurf");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Entwurf" }),
        "v1",
      ),
    );
  });

  it("refills an untouched form from a newer read", () => {
    const { rerender } = renderTab();
    rerender({ room: { ...room, name: "Raum der Kollegin", version: "v2" } });
    expect(nameField()).toHaveValue("Raum der Kollegin");
  });

  it("hides occupancy data when the tenant does not track room occupancy", () => {
    renderTab({
      room: {
        ...room,
        isOccupied: true,
        activityName: "Fußball AG",
        groupName: "Füchse",
      },
      showOccupancy: false,
    });

    expect(screen.queryByText("Belegung")).not.toBeInTheDocument();
    expect(screen.queryByText("Belegt")).not.toBeInTheDocument();
    expect(screen.queryByText("Fußball AG")).not.toBeInTheDocument();
    expect(nameField()).toHaveValue("Raum 101");
  });

  it("shows the stored room once a save was refused as changed since it was read (ADR 0311)", async () => {
    const stored = { ...room, name: "Raum der Kollegin", version: "v2" };
    const onSave = vi.fn(() =>
      Promise.reject(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      ),
    );
    render(
      <Page
        initial={room}
        onSave={onSave}
        reload={() => Promise.resolve(stored)}
      />,
    );
    type("Entwurf");
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(nameField()).toHaveValue("Raum der Kollegin"));
    expect(errorPath.show).toHaveBeenCalledWith(
      expect.any(ApiError),
      expect.objectContaining({ reload: expect.any(Function) }),
    );
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(expect.anything(), "v2"),
    );
  });

  // ADR 0311 rule 6: a failed read after a refusal sends nothing.
  it("sends nothing after a refusal until the stored room is read", async () => {
    const { onSave } = renderTab({
      onSave: vi.fn(() =>
        Promise.reject(
          new ApiError("changed", 409, { code: "general.changed_since_read" }),
        ),
      ),
      reload: vi.fn(() =>
        Promise.reject(
          new ApiError("down", 503, { code: "general.unavailable" }),
        ),
      ),
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(errorPath.show).toHaveBeenCalled());
    const options = errorPath.show.mock.calls[0]?.[1] as {
      reload: () => Promise<unknown>;
    };
    await expect(options.reload()).rejects.toThrow();
    // Speichern is locked with its reason; the load error stays shown.
    await waitFor(() => expect(screen.getByText("Save")).toBeDisabled());
    expect(screen.getByText("Save")).toHaveAttribute(
      "title",
      "Lade zuerst den gespeicherten Stand neu.",
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
