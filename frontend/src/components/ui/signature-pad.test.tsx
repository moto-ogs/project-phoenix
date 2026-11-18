import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignaturePad, pngBase64FromDataUrl } from "./signature-pad";
import type { SignatureValue } from "~/lib/signature";

// The signature field (#4785): drawing yields a PNG only after the explicit
// confirmation, clearing resets it, and typing the name is a full keyboard
// path to the same value. jsdom has no canvas, so the 2D context is a spy.

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

let context: Record<string, ReturnType<typeof vi.fn> | unknown>;

beforeEach(() => {
  context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    PNG_DATA_URL,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({
  onValue,
  error,
}: Readonly<{
  onValue: (value: SignatureValue | null) => void;
  error?: string;
}>) {
  const [value, setValue] = useState<SignatureValue | null>(null);
  return (
    <SignaturePad
      id="sig"
      value={value}
      error={error}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function draw() {
  const canvas = screen.getByRole("img", { name: "Feld zum Unterschreiben" });
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

describe("SignaturePad", () => {
  it("strips the data URL prefix", () => {
    expect(pngBase64FromDataUrl(PNG_DATA_URL)).toBe("iVBORw0KGgoAAAANSUhEUg==");
  });

  it("refuses to confirm an empty field and says what to do", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );

    expect(onValue).not.toHaveBeenCalled();
    expect(
      screen.getByText("Bitte unterschreibe im Feld."),
    ).toBeInTheDocument();
  });

  it("yields the drawn PNG without prefix only after the confirmation", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    draw();
    expect(context.stroke).toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );

    expect(onValue).toHaveBeenCalledWith({
      method: "drawn",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUg==",
    });
    expect(screen.getByAltText("Deine Unterschrift")).toHaveAttribute(
      "src",
      PNG_DATA_URL,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Deine Unterschrift ist bereit.",
    );
  });

  it("clears the drawing and starts over after a new signature", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    draw();
    fireEvent.click(screen.getByRole("button", { name: "Feld leeren" }));
    expect(context.clearRect).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );
    expect(onValue).not.toHaveBeenCalled();

    draw();
    fireEvent.click(
      screen.getByRole("button", { name: "Unterschrift bestätigen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Neu unterschreiben" }));

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(
      screen.getByRole("img", { name: "Feld zum Unterschreiben" }),
    ).toBeInTheDocument();
  });

  it("offers the typed name as a keyboard path", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.click(screen.getByRole("button", { name: "Namen tippen" }));
    const input = screen.getByLabelText("Dein Name");
    fireEvent.change(input, { target: { value: "E" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByText("Bitte tippe deinen Namen.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "  Erika Muster " } });
    expect(context.fillText).toHaveBeenLastCalledWith(
      "Erika Muster",
      expect.any(Number),
      expect.any(Number),
    );
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onValue).toHaveBeenCalledWith({
      method: "typed",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUg==",
      typedName: "Erika Muster",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Dein getippter Name ist bereit.",
    );
  });

  it("counts typed names as Unicode code points like the server", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    fireEvent.click(screen.getByRole("button", { name: "Namen tippen" }));
    const input = screen.getByLabelText("Dein Name");
    fireEvent.change(input, { target: { value: "😀" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByText("Bitte tippe deinen Namen.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "😀A" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onValue).toHaveBeenCalledWith({
      method: "typed",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUg==",
      typedName: "😀A",
    });

    fireEvent.click(screen.getByRole("button", { name: "Neu unterschreiben" }));
    const nextInput = screen.getByLabelText("Dein Name");
    const atLimit = `${"A".repeat(119)}😀`;
    fireEvent.change(nextInput, { target: { value: `${atLimit}B` } });
    expect(nextInput).toHaveValue(atLimit);

    fireEvent.keyDown(nextInput, { key: "Enter" });
    expect(onValue).toHaveBeenLastCalledWith({
      method: "typed",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUg==",
      typedName: atLimit,
    });
  });

  it("describes the field with the given error", () => {
    render(<Harness onValue={vi.fn()} error="Bitte noch einmal." />);

    const canvas = screen.getByRole("img", { name: "Feld zum Unterschreiben" });
    expect(canvas).toHaveAccessibleDescription(
      /Unterschreibe mit dem Finger.*Bitte noch einmal\./,
    );
  });

  it("marks the pad so a failed form jumps to it (#5217)", () => {
    const { container, rerender } = render(
      <Harness onValue={vi.fn()} error="Bitte noch einmal." />,
    );
    // The selector FormErrorAlert jumps to; a group cannot carry
    // aria-invalid, so the pad is marked with data-form-invalid (#7111).
    expect(container.querySelector(FORM_INVALID)).toContainElement(
      screen.getByRole("img", { name: "Feld zum Unterschreiben" }),
    );

    rerender(<Harness onValue={vi.fn()} />);
    expect(
      screen.getByRole("img", { name: "Feld zum Unterschreiben" }),
    ).not.toHaveAccessibleDescription(/Bitte noch einmal/);
    expect(container.querySelector(FORM_INVALID)).toBeNull();
  });
});

const FORM_INVALID = '[aria-invalid="true"], [data-form-invalid="true"]';
