import { ApiError, apiErrorFromResponse, transportFetch } from "./api-error";
// Dateiablage (#2596): API client + type mapping for the school file
// storage. The backend decides everything about authority (folder
// visibility, files:manage, files.staff_upload_enabled) and tells the UI what
// the caller may do via can_manage / can_upload / can_delete — the page
// renders exactly that, no client-side authority.

import { hasSessionAccess } from "./session-access";
import { getCachedSession, sessionFetch } from "./session-cache";
import { knownEnum } from "./contract/known-enum";
import type {
  AudienceResponse,
  FileListResponse,
  FileResponse,
  FolderListResponse,
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
async function throwFilesError(
  response: Response,
  fallback: string,
): Promise<never> {
  throw await apiErrorFromResponse(response, fallback);
}

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
    const response = await sessionFetch("/api/files/folders");
    if (!response.ok) {
      await throwFilesError(response, "Ordner konnten nicht geladen werden.");
    }
    const json = (await response.json()) as { data: FolderListResponse };
    return {
      folders: (json.data.folders ?? []).flatMap((folder) => {
        const mapped = mapFolder(folder);
        return mapped ? [mapped] : [];
      }),
      canManage: json.data.can_manage,
      canUpload: json.data.can_upload,
      staffUploadEnabled: json.data.staff_upload_enabled,
      usedBytes: json.data.used_bytes,
      maxBytes: json.data.max_bytes,
    };
  }

  async createFolder(input: FolderInput): Promise<FileFolder | null> {
    const response = await sessionFetch("/api/files/folders", {
      method: "POST",
      body: JSON.stringify(toBackendFolderInput(input)),
    });
    if (!response.ok) {
      await throwFilesError(response, "Ordner konnte nicht angelegt werden.");
    }
    const json = (await response.json()) as { data: FolderResponse };
    return mapFolder(json.data);
  }

  async updateFolder(
    folderId: string,
    input: FolderInput,
  ): Promise<FileFolder | null> {
    const response = await sessionFetch(`/api/files/folders/${folderId}`, {
      method: "PUT",
      body: JSON.stringify(toBackendFolderInput(input)),
    });
    if (!response.ok) {
      await throwFilesError(
        response,
        "Ordner konnte nicht gespeichert werden.",
      );
    }
    const json = (await response.json()) as { data: FolderResponse };
    return mapFolder(json.data);
  }

  async deleteFolder(folderId: string): Promise<void> {
    const response = await sessionFetch(`/api/files/folders/${folderId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await throwFilesError(response, "Ordner konnte nicht gelöscht werden.");
    }
  }

  async listAudience(): Promise<AudienceOptions> {
    const response = await sessionFetch("/api/files/audience");
    if (!response.ok) {
      await throwFilesError(
        response,
        "Rollen und Personen konnten nicht geladen werden.",
      );
    }
    const json = (await response.json()) as { data: AudienceResponse };
    return {
      roles: (json.data.roles ?? []).map((role) => ({
        id: role.id,
        name: role.name,
      })),
      accounts: (json.data.accounts ?? []).map((account) => ({
        accountId: account.account_id,
        firstName: account.first_name,
        lastName: account.last_name,
      })),
    };
  }

  async listFiles(folderId: string): Promise<FolderFiles> {
    const response = await sessionFetch(`/api/files/folders/${folderId}/files`);
    if (!response.ok) {
      await throwFilesError(response, "Dateien konnten nicht geladen werden.");
    }
    const json = (await response.json()) as { data: FileListResponse };
    return {
      folder: mapFolder(json.data.folder),
      files: (json.data.files ?? []).map(mapFile),
    };
  }

  async upload(folderId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);

    if (!hasSessionAccess(await getCachedSession())) {
      throw new ApiError("Authentication required", 401, {
        code: "general.permission",
      });
    }

    // Raw fetch on purpose — sessionFetch forces Content-Type
    // application/json, which would clobber the multipart boundary.
    const response = await transportFetch(
      `/api/files/folders/${folderId}/files`,
      {
        method: "POST",
        body: formData,
      },
    );
    if (!response.ok) {
      await throwFilesError(
        response,
        "Die Datei konnte nicht hochgeladen werden. Erlaubt sind PDF, DOCX, XLSX, PPTX, PNG und JPEG bis 25 MB.",
      );
    }
  }

  async deleteFile(folderId: string, fileId: string): Promise<void> {
    const response = await sessionFetch(
      `/api/files/folders/${folderId}/files/${fileId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      await throwFilesError(response, "Datei konnte nicht gelöscht werden.");
    }
  }

  /** Same-origin proxy URL for the authenticated download. */
  downloadUrl(folderId: string, fileId: string): string {
    return `/api/files/folders/${folderId}/files/${fileId}/download`;
  }

  /** Same URL, but the browser shows the file (PDF, image) instead of saving it. */
  viewUrl(folderId: string, fileId: string): string {
    return `${this.downloadUrl(folderId, fileId)}?inline=1`;
  }
}

export const filesService = new FilesService();
