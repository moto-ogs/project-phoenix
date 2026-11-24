import { purgeRequestTenantSettingsCache } from "~/lib/tenant-settings-cache.server";
import { contractGet, contractWrite } from "~/lib/contract/client.server";
import {
  routes,
  type loginImageUploadResponse,
} from "~/lib/contract/settings.generated";
import type { NextRequest } from "next/server";
import {
  createFileUploadHandler,
  FileValidationError,
} from "~/lib/file-upload-wrapper.server";
import {
  createDeleteHandler,
  createGetHandler,
} from "~/lib/route-wrapper.server";
export const POST = createFileUploadHandler<loginImageUploadResponse>(
  async (request: NextRequest, formData: FormData, token: string) => {
    const file = formData.get("login_image");
    if (!file || !(file instanceof File)) {
      throw new FileValidationError(
        "No image file provided",
        400,
        "files.file_missing",
      );
    }
    const forwarded = new FormData();
    forwarded.append("login_image", file);
    const result = await contractWrite(
      routes["POST /api/settings/login-image"],
      forwarded,
      { token, request },
    );
    // Go may have applied the change even if the reply cannot be read.
    if (result.backend?.ok) purgeRequestTenantSettingsCache(request);
    if (!result.ok) throw result.error.cause;
    return result.value.data;
  },
  {
    maxSizeInMB: 2,
    allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    allowedExtensions: [".jpg", ".jpeg", ".jfif", ".png", ".webp"],
  },
);

export const DELETE = createDeleteHandler(
  async (request: NextRequest, token: string) => {
    const result = await contractWrite(
      routes["DELETE /api/settings/login-image"],
      undefined,
      { token, request },
    );
    if (result.backend?.ok) purgeRequestTenantSettingsCache(request);
    if (!result.ok) throw result.error.cause;
    return null;
  },
);

export const GET = createGetHandler(async (request, token) => {
  const result = await contractGet(routes["GET /api/settings/login-image"], {
    token,
    request,
  });
  if (!result.ok) throw result.error.cause;
  return result.value.data;
});
