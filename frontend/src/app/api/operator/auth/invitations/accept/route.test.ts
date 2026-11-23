import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockFetch, mockGetServerApiUrl } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetServerApiUrl: vi.fn(() => "http://localhost:8080"),
}));

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: mockGetServerApiUrl,
}));

global.fetch = mockFetch as unknown as typeof fetch;

import { POST } from "./route";

const FLOW_A = "11111111-1111-4111-8111-111111111111";
const FLOW_B = "22222222-2222-4222-8222-222222222222";

describe("POST /api/operator/auth/invitations/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      answer: "decodable",
      body: {
        status: "success",
        data: { id: "1", email: "operator@example.test", display_name: "Test" },
      },
      status: 200,
    },
    { answer: "undecodable", body: {}, status: 502 },
  ])(
    "ends only the accepted flow with a $answer reply",
    async ({ body, status }) => {
      mockFetch.mockResolvedValueOnce(Response.json(body));

      const request = new NextRequest(
        "http://localhost:3000/api/operator/auth/invitations/accept",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-operator-invitation-flow": FLOW_A,
          },
          body: JSON.stringify({
            display_name: "Test",
            password: "Str0ng!Pass",
            confirm_password: "Str0ng!Pass",
          }),
        },
      );
      request.cookies.set(`operator.invitation-token.${FLOW_A}`, "token-a");
      request.cookies.set(`operator.invitation-token.${FLOW_B}`, "token-b");
      const response = await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/operator/auth/invitations/accept",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            display_name: "Test",
            password: "Str0ng!Pass",
            confirm_password: "Str0ng!Pass",
            token: "token-a",
          }),
        }),
      );
      expect(response.status).toBe(status);
      expect(
        response.cookies.get(`operator.invitation-token.${FLOW_A}`),
      ).toEqual(expect.objectContaining({ value: "", maxAge: 0 }));
      expect(response.cookies.has(`operator.invitation-token.${FLOW_B}`)).toBe(
        false,
      );
    },
  );
});
