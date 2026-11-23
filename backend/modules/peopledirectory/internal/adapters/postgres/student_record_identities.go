package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"

	directory "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewStudentRecordIdentities reads the child records of the school in the
// caller's tenant transaction over the student directory projection.
func NewStudentRecordIdentities(database Database, rows StudentDirectory) directory.StudentRecordIdentities {
	return studentRecordIdentities{reads: newStudentDirectoryReads(database, rows)}
}

type studentRecordIdentities struct {
	reads *studentDirectoryReads
}

// StudentRecordIdentities reads the children of ids at the school in one
// statement, alumni included; a deleted membership or person is gone.
func (s studentRecordIdentities) StudentRecordIdentities(ctx context.Context, ids []int64) ([]directory.StudentRecordIdentity, error) {
	result := []directory.StudentRecordIdentity{}
	if len(ids) == 0 {
		return result, nil
	}
	db, scope, err := s.reads.database(ctx)
	if err != nil {
		return nil, err
	}
	if scope.AcrossSchools {
		return nil, errors.New("people directory: child records by identifier need the school's tenant transaction")
	}
	var rows []struct {
		StudentID int64          `bun:"student_id"`
		FirstName string         `bun:"first_name"`
		LastName  string         `bun:"last_name"`
		Birthday  *calendar.Date `bun:"birthday,type:date"`
	}
	query := withStudentTenant(s.reads.studentRows(db, scope).
		ColumnExpr(`"student".id AS student_id, "person".first_name, "person".last_name, "person".birthday`).
		Join(`JOIN users.persons AS "person" ON "person".tenant_id = "student".tenant_id AND "person".id = "student".person_id`).
		Where(`"person".deleted_at IS NULL`).
		Where(`"student".id IN (?)`, bun.List(ids)), scope).OrderExpr(`"student".id ASC`)
	if err := query.Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("people directory postgres: child records by identifier: %w", err)
	}
	for _, row := range rows {
		result = append(result, directory.StudentRecordIdentity{StudentID: row.StudentID, FirstName: row.FirstName,
			LastName: row.LastName, Birthday: row.Birthday})
	}
	return result, nil
}
