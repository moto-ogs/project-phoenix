import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  TraegerBookedModulesProvider,
  useTraegerModuleBooked,
  type TraegerBookedModules,
} from "./traeger-booked-modules";

function bookedWith(value: TraegerBookedModules | undefined) {
  return renderHook(() => useTraegerModuleBooked("elternbeitraege"), {
    wrapper: ({ children }: { children: ReactNode }) =>
      value ? (
        <TraegerBookedModulesProvider value={value}>
          {children}
        </TraegerBookedModulesProvider>
      ) : (
        children
      ),
  }).result.current;
}

describe("useTraegerModuleBooked (#6052)", () => {
  it("follows the booked modules of the frame", () => {
    expect(bookedWith({ modules: ["elternbeitraege"], settled: true })).toBe(
      true,
    );
    expect(bookedWith({ modules: ["vertraege"], settled: true })).toBe(false);
  });

  it("answers nothing yet while the frame loads", () => {
    expect(bookedWith({ modules: null, settled: false })).toBeNull();
  });

  it("counts the module as booked when the frame could not be read or is absent", () => {
    // The backend locks its routes itself; the page must not lose a card
    // for good because one read of the frame failed.
    expect(bookedWith({ modules: null, settled: true })).toBe(true);
    expect(bookedWith(undefined)).toBe(true);
  });
});
