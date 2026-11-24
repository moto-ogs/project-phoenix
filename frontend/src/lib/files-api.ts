// Dateiablage (#2596): API client + type mapping for the school file
// storage. The backend decides everything about authority (folder
// visibility, files:manage, files.staff_upload_enabled) and tells the UI what
// the caller may do via can_manage / can_upload / can_delete — the page
// renders exactly that, no client-side authority.

import { bffFileHref, bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type {
  FileResponse,
  FolderRequest,
  FolderResponse,
} from "./contract/files.generated";

export type FolderVisibility = "all_staff" | "admins" | "selected";

export const FOLDER_VISIBILITY_LABELS: Record<FolderVisibility, string> = {
  all_staff: "Alle Mitarbeitenden",
  admins: "Nur Leitung",
  selected: "Ausgewählte Rollen und Personen",
};

export interface FileFolder {
  id: string;
  name: string;
  visibility: FolderVisibility;
  fileCount: number;
  roleIds: string[];
  accountIds: string[];
  createdAt: string;
  /** Der gelesene Stand, den eine Änderung zurückschickt (ADR 0311). */
  version: string;
  /** Die Dateien, die der Lösch-Dialog nennt; das Löschen bestätigt sie. */
  fingerprint: string;
}

export interface FolderOverview {
  folders: FileFolder[];
  canManage: boolean;
  canUpload: boolean;
  staffUploadEnabled: boolean;
  usedBytes: number;
  maxBytes: number;
}

export interface StoredFile {
  id: string;
  folderId: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
  uploadedAt: string;
  uploadedBy: string;
  canDelete: boolean;
}

export interface FolderFiles {
  /** null: a visibility this build does not know. */
  folder: FileFolder | null;
  files: StoredFile[];
}

interface AudienceRole {
  id: string;
  name: string;
}

interface AudienceAccount {
  accountId: string;
  firstName: string;
  lastName: string;
}

export interface AudienceOptions {
  roles: AudienceRole[];
  accounts: AudienceAccount[];
}

interface FolderInput {
  name: string;
  visibility: FolderVisibility;
  roleIds: string[];
  accountIds: string[];
}

const FOLDER_VISIBILITIES: readonly FolderVisibility[] = [
  "all_staff",
  "admins",
  "selected",
];

/**
 * null: a visibility this build does not know (#2353). The list leaves such
 * a folder out: the edit form would otherwise save a default visibility and
 * open the folder to more people.
 */
function mapFolder(data: FolderResponse): FileFolder | null {
  const visibility = knownEnum(FOLDER_VISIBILITIES, data.visibility);
  if (!visibility) return null;
  return {
    id: data.id,
    name: data.name,
    visibility,
    fileCount: data.file_count,
    roleIds: data.role_ids ?? [],
    accountIds: data.account_ids ?? [],
    createdAt: data.created_at,
    version: data.version,
    fingerprint: data.fingerprint,
  };
}

function mapFile(data: FileResponse): StoredFile {
  return {
    id: data.id,
    folderId: data.folder_id,
    filename: data.filename,
    sizeBytes: data.size_bytes,
    contentType: data.content_type,
    uploadedAt: data.uploaded_at,
    uploadedBy: data.uploaded_by,
    canDelete: data.can_delete,
  };
}

/**
 * A failed request as ApiError with the backend's code, field errors, details
 * and request ID (#2517). The screen shows the catalog text for the code; the
 * message is a developer diagnostic only.
 */

function toBackendFolderInput(input: FolderInput): FolderRequest {
  return {
    name: input.name,
    visibility: input.visibility,
    role_ids: input.roleIds,
    account_ids: input.accountIds,
  };
}

class FilesService {
  async listFolders(): Promise<FolderOverview> {
    const list = await bffJson("tenant", "GET /api/files/folders", {
      errorMessage: "Ordner konnten nicht geladen werden.",
    });
    return {
      folders: (list.folders ?? []).flatMap((folder) => {
        const mapped = mapFolder(folder);
        return mapped ? [mapped] : [];
      }),
      canManage: list.can_manage,
      canUpload: list.can_upload,
      staffUploadEnabled: list.staff_upload_enabled,
      usedBytes: list.used_bytes,
      maxBytes: list.max_bytes,
    };
  }

  async createFolder(input: FolderInput): Promise<FileFolder | null> {
    const folder = await bffJson("tenant", "POST /api/files/folders", {
      body: toBackendFolderInput(input),
      errorMessage: "Ordner konnte nicht angelegt werden.",
    });
    return mapFolder(folder);
  }

  /** Speichert den Ordner, wie er mit `expectedVersion` gelesen wurde. */
  async updateFolder(
    folderId: string,
    input: FolderInput,
    expectedVersion: string,
  ): Promise<FileFolder | null> {
    const folder = await bffJson(
      "tenant",
      "PUT /api/files/folders/{folderId}",
      {
        params: { folderId },
        body: {
          ...toBackendFolderInput(input),
          expected_version: expectedVersion,
        },
        errorMessage: "Ordner konnte nicht gespeichert werden.",
      },
    );
    return mapFolder(folder);
  }

  /**
   * Löscht den Ordner mit den Dateien, die der Dialog genannt hat
   * (`fingerprint`); kam seitdem eine dazu oder fiel eine weg, lehnt der
   * Server ab.
   */
  async deleteFolder(
    folderId: string,
    expectedFingerprint: string,
  ): Promise<void> {
    await bffJson("tenant", "DELETE /api/files/folders/{folderId}", {
      params: { folderId },
      body: { expected_fingerprint: expectedFingerprint },
      errorMessage: "Ordner konnte nicht gelöscht werden.",
    });
  }

  async listAudience(): Promise<AudienceOptions> {
    const audience = await bffJson("tenant", "GET /api/files/audience", {
      errorMessage: "Rollen und Personen konnten nicht geladen werden.",
    });
    return {
      roles: (audience.roles ?? []).map((role) => ({
        id: role.id,
        name: role.name,
      })),
      accounts: (audience.accounts ?? []).map((account) => ({
        accountId: account.account_id,
        firstName: account.first_name,
        lastName: account.last_name,
      })),
    };
  }

  async listFiles(folderId: string): Promise<FolderFiles> {
    const list = await bffJson(
      "tenant",
      "GET /api/files/folders/{folderId}/files",
      {
        params: { folderId },
        errorMessage: "Dateien konnten nicht geladen werden.",
      },
    );
    return {
      folder: mapFolder(list.folder),
      files: (list.files ?? []).map(mapFile),
    };
  }

  async upload(folderId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    await bffJson("tenant", "POST /api/files/folders/{folderId}/files", {
      params: { folderId },
      body: formData,
      errorMessage:
        "Die Datei konnte nicht hochgeladen werden. Erlaubt sind PDF, DOCX, XLSX, PPTX, PNG und JPEG bis 25 MB.",
    });
  }

  async deleteFile(folderId: string, fileId: string): Promise<void> {
    await bffJson(
      "tenant",
      "DELETE /api/files/folders/{folderId}/files/{fileId}",
      {
        params: { folderId, fileId },
        errorMessage: "Datei konnte nicht gelöscht werden.",
      },
    );
  }

  downloadUrl(folderId: string, fileId: string): string {
    return bffFileHref(
      "tenant",
      "GET /api/files/folders/{folderId}/files/{fileId}/download",
      { params: { folderId, fileId } },
    );
  }

  /** Same URL, but the browser shows the file (PDF, image) instead of saving it. */
  viewUrl(folderId: string, fileId: string): string {
    return bffFileHref(
      "tenant",
      "GET /api/files/folders/{folderId}/files/{fileId}/download",
      { params: { folderId, fileId }, query: { inline: "1" } },
    );
  }
}

export const filesService = new FilesService();
