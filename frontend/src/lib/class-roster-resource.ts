import { fetchStudents } from "~/lib/student-api";

// Minimal projection of a regular student for the roster view: this page
// answers "wer ist schon in moto?", nicht mehr; alles Weitere gehört in die
// Kinder-Datenbank.
export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
}

const ROSTER_PAGE_SIZE = 1000;

// Loads EVERY student page: the backend caps page_size at 1000, so a larger
// school needs more than one request or the roster (and every derived count)
// would silently stop at the first thousand children. A failed page THROWS —
// a partial roster rendered as if complete would misreport who is already in
// moto.
export async function fetchRosterStudents(
  fetchPage: typeof fetchStudents = fetchStudents,
): Promise<RosterStudent[]> {
  const students: RosterStudent[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await fetchPage({
      page,
      pageSize: ROSTER_PAGE_SIZE,
      includePendingWithdrawals: true,
      view: "slim",
    });
    students.push(
      ...result.students.map((student) => ({
        id: String(student.id),
        firstName: student.first_name ?? "",
        lastName: student.second_name ?? "",
        schoolClass: student.school_class ?? "",
      })),
    );
    totalPages = result.pagination.total_pages;
    page += 1;
  }
  return students;
}
