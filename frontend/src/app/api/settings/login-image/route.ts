import { invalidateTenantResolve } from "~/lib/tenant-resolve.server";
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
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "LoginImageRoute" });

/** Extract tenant slug from the request to revalidate ISR cache.
 *  Tries subdomain first (host header), then falls back to path prefix (referer).
 *
 *  Subdomain detection compares against NEXT_PUBLIC_TENANT_DOMAIN so that dotted
 *  base domains (e.g. moto-app.de) are not mistakenly split at the first dot. */
function revalidateTenantCache(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0] ?? "";
  const baseDomain = process.env.NEXT_PUBLIC_TENANT_DOMAIN;

  // Try subdomain: tenant.moto-app.de → "tenant"
  // Only match when the hostname ends with ".{baseDomain}" so that
  // bare-domain requests (moto-app.de) fall through to the referer path.
  // NEXT_PUBLIC_TENANT_DOMAIN is deploy-only (not set in local dev) — when
  // missing, subdomain detection is skipped and path-based fallback is used.
  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    const slug = hostname.slice(0, -(baseDomain.length + 1));
    if (slug && slug !== "www") {
      invalidateTenantResolve(slug);
      return;
    }
  }

  // Fallback: extract slug from referer path (e.g. /school-a/settings)
  const referer = request.headers.get("referer") ?? "";
  try {
    const refUrl = new URL(referer);
    const pathSlug = refUrl.pathname.split("/")[1];
    if (pathSlug) {
      invalidateTenantResolve(pathSlug);
      return;
    }
  } catch {
    // Invalid referer URL — fall through to warning
  }

  // In subdomain mode (baseDomain is set but slug extraction failed above),
  // this means the host didn't match — likely misconfiguration. In path mode
  // (baseDomain unset), reaching here means the referer had no usable slug.
  logger.error("tenant_cache_revalidation_failed", {
    host,
    referer: referer || "(empty)",
    base_domain_configured: !!baseDomain,
  });
}

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
    if (result.backend?.ok) revalidateTenantCache(request);
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
    if (result.backend?.ok) revalidateTenantCache(request);
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
