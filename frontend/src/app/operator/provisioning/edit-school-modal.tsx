import { useState, useCallback, useEffect, useRef } from "react";
import { SectionLabel } from "~/components/ui/section-label";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Modal } from "~/components/ui/modal";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { useApiFormError } from "~/contexts/ToastContext";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import { isValidSlug } from "~/lib/operator/provisioning-helpers";
import type {
  Organization,
  School,
  SchoolRequiredDetails,
} from "~/lib/operator/provisioning-helpers";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import { CustomSelect } from "~/components/ui/custom-select";
import {
  FormField,
  FieldWarning,
  VisibilityToggle,
} from "./provisioning-shared";

import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";

const logger = createLogger({ component: "EditSchoolModal" });

/** The fields the operator edits; every save sends all of them back. */
interface SchoolDraft {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly subdomain: string;
  readonly address: string;
  readonly city: string;
  readonly zip: string;
  readonly phone: string;
  readonly email: string;
  readonly hidden: boolean;
}

function schoolDraftOf(school: School): SchoolDraft {
  return {
    organizationId: school.organizationId,
    name: school.name,
    slug: school.slug,
    subdomain: school.subdomain,
    address: school.address ?? "",
    city: school.city ?? "",
    zip: school.zip ?? "",
    phone: school.phone ?? "",
    email: school.email ?? "",
    hidden: school.hidden,
  };
}

export function EditSchoolModal({
  isOpen,
  onClose,
  school,
  organizations,
  onUpdated,
  requiredDetails,
  reload,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly school: School | null;
  /** Reads the school again after a refused save; rejects on failure. */
  readonly reload: () => Promise<School>;
  readonly organizations: Organization[] | undefined;
  /** Reloads the school and the portal caches of the given subdomains;
   *  never rejects (#6652). */
  readonly onUpdated: RefreshAfterWrite<[subdomains: readonly string[]]>;
  /** Marks a school whose parent replies have no address (#7174). */
  readonly requiredDetails?: SchoolRequiredDetails;
}) {
  // The fields rest on the school as the modal opened it (ADR 0311): a newer
  // read refills them only while untouched, a refused save shows the stored
  // school, and nothing goes out until it was read.
  const edit = useDraftOn<School, SchoolDraft, string, School>(
    {
      opening: isOpen && school ? `school:${school.id}` : null,
      data: school ?? undefined,
      reload,
    },
    {
      token: (read) => read.version,
      toDraft: schoolDraftOf,
      // The modal closes; the page reads the school again itself.
      answer: (saved) => saved,
    },
  );
  const draft = edit.draft ?? (school ? schoolDraftOf(school) : undefined);
  const field =
    <K extends keyof SchoolDraft>(key: K) =>
    (value: SchoolDraft[K]) =>
      edit.setDraft((current) => ({ ...current, [key]: value }));
  const schoolOrgId = draft?.organizationId ?? "";
  const schoolName = draft?.name ?? "";
  const schoolSlug = draft?.slug ?? "";
  const schoolSubdomain = draft?.subdomain ?? "";
  const schoolAddress = draft?.address ?? "";
  const schoolCity = draft?.city ?? "";
  const schoolZip = draft?.zip ?? "";
  const schoolPhone = draft?.phone ?? "";
  const schoolEmail = draft?.email ?? "";
  const schoolHidden = draft?.hidden ?? false;
  const setSchoolOrgId = field("organizationId");
  const setSchoolName = field("name");
  const setSchoolSlug = field("slug");
  const setSchoolSubdomain = field("subdomain");
  const setSchoolAddress = field("address");
  const setSchoolCity = field("city");
  const setSchoolZip = field("zip");
  const setSchoolPhone = field("phone");
  const setSchoolEmail = field("email");
  const setSchoolHidden = field("hidden");
  const [schoolSaving, setSchoolSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { show: showError, invalid, clear: clearError } = formErrors;

  useEffect(() => {
    if (isOpen) clearError();
  }, [isOpen, clearError]);

  // The warning holds while the stored address is unchanged: a stored but
  // unusable address bounces as much as a missing one.
  const replyAddressMissing =
    requiredDetails?.replyAddressMissing === true &&
    schoolEmail.trim() === (school?.email ?? "").trim();
  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!school) return;
      // CustomSelect's `required` is ARIA-only — it does not join native form
      // constraint validation, so an Enter-submit with a cleared organization
      // lands here and must produce a visible error instead of a silent return.
      if (!schoolOrgId) {
        const hint = "Bitte wähle einen Träger aus.";
        invalid("Bitte prüfe die markierten Felder.", {
          organization_id: hint,
        });
        return;
      }
      if (!schoolName.trim() || !schoolSlug.trim() || !schoolSubdomain.trim())
        return;
      if (!isValidSlug(schoolSlug)) {
        const hint =
          "Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.";
        invalid("Bitte prüfe die markierten Felder.", { slug: hint });
        return;
      }
      if (!isValidSlug(schoolSubdomain)) {
        const hint =
          "Subdomain darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.";
        invalid("Bitte prüfe die markierten Felder.", { subdomain: hint });
        return;
      }
      const opened = edit.base;
      if (!opened || !edit.canSubmit) return;
      setSchoolSaving(true);
      clearError();
      const oldSubdomain = opened.subdomain;
      const newSubdomain = schoolSubdomain.trim();
      const result = await edit.submit((version) =>
        operatorProvisioningService.updateSchool(opened.id, {
          organization_id: schoolOrgId,
          name: schoolName.trim(),
          slug: schoolSlug.trim(),
          subdomain: newSubdomain,
          address: schoolAddress.trim(),
          city: schoolCity.trim(),
          zip: schoolZip.trim(),
          phone: schoolPhone.trim(),
          email: schoolEmail.trim(),
          active: opened.active,
          hidden: schoolHidden,
          expected_version: version,
        }),
      );
      if (!result.ok) {
        logger.error("school_update_failed", {
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        });
        // Someone changed the school since: `reload` shows it here.
        void showError(result.error, {
          object: "die Änderung an der Schule",
          reload: result.reload,
        });
        setSchoolSaving(false);
        return;
      }
      setSchoolSaving(false);
      onClose();
      // The portal cache reloads with the page: its failure is a load error,
      // the change itself is saved (#6652).
      await onUpdated(
        oldSubdomain !== newSubdomain || opened.hidden !== schoolHidden
          ? [oldSubdomain, newSubdomain]
          : [],
      );
    },
    [
      school,
      edit,
      schoolOrgId,
      schoolName,
      schoolSlug,
      schoolSubdomain,
      schoolAddress,
      schoolCity,
      schoolZip,
      schoolPhone,
      schoolEmail,
      schoolHidden,
      onClose,
      onUpdated,
      invalid,
      clearError,
      showError,
    ],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schule bearbeiten"
      footer={
        <>
          <Button
            type="button"
            onClick={onClose}
            variant="outline"
            size="md"
            className="flex-1"
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={(e) => void handleUpdate(e)}
            disabled={
              schoolSaving ||
              !edit.canSubmit ||
              !schoolOrgId ||
              !schoolName.trim() ||
              !schoolSlug.trim() ||
              !schoolSubdomain.trim()
            }
            variant="primary"
            size="md"
            className="flex-1"
          >
            {schoolSaving ? "Wird gespeichert..." : "Speichern"}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(e) => void handleUpdate(e)}
        className="space-y-4"
        id="edit-school-form"
      >
        <FormErrorAlert message={formErrors.error} />
        <FormField
          label="Träger"
          htmlFor="edit-school-org"
          required
          error={formErrors.fieldError("organization_id")}
        >
          <CustomSelect
            id="edit-school-org"
            ariaLabel="Träger"
            value={schoolOrgId}
            options={[
              { value: "", label: "Träger auswählen..." },
              ...(organizations?.map((org) => ({
                value: org.id,
                label: org.name,
              })) ?? []),
            ]}
            onChange={setSchoolOrgId}
            placeholder="Träger auswählen..."
            required
          />
          {school && schoolOrgId !== school.organizationId && (
            <FieldWarning message="Trägerwechsel kann die Slug-Eindeutigkeit in der neuen Organisation beeinflussen." />
          )}
        </FormField>
        <Input
          id="edit-school-name"
          name="name"
          type="text"
          value={schoolName}
          onChange={(e) => setSchoolName(e.target.value)}
          maxLength={255}
          label="Name"
          required
          error={formErrors.fieldError("name")}
          controlSize="compact"
        />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              id="edit-school-slug"
              name="slug"
              type="text"
              value={schoolSlug}
              onChange={(e) => setSchoolSlug(e.target.value)}
              maxLength={100}
              label="Slug"
              required
              error={formErrors.fieldError("slug")}
              controlSize="compact"
              className="font-mono"
            />
            {school && schoolSlug !== school.slug && (
              <FieldWarning message="Slug-Änderungen können bestehende Verweise ungültig machen." />
            )}
          </div>
          <div>
            <Input
              id="edit-school-subdomain"
              name="subdomain"
              type="text"
              value={schoolSubdomain}
              onChange={(e) => setSchoolSubdomain(e.target.value)}
              maxLength={63}
              label="Subdomain"
              required
              error={formErrors.fieldError("subdomain")}
              controlSize="compact"
              className="font-mono"
            />
            {school && schoolSubdomain !== school.subdomain && (
              <FieldWarning message="Subdomain-Änderungen erfordern, dass alle Benutzer die neue Adresse verwenden. Die alte Adresse wird nach kurzer Zeit nicht mehr erreichbar sein." />
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <SectionLabel className="mb-3">Kontaktdaten</SectionLabel>
          <div className="space-y-3">
            <Input
              id="edit-school-address"
              name="address"
              type="text"
              value={schoolAddress}
              onChange={(e) => setSchoolAddress(e.target.value)}
              maxLength={255}
              label="Adresse"
              error={formErrors.fieldError("address")}
              controlSize="compact"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="edit-school-zip"
                name="zip"
                type="text"
                value={schoolZip}
                onChange={(e) => setSchoolZip(e.target.value)}
                maxLength={10}
                label="PLZ"
                error={formErrors.fieldError("zip")}
                controlSize="compact"
              />
              <Input
                id="edit-school-city"
                name="city"
                type="text"
                value={schoolCity}
                onChange={(e) => setSchoolCity(e.target.value)}
                maxLength={255}
                label="Stadt"
                error={formErrors.fieldError("city")}
                controlSize="compact"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="edit-school-phone"
                name="phone"
                type="tel"
                value={schoolPhone}
                onChange={(e) => setSchoolPhone(e.target.value)}
                maxLength={30}
                label="Telefon"
                error={formErrors.fieldError("phone")}
                controlSize="compact"
              />
              <div>
                <Input
                  id="edit-school-email"
                  name="email"
                  type="email"
                  value={schoolEmail}
                  onChange={(e) => setSchoolEmail(e.target.value)}
                  maxLength={255}
                  label="E-Mail"
                  error={formErrors.fieldError("email")}
                  controlSize="compact"
                />
                {replyAddressMissing ? (
                  <FieldWarning message="Adresse fehlt. Antworten von Eltern kommen bei der Schule nicht an." />
                ) : (
                  <p className="mt-1 text-xs text-gray-500">
                    Antworten von Eltern gehen an diese Adresse.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <VisibilityToggle
          hidden={schoolHidden}
          onToggle={() => setSchoolHidden(!schoolHidden)}
        />
      </form>
    </Modal>
  );
}
