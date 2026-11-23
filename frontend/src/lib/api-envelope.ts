import type { Pagination } from "./contract/runtime";

/**
 * The success envelope of a JSON answer, as the backend writes it
 * (`common.Response`, `backend/api/common/response.go`). The BFF passes it on
 * with the decoded `data` and invents no envelope of its own (#2353); errors
 * leave in the RFC 9457 body instead (ADR 0006).
 */
export interface ApiResponse<T> {
  status: "success";
  data: T;
  message?: string;
}

/** A paginated success answer (`common.PaginatedResponse`). */
export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: Pagination;
}
