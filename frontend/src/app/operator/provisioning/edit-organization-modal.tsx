import { useState, useCallback, useEffect, useRef } from "react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Modal } from "~/components/ui/modal";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { useApiFormError } from "~/contexts/ToastContext";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import { isValidSlug } from "~/lib/operator/provisioning-helpers";
import type { Organization } from "~/lib/operator/provisioning-helpers";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import { FieldWarning } from "./provisioning-shared";

const logger = createLogger({ component: "EditOrganizationModal" });

interface OrganizationDraft {
  readonly name: string;
  readonly slug: string;
}

function organizationDraftOf(organization: Organization): OrganizationDraft {
  return { name: organization.name, slug: organization.slug };
}

export function EditOrganizationModal({
  isOpen,
  onClose,
  organization,
  onUpdated,
  reload,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly organization: Organization | null;
  /** Reloads the Träger; never rejects (#6652). */
  readonly onUpdated: RefreshAfterWrite;
  /** Reads the Träger again after a refused save; rejects on failure. */
  readonly reload: () => Promise<Organization>;
}) {
  // The fields rest on the Träger as the modal opened it (ADR 0311): a newer
  // read refills them only while untouched, a refused save shows the stored
  // Träger, and nothing goes out until it was read.
  const edit = useDraftOn<
    Organization,
    OrganizationDraft,
    string,
    Organization
  >(
    {
      opening:
        isOpen && organization ? `organization:${organization.id}` : null,
      data: organization ?? undefined,
      reload,
    },
    {
      token: (read) => read.version,
      toDraft: organizationDraftOf,
      // The modal closes; the page reads the Träger again itself.
      answer: (saved) => saved,
    },
  );
  const orgName = edit.draft?.name ?? organization?.name ?? "";
  const orgSlug = edit.draft?.slug ?? organization?.slug ?? "";
  const setOrgName = (name: string) =>
    edit.setDraft((current) => ({ ...current, name }));
  const setOrgSlug = (slug: string) =>
    edit.setDraft((current) => ({ ...current, slug }));
  const [orgSaving, setOrgSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { show: showError, invalid, clear: clearError } = formErrors;

  useEffect(() => {
    if (isOpen) clearError();
  }, [isOpen, clearError]);

  const handleUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!organization || !orgName.trim() || !orgSlug.trim()) return;
      if (!isValidSlug(orgSlug)) {
        const hint =
          "Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.";
        invalid("Bitte prüfe die markierten Felder.", { slug: hint });
        return;
      }
      const opened = edit.base;
      if (!opened || !edit.canSubmit) return;
      setOrgSaving(true);
      clearError();
      const result = await edit.submit((version) =>
        operatorProvisioningService.updateOrganization(opened.id, {
          name: orgName.trim(),
          slug: orgSlug.trim(),
          active: opened.active,
          expected_version: version,
        }),
      );
      if (!result.ok) {
        logger.error("organization_update_failed", {
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        });
        // Someone changed the Träger since: `reload` shows it here.
        void showError(result.error, {
          object: "die Änderung am Träger",
          reload: result.reload,
        });
        setOrgSaving(false);
        return;
      }
      setOrgSaving(false);
      onClose();
      await onUpdated();
    },
    [
      organization,
      edit,
      orgName,
      orgSlug,
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
      title="Träger bearbeiten"
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
              orgSaving || !edit.canSubmit || !orgName.trim() || !orgSlug.trim()
            }
            variant="primary"
            size="md"
            className="flex-1"
          >
            {orgSaving ? "Wird gespeichert..." : "Speichern"}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(e) => void handleUpdate(e)}
        className="space-y-4"
        id="edit-org-form"
      >
        <FormErrorAlert message={formErrors.error} />
        <Input
          id="edit-org-name"
          name="name"
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          maxLength={255}
          label="Name"
          required
          error={formErrors.fieldError("name")}
          controlSize="compact"
        />
        <div>
          <Input
            id="edit-org-slug"
            name="slug"
            type="text"
            value={orgSlug}
            onChange={(e) => setOrgSlug(e.target.value)}
            maxLength={255}
            label="Slug"
            required
            error={formErrors.fieldError("slug")}
            controlSize="compact"
            className="font-mono"
          />
          <FieldWarning message="Slug-Änderungen können bestehende Verweise ungültig machen." />
        </div>
      </form>
    </Modal>
  );
}
