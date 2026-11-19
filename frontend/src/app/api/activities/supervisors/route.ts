// app/api/activities/supervisors/route.ts
//
// Temporary (#7563): the current client reads the contract's
// GET /api/activities/supervisors/available through the catalog proxy. An
// installed bundle of the previous release still calls this path and reads
// {id, name}. Delete this file after the next production deploy.
import type { NextRequest } from "next/server";
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";

// Helper: Safely extract ID from unknown object
function extractIdFromUnknown(data: unknown): string {
  if (!data || typeof data !== "object" || !("id" in data)) {
    return "0";
  }
  const rawId = data.id;
  if (rawId === undefined || rawId === null) {
    return "0";
  }
  if (typeof rawId === "string" || typeof rawId === "number") {
    return String(rawId);
  }
  return "0";
}

// Helper: Format first and last name safely
function formatFullNameSafe(firstName: unknown, lastName: unknown): string {
  const first = typeof firstName === "string" ? firstName : "";
  const last = typeof lastName === "string" ? lastName : "";
  return `${first} ${last}`.trim();
}

// Helper: Check if object has person property with names
function hasPersonWithNames(
  data: unknown,
): data is { person: { first_name: unknown; last_name: unknown } } {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const obj = data as { person?: unknown };
  return (
    "person" in obj &&
    obj.person != null &&
    typeof obj.person === "object" &&
    "first_name" in obj.person &&
    "last_name" in obj.person
  );
}

// Helper: Check if object has direct first_name/last_name
function hasDirectNames(
  data: unknown,
): data is { first_name: unknown; last_name: unknown } {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const obj = data as { first_name?: unknown; last_name?: unknown };
  return (
    "first_name" in obj &&
    "last_name" in obj &&
    !!obj.first_name &&
    !!obj.last_name
  );
}

// Helper: Check if object has name property
function hasNameProperty(data: unknown): data is { name: unknown } {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const obj = data as { name?: unknown };
  return "name" in obj && !!obj.name;
}

// Helper: Extract name from unknown supervisor data
function extractSupervisorName(data: unknown, id: string): string {
  if (hasPersonWithNames(data)) {
    return formatFullNameSafe(data.person.first_name, data.person.last_name);
  }
  if (hasDirectNames(data)) {
    return formatFullNameSafe(data.first_name, data.last_name);
  }
  if (hasNameProperty(data)) {
    const name = data.name;
    if (typeof name === "string") return name;
    if (typeof name === "number") return String(name);
    return "Unknown";
  }
  return `Supervisor ${id}`;
}

function mapSupervisorResponse(backendSupervisor: unknown): {
  id: string;
  name: string;
} {
  if (!backendSupervisor) {
    return { id: "0", name: "Unknown Supervisor" };
  }

  const id = extractIdFromUnknown(backendSupervisor);
  const name = extractSupervisorName(backendSupervisor, id);

  return { id, name };
}

interface FallbackSupervisor {
  id: number | string;
  first_name?: string;
  last_name?: string;
  person?: {
    first_name?: string;
    last_name?: string;
  };
}

function getFallbackSupervisorName(supervisor: FallbackSupervisor): string {
  const firstName = supervisor.first_name ?? supervisor.person?.first_name;
  const lastName = supervisor.last_name ?? supervisor.person?.last_name;

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }

  return `Teacher ${supervisor.id}`;
}

/**
 * Handler for GET /api/activities/supervisors
 * Returns a list of available supervisors (teachers/staff)
 */
export const GET = createGetHandler(
  async (request: NextRequest, token: string) => {
    // Try fetching from the backend activities API endpoint first
    try {
      const response = await apiGet<{ data?: unknown[] } | unknown[]>(
        "/api/activities/supervisors/available",
        token,
      );

      // Handle response structure with more flexible error checking
      if (response) {
        // If response has a data property that is an array
        if (
          typeof response === "object" &&
          "data" in response &&
          Array.isArray(response.data)
        ) {
          const mapped = response.data.map((item: unknown) =>
            mapSupervisorResponse(item),
          );
          return mapped;
        }
        // If response itself is an array
        else if (Array.isArray(response)) {
          const mapped = response.map((item: unknown) =>
            mapSupervisorResponse(item),
          );
          return mapped;
        }
      }
    } catch {
      // Fall through to try the staff endpoint
    }

    // Try fetching from the canonical caregiver pool as a fallback
    try {
      const response = await apiGet<
        { data?: FallbackSupervisor[] } | FallbackSupervisor[]
      >("/api/staff/by-role?role=user", token);

      // Handle response structure with more flexible checking
      if (response) {
        // If response has a data property that is an array
        if (
          typeof response === "object" &&
          "data" in response &&
          Array.isArray(response.data)
        ) {
          const mapped = response.data.map((supervisor) => ({
            id: String(supervisor.id),
            name: getFallbackSupervisorName(supervisor),
          }));
          return mapped;
        }
        // If response itself is an array
        else if (Array.isArray(response)) {
          const mapped = response.map((supervisor) => ({
            id: String(supervisor.id),
            name: getFallbackSupervisorName(supervisor),
          }));
          return mapped;
        }
      }
    } catch {
      // Fall through to return empty array
    }

    // If all API calls failed, return empty array
    return [];
  },
);
