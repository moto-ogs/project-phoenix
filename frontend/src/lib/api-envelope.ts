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

/** The page of a paginated list (`common.Pagination`). */
interface ApiPagination {
  current_page: number;
  page_size: number;
  total_pages: number;
  total_records: number;
}

/** A paginated success answer (`common.PaginatedResponse`). */
export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: ApiPagination;
}
