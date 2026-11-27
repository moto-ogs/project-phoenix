import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOnVisible } from "./use-on-visible";

type Callback = (entries: { isIntersecting: boolean }[]) => void;

const observers: { callback: Callback; disconnect: () => void }[] = [];

function installObserver() {
  class FakeObserver {
    readonly disconnect = vi.fn();
    constructor(callback: Callback) {
      observers.push({ callback, disconnect: this.disconnect });
    }
    observe() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
}

function Sentinel({
  onVisible,
  enabled = true,
}: Readonly<{ onVisible: () => void; enabled?: boolean }>) {
  const ref = useOnVisible(onVisible, enabled);
  return <div ref={ref} data-testid="sentinel" />;
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("useOnVisible", () => {
  it("calls back when the element becomes visible", () => {
    installObserver();
    const onVisible = vi.fn();
    render(<Sentinel onVisible={onVisible} />);

    expect(observers).toHaveLength(1);
    act(() => observers[0]?.callback([{ isIntersecting: false }]));
    expect(onVisible).not.toHaveBeenCalled();
    act(() => observers[0]?.callback([{ isIntersecting: true }]));
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("observes nothing while disabled and stops on unmount", () => {
    installObserver();
    const { rerender, unmount } = render(
      <Sentinel onVisible={vi.fn()} enabled={false} />,
    );
    expect(screen.getByTestId("sentinel")).toBeInTheDocument();
    expect(observers).toHaveLength(0);

    rerender(<Sentinel onVisible={vi.fn()} />);
    expect(observers).toHaveLength(1);
    unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it("renders without observing when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onVisible = vi.fn();
    render(<Sentinel onVisible={onVisible} />);
    expect(screen.getByTestId("sentinel")).toBeInTheDocument();
    expect(onVisible).not.toHaveBeenCalled();
  });
});
