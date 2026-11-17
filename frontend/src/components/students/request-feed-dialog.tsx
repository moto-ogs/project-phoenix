"use client";

import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Rss } from "lucide-react";

import { Button } from "~/components/ui/button";
import { FormRow } from "~/components/ui/form-row";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Modal } from "~/components/ui/modal";
import { useApiFormError } from "~/contexts/ToastContext";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import {
  createRequestFeed,
  getRequestFeedStatus,
  rotateRequestFeed,
} from "~/lib/request-feed-api";
import { useClipboardCopy } from "~/lib/use-clipboard-copy";
import { Alert } from "~/components/ui/alert";
import { InsetPanel } from "~/components/ui/inset-panel";

/** Objekt der Fehlertexte aus dem Katalog (#2513). */
const FEED_OBJECT = "das Abo";

interface RequestFeedDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function RequestFeedDialog({ isOpen, onClose }: RequestFeedDialogProps) {
  // Fehler und Rückmeldungen stehen im Dialog: ein Toast läge hinter seinem
  // Hintergrund und bliebe unsichtbar.
  const actionErrors = useApiFormError();
  const feedStatus = useSWRAuth(
    isOpen ? tenantStudentKeys.requestFeedStatus() : null,
    getRequestFeedStatus,
  );
  const { mutate: mutateFeedStatus } = feedStatus;
  const { error: loadError, failure } = useSwrResourceLoadError(
    [feedStatus],
    FEED_OBJECT,
    () => mutateFeedStatus(),
  );
  const { copied, copy } = useClipboardCopy("RequestFeedDialog", 2000);
  const active = feedStatus.data?.active ?? false;
  // The link is shown once, right after it was made; never cached.
  const [url, setURL] = useState<string | null>(null);
  const checking = isOpen && !feedStatus.data && failure === undefined;
  const [saving, setSaving] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const loadFailed = loadError !== null;

  useEffect(() => {
    if (!isOpen) return;
    setURL(null);
    setConfirmRotate(false);
  }, [isOpen]);

  const create = async () => {
    setSaving(true);
    actionErrors.clear();
    try {
      const result = await createRequestFeed();
      setURL(result.url);
      void mutateFeedStatus({ active: true }, { revalidate: false });
    } catch (err) {
      await actionErrors.show(err, {
        object: FEED_OBJECT,
        retry: () => void create(),
      });
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setSaving(true);
    actionErrors.clear();
    try {
      const result = await rotateRequestFeed();
      setURL(result.url);
      void mutateFeedStatus({ active: true }, { revalidate: false });
      setConfirmRotate(false);
    } catch (err) {
      await actionErrors.show(err, {
        object: FEED_OBJECT,
        retry: () => void rotate(),
      });
    } finally {
      setSaving(false);
    }
  };

  const copyURL = async () => {
    if (!url) return;
    actionErrors.clear();
    // Gelungenes Kopieren zeigt der Knopf selbst („Kopiert“).
    if (!(await copy(url))) {
      // Kein API-Fehler: die Zwischenablage hat abgelehnt. Der Link steht
      // markierbar im Feld, also nennt der Text den Weg von Hand.
      actionErrors.invalid(
        "Kopieren hat nicht geklappt. Bitte markieren Sie den Link und kopieren Sie ihn selbst.",
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Neue Anfragen abonnieren"
      mobileSheet
      isDismissDisabled={saving}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            noTooltip="Schließen schließt nur den Dialog, ohne etwas zu ändern."
            onClick={onClose}
            disabled={saving}
          >
            Schließen
          </Button>
          {!loadFailed && !active ? (
            <Button
              type="button"
              size="md"
              isLoading={saving}
              disabled={checking}
              loadingText="Link wird erstellt…"
              tooltip="Erstellt Ihren persönlichen Link für neue Elternanfragen."
              onClick={() => void create()}
            >
              <Rss className="mr-2 size-4" aria-hidden />
              RSS-Link erstellen
            </Button>
          ) : null}
          {active && !confirmRotate ? (
            <Button
              type="button"
              size="md"
              variant="outline"
              disabled={saving}
              tooltip="Erstellt einen neuen Link, moto fragt vorher nach."
              onClick={() => setConfirmRotate(true)}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              Neuen Link erstellen
            </Button>
          ) : null}
          {active && confirmRotate ? (
            <Button
              type="button"
              size="md"
              isLoading={saving}
              loadingText="Link wird erstellt…"
              tooltip="Erstellt sofort einen neuen Link, der alte funktioniert dann nicht mehr."
              onClick={() => void rotate()}
            >
              Alten Link ersetzen
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 text-sm leading-6 text-gray-700">
        <p>
          Ein RSS-Programm zeigt Ihnen neue Elternanfragen. Entscheiden können
          Sie nur in moto.
        </p>

        <InsetPanel padding="md">
          <p className="font-semibold text-gray-800">Gut zu wissen</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
            <li>Das Programm prüft selbst. Hinweise können später ankommen.</li>
            <li>Der Link zeigt Anfragen aus den letzten 30 Tagen.</li>
            <li>Namen und andere persönliche Daten stehen nicht im Feed.</li>
            <li>Ein Online-Dienst verarbeitet den Feed außerhalb von moto.</li>
          </ul>
        </InsetPanel>

        {checking ? <p role="status">RSS-Link wird geprüft…</p> : null}

        <LoadErrorAlert error={loadError} />
        <FormErrorAlert message={actionErrors.error} />

        {active && !url ? <p>Es gibt schon einen RSS-Link.</p> : null}

        {confirmRotate ? (
          <Alert
            type="warning"
            message="Der bisherige Link funktioniert danach nicht mehr. Bereits geladene Hinweise bleiben im RSS-Programm gespeichert."
          />
        ) : null}

        {url ? (
          <div className="space-y-2">
            <FormRow>
              <Input
                id="parent-request-feed-url"
                label="Ihr RSS-Link"
                readOnly
                value={url}
                controlSize="compact"
                onFocus={(event) => event.target.select()}
                className="bg-gray-50 text-gray-700"
              />
              <Button
                type="button"
                size="md"
                variant={copied ? "success" : "outline"}
                className="min-w-32 shrink-0"
                tooltip="Kopiert den Link in die Zwischenablage."
                onClick={() => void copyURL()}
              >
                {copied ? (
                  <Check className="mr-2 size-4" aria-hidden />
                ) : (
                  <Copy className="mr-2 size-4" aria-hidden />
                )}
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
            </FormRow>
            <p className="text-xs leading-5 text-gray-500">
              Fügen Sie diesen Link in Ihrem RSS-Programm ein. Verwalten Sie den
              Link nur hier in moto.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
