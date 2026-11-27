import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { testClockDay } from "~/test/clock";

const capturedClaims = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "account-a" } } }),
}));
vi.mock("~/lib/swr/server-seed", () => ({
  SWRServerSeed: ({
    claims,
    children,
  }: {
    claims: readonly (string | null)[];
    children: ReactNode;
  }) => {
    capturedClaims(claims);
    return children;
  },
}));

import { HomeSeed } from "./page-seed";

describe("HomeSeed", () => {
  it("claims the dated day-changes server seed", () => {
    render(
      <HomeSeed seed={null} planningSeed={null}>
        <div />
      </HomeSeed>,
    );

    expect(capturedClaims).toHaveBeenCalledWith(
      expect.arrayContaining([`home-day-changes:account-a:${testClockDay(0)}`]),
    );
  });
});
