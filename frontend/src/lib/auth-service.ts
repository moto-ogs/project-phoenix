import api from "./api-transport";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "AuthService" });
import {
  mapRoleResponse,
  mapPermissionResponse,
  type Role,
  type Permission,
  type BackendRole,
  type BackendPermission,
} from "./auth-helpers";
import { apiErrorFromText } from "./api-error";

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

type HttpMethod = "GET" | "PUT";

interface AuthFetchOptions<TBackend, TFrontend> {
  /** HTTP method (default: GET) */
  method?: HttpMethod;
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Map backend response to frontend type. If omitted, returns void. */
  mapper?: (data: TBackend) => TFrontend;
  /** Whether this endpoint requires authentication (default: true) */
  requiresAuth?: boolean;
  /** Custom error message prefix for logging */
  errorPrefix?: string;
  /** Extract data from nested response structure (default: extract from .data) */
  extractData?: (response: unknown) => TBackend;
}

/**
 * Headers for browser-side fetch requests. The BFF routes authenticate
 * through the session cookie; the browser holds no token (#5005).
 */
const BROWSER_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

/**
 * Execute fetch request in browser context.
 * Returns null for 204/empty responses (void endpoints).
 */
async function executeBrowserFetch<TBackend>(
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body: unknown,
  errorPrefix: string,
): Promise<TBackend | null> {
  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("api error during auth operation", {
      operation: errorPrefix,
      status: response.status,
      error_text: errorText.substring(0, 200),
    });
    throw apiErrorFromText(
      `${errorPrefix} failed: ${response.status}`,
      response.status,
      errorText,
    );
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as TBackend;
}

/**
 * Execute axios request in server context.
 */
async function executeServerFetch<TBackend>(
  url: string,
  method: HttpMethod,
  body: unknown,
  requiresAuth: boolean,
): Promise<ApiResponse<TBackend>> {
  const config = requiresAuth ? undefined : {};

  switch (method) {
    case "GET":
      return (await api.get<ApiResponse<TBackend>>(url, config)).data;
    case "PUT":
      return (await api.put<ApiResponse<TBackend>>(url, body, config)).data;
  }
}

/**
 * Generic helper for auth service API calls.
 * Handles proxy vs direct API calls, authentication, error handling, and response mapping.
 */
async function authFetch<TBackend, TFrontend = void>(
  endpoint: string,
  options: AuthFetchOptions<TBackend, TFrontend> = {},
): Promise<TFrontend> {
  const {
    method = "GET",
    body,
    mapper,
    requiresAuth = true,
    errorPrefix = endpoint,
    extractData,
  } = options;

  const useProxyApi = globalThis.window !== undefined;
  const url = `/api${endpoint}`;

  try {
    let backendData: TBackend;

    if (useProxyApi) {
      const responseData = await executeBrowserFetch<unknown>(
        url,
        method,
        BROWSER_HEADERS,
        body,
        errorPrefix,
      );

      if (responseData === null) {
        return undefined as TFrontend;
      }

      backendData = extractData
        ? extractData(responseData)
        : (responseData as ApiResponse<TBackend>).data;
    } else {
      const responseData = await executeServerFetch<TBackend>(
        url,
        method,
        body,
        requiresAuth,
      );

      // Apply extractData on server path (matches browser behavior)
      backendData = extractData ? extractData(responseData) : responseData.data;
    }

    return mapper ? mapper(backendData) : (undefined as TFrontend);
  } catch (error) {
    logger.error("auth operation error", {
      operation: errorPrefix,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Helper for array responses that need mapping.
 */
async function authFetchList<TBackend, TFrontend>(
  endpoint: string,
  mapper: (data: TBackend) => TFrontend,
  options: Omit<AuthFetchOptions<TBackend[], TFrontend[]>, "mapper"> = {},
): Promise<TFrontend[]> {
  return authFetch<TBackend[], TFrontend[]>(endpoint, {
    ...options,
    mapper: (data) => data.map(mapper),
  });
}

/**
 * Helper for void responses (PUT requests that don't return data).
 */
async function authFetchVoid(
  endpoint: string,
  options: Omit<AuthFetchOptions<unknown, void>, "mapper"> = {},
): Promise<void> {
  await authFetch<unknown, void>(endpoint, options);
}

/**
 * Extract permissions from nested response structures.
 * Handles: { data: [] }, { data: { data: [] } }
 */
function extractNestedPermissions(response: unknown): BackendPermission[] {
  const data = response as {
    data?: { data?: BackendPermission[] } | BackendPermission[];
  };

  if (
    data?.data &&
    typeof data.data === "object" &&
    "data" in data.data &&
    Array.isArray(data.data.data)
  ) {
    return data.data.data;
  }
  if (data?.data && Array.isArray(data.data)) {
    return data.data;
  }
  logger.error("unexpected permissions response structure", {
    response_type: typeof response,
  });
  throw new Error("Invalid response format from permissions API");
}

/**
 * Extract roles from nested response structures.
 * Handles: [], { data: [] }, { data: { data: [] } }
 */
function extractNestedRoles(response: unknown): BackendRole[] {
  if (Array.isArray(response)) {
    return response as BackendRole[];
  }

  const data = response as {
    data?: { data?: BackendRole[] } | BackendRole[];
  };

  if (
    data?.data &&
    typeof data.data === "object" &&
    "data" in data.data &&
    Array.isArray(data.data.data)
  ) {
    return data.data.data;
  }
  if (data?.data && Array.isArray(data.data)) {
    return data.data;
  }
  logger.error("unexpected roles response structure", {
    response_type: typeof response,
  });
  throw new Error("Invalid response format from roles API");
}

export const authService = {
  getRoles: async (filters?: { name?: string }): Promise<Role[]> => {
    const params = new URLSearchParams();
    if (filters?.name) params.append("name", filters.name);
    const queryString = params.toString();
    const endpoint = queryString ? `/auth/roles?${queryString}` : "/auth/roles";
    return authFetchList<BackendRole, Role>(endpoint, mapRoleResponse, {
      errorPrefix: "Get roles",
    });
  },

  getRolePermissions: async (roleId: string): Promise<Permission[]> =>
    authFetchList<BackendPermission, Permission>(
      `/auth/roles/${roleId}/permissions`,
      mapPermissionResponse,
      {
        extractData: extractNestedPermissions,
        errorPrefix: "Get role permissions",
      },
    ),

  replaceRolePermissions: async (
    roleId: string,
    permissionIds: readonly string[],
  ): Promise<void> =>
    authFetchVoid(`/auth/roles/${roleId}/permissions`, {
      method: "PUT",
      body: { permission_ids: permissionIds },
      errorPrefix: "Replace role permissions",
    }),

  getPermissions: async (filters?: {
    resource?: string;
    action?: string;
  }): Promise<Permission[]> => {
    const params = new URLSearchParams();
    if (filters?.resource) params.append("resource", filters.resource);
    if (filters?.action) params.append("action", filters.action);
    const queryString = params.toString();
    const endpoint = queryString
      ? `/auth/permissions?${queryString}`
      : "/auth/permissions";
    return authFetchList<BackendPermission, Permission>(
      endpoint,
      mapPermissionResponse,
      { errorPrefix: "Get permissions" },
    );
  },

  /**
   * Macht `roleId` zur einzigen Systemrolle des Kontos an dieser Schule.
   * Andere Systemrollen entfernt das Backend; Elternzugang (guardian) bleibt.
   */
  replaceAccountRole: async (
    accountId: string,
    roleId: string,
  ): Promise<void> =>
    authFetchVoid(`/auth/accounts/${accountId}/roles`, {
      method: "PUT",
      body: { role_id: roleId },
      errorPrefix: "Replace account role",
    }),

  getAccountRoles: async (accountId: string): Promise<Role[]> =>
    authFetchList<BackendRole, Role>(
      `/auth/accounts/${accountId}/roles`,
      mapRoleResponse,
      {
        extractData: extractNestedRoles,
        errorPrefix: "Get account roles",
      },
    ),
};
