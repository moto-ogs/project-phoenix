import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "./number-range-format";

describe("formatInvoiceNumber", () => {
  it("pads the running number to the count of N", () => {
    expect(formatInvoiceNumber("FE-{NNNN}", 0, 7)).toBe("FE-0007");
    expect(formatInvoiceNumber("{N}", 0, 7100)).toBe("7100");
  });

  it("keeps a number that is longer than the pattern", () => {
    expect(formatInvoiceNumber("R{NN}", 0, 7100)).toBe("R7100");
  });

  it("writes the year with four or two digits", () => {
    expect(formatInvoiceNumber("FE-{JJJJ}-{NNNN}", 2027, 12)).toBe(
      "FE-2027-0012",
    );
    expect(formatInvoiceNumber("{JJ}/{NNN}", 2027, 12)).toBe("27/012");
  });
});
