import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AbsenceDecisionMail,
  AbsenceRequestMails,
} from "./absence-mail-status";

// #7058: the mails of an absence request stay quiet while they arrive and
// name the next step when they do not. moto cannot send them again.
describe("AbsenceDecisionMail", () => {
  it("shows a delivered decision mail as a quiet pill without a step", () => {
    render(<AbsenceDecisionMail outcome="delivered" question={false} />);

    expect(screen.getByText("Mail zur Entscheidung")).toBeInTheDocument();
    expect(screen.getByText("Zugestellt")).toBeInTheDocument();
    expect(screen.queryByText(/Bescheid/)).not.toBeInTheDocument();
  });

  it("tells the Leitung to speak to the person when the mail bounced", () => {
    render(<AbsenceDecisionMail outcome="undeliverable" question />);

    expect(screen.getByText("Mail zur Rückfrage")).toBeInTheDocument();
    expect(screen.getByText("Nicht zustellbar")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die Mail kam nicht an. Sagen Sie der Person direkt Bescheid.",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing before a mail exists", () => {
    const { container } = render(
      <>
        <p>Antrag</p>
        <AbsenceDecisionMail outcome={undefined} question={false} />
      </>,
    );

    expect(screen.getByText("Antrag")).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="absence-mail-status"]'),
    ).toBeNull();
  });
});

describe("AbsenceRequestMails", () => {
  it("counts the notices to the Leitung and names the step for a bounce", () => {
    render(<AbsenceRequestMails counts={{ delivered: 2, undeliverable: 1 }} />);

    expect(screen.getByText("Mail an die Leitung")).toBeInTheDocument();
    expect(screen.getByText("1 nicht zustellbar")).toBeInTheDocument();
    expect(screen.getByText("2 zugestellt")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Eine Mail kam nicht an. Sagen Sie der Leitung direkt Bescheid.",
      ),
    ).toBeInTheDocument();
  });

  it("stays quiet while the notices are on their way", () => {
    render(<AbsenceRequestMails counts={{ queued: 2 }} />);

    expect(screen.getByText("2 werden gesendet")).toBeInTheDocument();
    expect(screen.queryByText(/Bescheid/)).not.toBeInTheDocument();
  });
});
