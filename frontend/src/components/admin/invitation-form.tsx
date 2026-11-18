"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { EmploymentCarryover } from "./invitation-employment-carryover";
import { Alert } from "~/components/ui/alert";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { CustomSelect } from "~/components/ui/custom-select";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Button } from "~/components/ui/button";
import { FieldLabel } from "~/components/ui/field-label";
import { Input } from "~/components/ui/input";
import { SuggestInput } from "~/components/ui/suggest-input";
import { authService } from "~/lib/auth-service";
import { toAssignableRoleOptions, type RoleOption } from "~/lib/auth-helpers";
import { formatDate } from "~/lib/date-helpers";
import { createInvitation, findFormerEmployment } from "~/lib/invitation-api";
import {
  FORMER_EMPLOYMENT_PART_LABELS,
  type CreateInvitationRequest,
  type EmploymentAction,
  type FormerEmployment,
  type FormerEmploymentPart,
  type PendingInvitation,
} from "~/lib/invitation-helpers";
import { looksLikeEmail } from "~/lib/email-format";
import { createLogger } from "~/lib/logger";
import { useFreshSWR, useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { useDebounce } from "~/lib/use-debounce";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";

const logger = createLogger({ component: "InvitationForm" });

interface InvitationFormProps {
  readonly onCreated?: (invitation: PendingInvitation) => void;
  readonly existingPositions?: readonly string[];
}

const EMPTY_POSITIONS: readonly string[] = [];

const FORMER_EMPLOYMENT_DEBOUNCE_MS = 400;
const FORMER_EMPLOYMENT_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * The former employment an invitation to the typed address would continue
 * at this school (ADR 0021, #3402), or null. A result belongs to the address
 * it was asked for, so it disappears as soon as the address changes.
 */
function useFormerEmployment(email: string): {
  formerEmployment: FormerEmployment | null;
  pending: boolean;
} {
  const current = email.trim().toLowerCase();
  const address = useDebounce(current, FORMER_EMPLOYMENT_DEBOUNCE_MS);
  // Each address asks anew, also when the person returns to one: a
  // Wiederaufnahme must not rest on an earlier answer.
  const lookup = useFreshSWR(
    looksLikeEmail(address) ? enrollmentKeys.formerEmployment(address) : null,
    async () => {
      const controller = new AbortController();
      const timeoutID = globalThis.setTimeout(
        () => controller.abort(),
        FORMER_EMPLOYMENT_LOOKUP_TIMEOUT_MS,
      );
      try {
        return await findFormerEmployment(address, controller.signal);
      } finally {
        globalThis.clearTimeout(timeoutID);
      }
    },
    {
      shouldRetryOnError: false,
      // Without a successful lookup there is no choice to offer. Keep the
      // existing invitation behavior; sending reports its own form errors.
      onError: (err) => {
        logger.warn("former_employment_lookup_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      },
    },
  );
  const answered = address === current && lookup.fresh;

  return {
    formerEmployment: answered ? (lookup.data ?? null) : null,
    pending: looksLikeEmail(current) && !answered,
  };
}

function formerEmploymentParts(parts: readonly FormerEmploymentPart[]): string {
  return parts.map((part) => FORMER_EMPLOYMENT_PART_LABELS[part]).join(", ");
}

function FormerEmploymentHint({
  formerEmployment,
  action,
  onActionChange,
  reset,
  onResetChange,
  disabled,
}: {
  readonly formerEmployment: FormerEmployment;
  readonly action: EmploymentAction;
  readonly onActionChange: (action: EmploymentAction) => void;
  readonly disabled: boolean;
  readonly reset: CreateInvitationRequest;
  readonly onResetChange: (
    key: "resetMasterData" | "resetQualifications" | "resetWorkTime",
    value: boolean,
  ) => void;
}) {
  const notReturning = formerEmploymentParts(formerEmployment.notReturning);
  return (
    <Alert
      type="info"
      title="Diese Person war schon bei dir beschäftigt"
      message={`In moto eingetragen vom ${formatDate(formerEmployment.startedOn)} bis ${formatDate(formerEmployment.endedOn)}.`}
      details={
        <div className="mt-2 space-y-2">
          <SegmentedControl
            ariaLabel="Beschäftigung bei Rückkehr"
            className="max-sm:grid-flow-row"
            value={action}
            onChange={onActionChange}
            fullWidth
            items={[
              { value: "resume", label: "Wiederaufnahme", disabled },
              { value: "new", label: "Neuaufnahme", disabled },
            ]}
          />
          <p>
            {action === "resume"
              ? "Die frühere Beschäftigung wird fortgeführt."
              : "Eine neue Beschäftigung beginnt. Die frühere bleibt beendet."}
          </p>
          {action === "new" ? (
            <p>
              Stammdaten, Qualifikationen, Stundenkonto und Urlaub beginnen neu.
            </p>
          ) : null}
          {action === "resume" ? (
            <EmploymentCarryover
              value={reset}
              onChange={onResetChange}
              disabled={disabled}
            />
          ) : null}
          {notReturning ? (
            <p>
              <span className="font-semibold">Kommt nicht zurück:</span>{" "}
              <span>{notReturning}</span>
            </p>
          ) : null}
          <p>Gruppen, Klassen und Vertretungen legst du danach neu fest.</p>
        </div>
      }
    />
  );
}

const initialForm: CreateInvitationRequest = {
  email: "",
  roleId: undefined,
  firstName: "",
  lastName: "",
  position: "",
};

export function InvitationForm({
  onCreated,
  existingPositions = EMPTY_POSITIONS,
}: InvitationFormProps) {
  const [form, setForm] = useState<CreateInvitationRequest>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Every failure of this form, validation included, comes from the server
  // and is shown on the shared error path (#2511): the message in the alert
  // at the top, each failed field marked at the field.
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const showError = errors.show;
  const clearErrors = errors.clear;

  const { formerEmployment, pending: checkingAddress } = useFormerEmployment(
    form.email,
  );

  const [successInfo, setSuccessInfo] = useState<{
    email: string;
    link: string;
  } | null>(null);
  const { success: toastSuccess } = useToast();

  const {
    data: roleList,
    error: rolesError,
    mutate: mutateRoles,
  } = useSWRAuth(enrollmentKeys.roles(), () => authService.getRoles());
  const roles = useMemo<RoleOption[]>(
    () => (roleList ? toAssignableRoleOptions(roleList) : []),
    [roleList],
  );
  const isLoadingRoles = !roleList && !rolesError;
  // A failed role list stands in the form's alert; a later answer clears it.
  const rolesErrorShown = useRef(false);
  useEffect(() => {
    if (roleList) {
      if (!rolesErrorShown.current) return;
      rolesErrorShown.current = false;
      clearErrors();
      return;
    }
    if (!rolesError) return;
    rolesErrorShown.current = true;
    void showError(rolesError, {
      object: "die Rollenauswahl",
      retry: () => void mutateRoles(),
    });
  }, [roleList, rolesError, clearErrors, showError, mutateRoles]);

  const inviteBaseUrl = useMemo(() => {
    if (typeof globalThis !== "undefined" && "location" in globalThis) {
      return globalThis.location.origin;
    }
    return "";
  }, []);

  const handleChange =
    (key: keyof CreateInvitationRequest) => (value: string | undefined) => {
      setForm((prev) => ({
        ...prev,
        ...(key === "email"
          ? {
              employmentAction: undefined,
              resetMasterData: undefined,
              resetQualifications: undefined,
              resetWorkTime: undefined,
            }
          : {}),
        [key]: value,
      }));
    };

  const toOptional = (value?: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const sendInvitation = async () => {
    errors.clear();
    setSuccessInfo(null);
    try {
      setIsSubmitting(true);
      const invitation = await createInvitation({
        email: form.email.trim(),
        roleId: form.roleId,
        firstName: toOptional(form.firstName),
        lastName: toOptional(form.lastName),
        position: toOptional(form.position),
        ...(formerEmployment
          ? {
              employmentAction: form.employmentAction ?? "resume",
              ...((form.employmentAction ?? "resume") === "resume"
                ? {
                    resetMasterData: form.resetMasterData ?? false,
                    resetQualifications: form.resetQualifications ?? false,
                    resetWorkTime: form.resetWorkTime ?? false,
                  }
                : {}),
            }
          : {}),
      });

      const link = inviteBaseUrl
        ? `${inviteBaseUrl}/invite?token=${encodeURIComponent(invitation.token ?? "")}`
        : (invitation.token ?? "");
      setSuccessInfo({ email: invitation.email, link });
      toastSuccess(`Einladung an ${invitation.email} wurde gesendet.`);
      setForm(() => initialForm);
      if (onCreated) {
        onCreated(invitation);
      }
    } catch (err) {
      logger.warn("invitation_create_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await errors.show(err, {
        object: "die Einladung",
        // Erneut absenden: derselbe Weg wie „Einladung senden“, mit den
        // Eingaben von jetzt, nicht denen vom Zeitpunkt des Fehlers.
        retry: () => formRef.current?.requestSubmit(),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!checkingAddress) void sendInvitation();
  };

  const roleError = errors.fieldError("role_id");

  return (
    <SectionCard
      title="Neue Einladung"
      description="Per E-Mail einladen"
      icon={Mail}
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <FormErrorAlert message={errors.error} />

        {successInfo && (
          <div className="space-y-2">
            <InsetPanel framed padding="compact">
              <p className="font-mono text-xs break-all text-gray-600">
                {successInfo.link}
              </p>
            </InsetPanel>
          </div>
        )}

        <Input
          id="invitation-email"
          name="email"
          label="E-Mail-Adresse"
          type="email"
          value={form.email}
          onChange={(event) => handleChange("email")(event.target.value)}
          disabled={isSubmitting}
          required
          error={errors.fieldError("email")}
        />

        {formerEmployment ? (
          <FormerEmploymentHint
            formerEmployment={formerEmployment}
            action={form.employmentAction ?? "resume"}
            reset={form}
            onResetChange={(key, value) =>
              setForm((prev) => ({ ...prev, [key]: value }))
            }
            onActionChange={(employmentAction) =>
              setForm((prev) => ({ ...prev, employmentAction }))
            }
            disabled={isSubmitting}
          />
        ) : null}

        <div>
          <FieldLabel
            id="invitation-role-label"
            htmlFor="invitation-role"
            required
            invalid={Boolean(roleError)}
          >
            Rolle
          </FieldLabel>
          <CustomSelect
            id="invitation-role"
            name="role_id"
            ariaLabelledBy="invitation-role-label"
            ariaDescribedBy={roleError ? "invitation-role-error" : undefined}
            value={form.roleId ?? ""}
            onChange={(next) => handleChange("roleId")(next || undefined)}
            options={roles.map((role) => ({
              value: role.id,
              label: role.name,
            }))}
            placeholder="Rolle auswählen..."
            invalid={Boolean(roleError)}
            disabled={isSubmitting || isLoadingRoles}
          />
          <FieldErrorHint id="invitation-role-error" message={roleError} live />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="invitation-first-name"
            name="first_name"
            label="Vorname (optional)"
            value={form.firstName}
            onChange={(event) => handleChange("firstName")(event.target.value)}
            disabled={isSubmitting}
            error={errors.fieldError("first_name")}
          />
          <Input
            id="invitation-last-name"
            name="last_name"
            label="Nachname (optional)"
            value={form.lastName}
            onChange={(event) => handleChange("lastName")(event.target.value)}
            disabled={isSubmitting}
            error={errors.fieldError("last_name")}
          />
        </div>

        <div>
          <SuggestInput
            id="invitation-position"
            name="position"
            label="Position (optional)"
            value={form.position ?? ""}
            onValueChange={(position) =>
              handleChange("position")(position || undefined)
            }
            suggestions={existingPositions}
            listLabel="Vorschläge für die Position"
            placeholder="z.B. Pädagogische Fachkraft, OGS-Büro"
            disabled={isSubmitting}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          data-setup-tour="invite-submit"
          disabled={isSubmitting || isLoadingRoles || checkingAddress}
          tooltip="Schickt sofort eine E-Mail mit Link, Zugang gibt es nach dem Annehmen."
          className="w-full"
        >
          {isSubmitting
            ? "Wird gesendet…"
            : checkingAddress
              ? "Adresse wird geprüft…"
              : "Einladung senden"}
        </Button>
      </form>
    </SectionCard>
  );
}
