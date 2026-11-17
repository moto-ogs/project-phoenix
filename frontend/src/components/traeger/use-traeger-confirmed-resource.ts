"use client";

// Shared refusal handling also protects school-portal reads.
export {
  isRefusal,
  useConfirmedResource,
  useRefusalGuard,
  type RefusalGuard,
} from "~/lib/hooks/use-confirmed-resource";
