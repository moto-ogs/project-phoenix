import { loadStudentSearchSeed } from "~/lib/student-search-seed.server";
import StudentSearchContent from "./page-content";
import { StudentSearchSeed } from "./page-seed";

export default async function StudentSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const url = new URLSearchParams();
  for (const [name, values] of Object.entries(query)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value !== undefined) url.append(name, value);
    }
  }
  const seed = loadStudentSearchSeed(tenant, url).catch(() => null);
  return (
    <StudentSearchSeed seed={seed}>
      <StudentSearchContent />
    </StudentSearchSeed>
  );
}
