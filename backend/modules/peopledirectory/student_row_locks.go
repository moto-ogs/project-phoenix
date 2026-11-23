package peopledirectory

import "context"

// StudentRowLocks holds only the owned student rows, without loading foreign
// student facts. Missing students are refused before the caller can write.
type StudentRowLocks interface {
	LockStudentRows(context.Context, []int64) (int, error)
}

// StudentKeyShareLock takes the student row FOR NO KEY UPDATE, beside the
// facade (ADR 0313): it waits for LockStudent and every update of the row,
// but not for the key share a row referencing the child takes, so a writer
// that holds the row while it waits for a lock whose holder inserts such
// rows cannot deadlock with it (the meal registration writes and the
// school's order lock). ErrStudentNotFound when the tenant has no such row.
type StudentKeyShareLock interface {
	LockStudentNoKeyUpdate(context.Context, int64) error
}
