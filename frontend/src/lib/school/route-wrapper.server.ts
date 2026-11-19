import { schoolPortal } from "~/server/auth/school";
import {
  makeCatalogProxy,
  type CatalogMethod,
  type CatalogRoute,
} from "../contract/catalog-proxy.server";
import { CATALOG_OUTSIDE_MOUNTS } from "../contract/catalog-outside-mounts";
import { makePortalHandlers } from "../portal-handlers.server";

/** moto schule's route handlers (#2207), on the school session only. */
export const school = makePortalHandlers(schoolPortal);

export const {
  proxyFile,
  proxyUpload,
  proxyGet,
  proxyPost,
  proxyPut,
  proxyPatch,
  proxyDelete,
  del: createSchoolDeleteHandler,
} = school;

/**
 * moto schule's proxy: forwards `/api/school/…` to the backend's `/school/…`
 * for the routes the contract registers for this portal.
 */
export const catalogProxy = (
  routes: readonly CatalogRoute[],
  method: CatalogMethod,
) =>
  makeCatalogProxy(
    school,
    "/school",
    routes,
    method,
    CATALOG_OUTSIDE_MOUNTS.school,
  );
