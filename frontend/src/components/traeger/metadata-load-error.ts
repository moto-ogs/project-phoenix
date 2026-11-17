import type { FormErrorDetail } from "~/components/ui/form-error";
import { errorAlertActions } from "~/components/ui/form-error-alert";
import { isRefusal } from "./use-traeger-confirmed-resource";

/** A metadata refresh must not unmount a loaded form, except on a refusal. */
export function metadataLoadError<E extends FormErrorDetail>(
  error: E | null,
  hasData: boolean,
  ...failures: unknown[]
) {
  const refused = failures.some(isRefusal);
  if (!error) return error;
  // Without data nothing confirmed is left to keep, whatever an earlier
  // presentation of the same error said.
  return hasData
    ? { ...error, action: errorAlertActions(error), keepContent: !refused }
    : "keepContent" in error && error.keepContent
      ? { ...error, keepContent: false }
      : error;
}
