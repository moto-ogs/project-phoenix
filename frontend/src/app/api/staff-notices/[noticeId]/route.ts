import type { NextRequest } from "next/server";
import { apiDelete, apiGet, apiPut } from "~/lib/api-helpers.server";
import {
  createDeleteHandler,
  createGetHandler,
  createPutHandler,
} from "~/lib/route-wrapper.server";

function noticeID(params: Record<string, unknown>): string {
  const id = params.noticeId as string;
  if (!id) throw new Error("Notice ID is required");
  return id;
}

/**
 * Proxy GET /api/staff-notices/{id} → Backend. Ein einzelner Hinweis für den
 * Link aus der Glocke (#7143); lesen darf ihn das ganze Team (users:read).
 */
export const GET = createGetHandler(
  async (
    _request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const response = await apiGet<{ data: unknown }>(
      `/api/staff-notices/${encodeURIComponent(noticeID(params))}`,
      token,
    );
    return response.data;
  },
);

/** Proxy PUT /api/staff-notices/{id} → Backend (Inhalt und Wiederholung). */
export const PUT = createPutHandler(
  async (
    _request: NextRequest,
    body: unknown,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const response = await apiPut<{ data: unknown }>(
      `/api/staff-notices/${encodeURIComponent(noticeID(params))}`,
      token,
      body,
    );
    return response.data;
  },
);

/** Proxy DELETE /api/staff-notices/{id} → Backend. */
export const DELETE = createDeleteHandler(
  async (
    _request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const response = await apiDelete<{ data: unknown }>(
      `/api/staff-notices/${encodeURIComponent(noticeID(params))}`,
      token,
    );
    return response?.data ?? null;
  },
);
