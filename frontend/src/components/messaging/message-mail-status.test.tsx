import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  GroupMessageMailBadges,
  MessageMailBadge,
  groupMessageMailNote,
  messageMailNote,
} from "./message-mail-status";

describe("MessageMailBadge (#7058)", () => {
  it("names the mail's result and tells a reader it is the e-mail", () => {
    render(<MessageMailBadge outcome="delivered" />);
    expect(screen.getByText("Zugestellt")).toBeInTheDocument();
    expect(screen.getByText("E-Mail")).toBeVisible();
  });

  it("stays away while no mail exists", () => {
    const { container } = render(
      <div data-testid="slot">
        <MessageMailBadge />
      </div>,
    );
    expect(screen.getByTestId("slot")).toBeEmptyDOMElement();
    expect(container).toHaveTextContent("");
  });
});

describe("messageMailNote", () => {
  it("points to the guardian card when the mail did not arrive", () => {
    expect(messageMailNote("undeliverable")).toBe(
      "Die Mail kam nicht an. Korrigieren Sie die Adresse beim Kind unter „Erziehungsberechtigte“.",
    );
  });

  it("asks for no second mail while the server still tries", () => {
    expect(messageMailNote("delayed")).toMatch(/nicht noch einmal/);
  });

  it("says nothing when the mail is fine or only on its way", () => {
    expect(messageMailNote("delivered")).toBeNull();
    expect(messageMailNote("accepted")).toBeNull();
    expect(messageMailNote("queued")).toBeNull();
    expect(messageMailNote(undefined)).toBeNull();
  });
});

describe("GroupMessageMailBadges", () => {
  it("shows the problem first, then the families that got the mail", () => {
    render(
      <GroupMessageMailBadges counts={{ delivered: 11, undeliverable: 1 }} />,
    );
    const pills = screen.getByTestId("group-message-mails");
    expect(pills).toHaveTextContent("·E-Mails1 nicht zustellbar11 zugestellt");
  });

  it("names a refused mail and where to find the address", () => {
    expect(groupMessageMailNote({ delivered: 3, undeliverable: 2 })).toBe(
      "2 Mails kamen nicht an. Welche Adresse betroffen ist, sehen Sie beim Kind unter „Erziehungsberechtigte“.",
    );
    expect(groupMessageMailNote({ delivered: 3 })).toBeNull();
  });
});
