import { studentPhotoHref } from "~/lib/student-photo-href";

/** Keeps the response expected by browser tabs opened before photo_version. */
export function withLegacyPhotoAddress(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withLegacyPhotoAddress);
  if (value === null || typeof value !== "object") return value;

  const data = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      withLegacyPhotoAddress(item),
    ]),
  );
  const id = data.student_id ?? data.id;
  if (
    typeof id === "string" &&
    typeof data.photo_version === "string" &&
    data.photo_version
  ) {
    data.photo_url = studentPhotoHref(id, data.photo_version);
  }
  return data;
}
