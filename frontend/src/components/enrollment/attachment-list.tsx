"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { FileTypeIcon } from "~/components/ui/file-type-icon";

import { Button } from "~/components/ui/button";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { bffFile } from "~/lib/bff-fetch";
import { downloadBlob } from "~/lib/file-download";
import type { FormAttachment } from "~/lib/enrollment-form-schema-api";
import { useCareTermTranslations } from "~/lib/care-facility-term";

/** Keep the request on the existing anonymous PDF route, including in saved
 * admin previews whose schema still carries canonical upload URLs. */
async function loadPublicDocument(url: string): Promise<Response> {
  const match =
    /^(?:\/uploads\/|\/api\/public\/)enrollment-form-legal-documents\/([\w.-]+\.pdf)$/i.exec(
      url,
    );
  if (!match) throw new ApiError("Invalid enrollment PDF URL", 400);
  return bffFile(
    "public",
    "GET /public/enrollment-form-legal-documents/{filename}",
    {
      params: { filename: match[1]! },
      errorMessage: "Enrollment PDF could not be loaded",
    },
  );
}

/** Loads the PDF an attachment names; a failure is an ApiError. */
export type LoadAttachmentDocument = (reference: string) => Promise<Response>;

const NO_ATTACHMENTS: FormAttachment[] = [];

export interface AttachmentLabels {
  open: string;
  download: string;
  openLabel: (label: string) => string;
  downloadLabel: (label: string) => string;
  /** What „Öffnen“ does, shown as the button's explanation (#6749). */
  openHint: string;
  /** What „Herunterladen“ does, shown as the button's explanation. */
  downloadHint: string;
  popupBlocked: string;
  errorObject: string;
}
interface AttachmentActionsProps {
  attachments: FormAttachment[];
  loadDocument: LoadAttachmentDocument;
}
export function DocumentAttachmentList({
  attachments = NO_ATTACHMENTS,
  loadDocument = loadPublicDocument,
  labels,
}: Readonly<{
  attachments?: FormAttachment[];
  loadDocument?: LoadAttachmentDocument;
  labels?: AttachmentLabels;
}>) {
  if (attachments.length === 0) return null;
  return labels ? (
    <AttachmentActions
      attachments={attachments}
      loadDocument={loadDocument}
      labels={labels}
    />
  ) : (
    <LocalizedAttachmentActions
      attachments={attachments}
      loadDocument={loadDocument}
    />
  );
}

function LocalizedAttachmentActions(props: Readonly<AttachmentActionsProps>) {
  const t = useCareTermTranslations("enrollmentForm.attachments");
  return (
    <AttachmentActions
      {...props}
      labels={{
        open: t("open"),
        download: t("download"),
        openLabel: (label) => t("openLabel", { label }),
        downloadLabel: (label) => t("downloadLabel", { label }),
        openHint: t("openHint"),
        downloadHint: t("downloadHint"),
        popupBlocked: t("popupBlocked"),
        errorObject: t("errorObject"),
      }}
    />
  );
}

function AttachmentActions({
  attachments,
  loadDocument,
  labels,
}: Readonly<AttachmentActionsProps & { labels: AttachmentLabels }>) {
  const { show, showMessage } = useApiErrorDisplay();
  const [busyURL, setBusyURL] = useState<string | null>(null);

  async function read(attachment: FormAttachment, open: boolean) {
    const tab = open ? window.open("about:blank", "_blank") : null;
    if (open && !tab) {
      showMessage(labels.popupBlocked);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.document.title = attachment.label;
    }
    setBusyURL(attachment.document_url);
    try {
      const response = await loadDocument(attachment.document_url);
      if (!response.headers.get("content-type")?.includes("application/pdf"))
        throw new ApiError("Expected enrollment PDF", 500);
      const blob = await response.blob();
      if (tab) {
        const url = URL.createObjectURL(blob);
        tab.location.href = url;
        // PDF viewers provide no reliable load event. Release after the viewer
        // has consumed the blob; downloadBlob releases its own URL separately.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        downloadBlob(
          blob,
          `${attachment.label.replace(/[\\/:*?"<>|]/g, "_").replace(/\.pdf$/i, "")}.pdf`,
        );
      }
    } catch (error) {
      tab?.close();
      void show(error, { object: labels.errorObject });
    } finally {
      setBusyURL(null);
    }
  }

  if (attachments.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {attachments.map((attachment) => (
        <li
          key={attachment.document_url}
          className="moto-content-surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
            <FileTypeIcon
              contentType="application/pdf"
              className="h-5 w-5 shrink-0 text-gray-500"
            />
            <p className="min-w-0 text-sm font-medium break-words text-gray-900">
              {attachment.label}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="gap-2"
              disabled={busyURL !== null}
              aria-label={labels.openLabel(attachment.label)}
              tooltip={labels.openHint}
              onClick={() => void read(attachment, true)}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {labels.open}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="gap-2"
              disabled={busyURL !== null}
              aria-label={labels.downloadLabel(attachment.label)}
              tooltip={labels.downloadHint}
              onClick={() => void read(attachment, false)}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {labels.download}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
