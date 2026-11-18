import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProbeView } from "./use-probe-view";

interface Props {
  readonly generation: number;
  readonly marker: unknown;
  readonly next: string | undefined;
}

function renderProbeView(initialProps: Props) {
  return renderHook(
    ({ generation, marker, next }: Props) =>
      useProbeView("leer", generation, marker, next),
    { initialProps },
  );
}

describe("useProbeView", () => {
  it("follows a new answer and keeps it while the next one is pending", () => {
    const first = {};
    const view = renderProbeView({ generation: 0, marker: first, next: "A" });
    expect(view.result.current.view).toBe("A");

    view.rerender({ generation: 0, marker: undefined, next: undefined });
    expect(view.result.current.view).toBe("A");

    view.rerender({ generation: 0, marker: {}, next: "B" });
    expect(view.result.current.view).toBe("B");
  });

  it("keeps the pre-save answer until the read reports something new", () => {
    const answer = {};
    const view = renderProbeView({ generation: 0, marker: answer, next: "A" });

    act(() => view.result.current.override("vor dem Speichern"));
    view.rerender({ generation: 0, marker: answer, next: "A" });
    expect(view.result.current.view).toBe("vor dem Speichern");

    view.rerender({ generation: 0, marker: {}, next: "C" });
    expect(view.result.current.view).toBe("C");
  });

  it("starts over for a new form and then shows the read's current answer", () => {
    const answer = {};
    const view = renderProbeView({ generation: 0, marker: answer, next: "A" });

    view.rerender({ generation: 1, marker: undefined, next: undefined });
    expect(view.result.current.view).toBe("leer");

    // The same cached answer applies again in the new generation.
    view.rerender({ generation: 1, marker: answer, next: "A" });
    expect(view.result.current.view).toBe("A");
  });
});
