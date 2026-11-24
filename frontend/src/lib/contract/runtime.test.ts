import { expect, it } from "vitest";
import { int64String } from "./runtime";

it("keeps signed int64 endpoints exact and rejects overflow", () => {
  for (const value of ["-9223372036854775808", "9223372036854775807", "0"]) {
    expect(int64String.parse(value)).toBe(value);
  }
  for (const value of ["-9223372036854775809", "9223372036854775808", "01"]) {
    expect(int64String.safeParse(value).success).toBe(false);
  }
});
