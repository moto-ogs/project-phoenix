import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPersonalStorageLeave,
  leaveForAnotherAccount,
} from "./personal-storage";
import {
  _resetSessionTreeForTests,
  discardSessionTree,
  lockSessionTree,
  onSessionTreeDiscard,
  sessionTreeState,
} from "./session-tree";

beforeEach(() => {
  _resetSessionTreeForTests();
  _resetPersonalStorageLeave();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discardSessionTree (#8082)", () => {
  it("locks the tree with a new epoch and tells the holders above it", () => {
    const discarded = vi.fn();
    const stop = onSessionTreeDiscard(discarded);
    discardSessionTree();
    expect(sessionTreeState()).toEqual({
      epoch: 1,
      leaving: true,
      locked: null,
    });
    expect(discarded).toHaveBeenCalledTimes(1);
    // The document leaves once: a second exit is the same discard.
    discardSessionTree();
    expect(sessionTreeState().epoch).toBe(1);
    stop();
  });

  it("locks the tree for the whole document, once", () => {
    lockSessionTree("unconfirmed");
    expect(sessionTreeState()).toEqual({
      epoch: 1,
      leaving: false,
      locked: "unconfirmed",
    });
    lockSessionTree("changed");
    expect(sessionTreeState().epoch).toBe(1);
  });

  it("discards the tree before leaving for another account's page", () => {
    const order: string[] = [];
    const stop = onSessionTreeDiscard(() => order.push("discard"));
    vi.stubGlobal("location", {
      replace: (href: string) => order.push(`replace ${href}`),
    });
    leaveForAnotherAccount("/home");
    expect(order).toEqual(["discard", "replace /home"]);
    expect(sessionTreeState().leaving).toBe(true);
    stop();
  });
});
