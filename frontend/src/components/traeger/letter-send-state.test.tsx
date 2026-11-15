import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LetterSendState, type LetterSendCounts } from "./letter-send-state";

const counts = (over: Partial<LetterSendCounts>): LetterSendCounts => ({
  letters: 3,
  sent: 0,
  queued: 0,
  failed: 0,
  notSent: 3,
  withoutEmail: 0,
  ...over,
});

describe("LetterSendState announces the end of a send (#7113)", () => {
  it("says nothing while letters go out and the result once they are through", () => {
    const { rerender } = render(
      <LetterSendState summary={counts({ queued: 3, notSent: 0 })} />,
    );
    const region = screen.getByTestId("letter-send-announcement");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();

    rerender(
      <LetterSendState summary={counts({ sent: 2, failed: 1, notSent: 0 })} />,
    );
    expect(region).toHaveTextContent(
      "Der Versand ist fertig. 2 von 3 Schreiben gesendet, 1 nicht angekommen.",
    );
  });

  it("names the notices of the annual run in their own words", () => {
    const noun = { one: "Bescheid", many: "Bescheiden" };
    const { rerender } = render(
      <LetterSendState
        summary={counts({ letters: 1, queued: 1, notSent: 0 })}
        noun={noun}
      />,
    );
    rerender(
      <LetterSendState
        summary={counts({ letters: 1, sent: 1, notSent: 0 })}
        noun={noun}
      />,
    );
    expect(screen.getByTestId("letter-send-announcement")).toHaveTextContent(
      "Der Versand ist fertig. 1 von 1 Bescheid gesendet.",
    );
  });

  it("does not announce a state that was already done when the page opened", () => {
    render(<LetterSendState summary={counts({ sent: 3, notSent: 0 })} />);
    // Anker: the counts are on the screen, so the region is rendered too.
    expect(
      screen.getByText("3 von 3 Schreiben gesendet", { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("letter-send-announcement"),
    ).toBeEmptyDOMElement();
  });

  it("announces a send that finished before the page saw it on its way", () => {
    const { rerender } = render(<LetterSendState summary={counts({})} />);
    rerender(<LetterSendState summary={counts({ sent: 3, notSent: 0 })} />);
    expect(screen.getByTestId("letter-send-announcement")).toHaveTextContent(
      "Der Versand ist fertig. 3 von 3 Schreiben gesendet.",
    );
  });
});
