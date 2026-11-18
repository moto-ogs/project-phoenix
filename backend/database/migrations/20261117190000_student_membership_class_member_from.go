package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// 20261117190000_student_membership_class_member_from.go
const studentMembershipClassMemberFromVersion = "20261117190000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     studentMembershipClassMemberFromVersion,
		Description: "Mitgliedschaft behält den Beginn der Klasse eines Kindes, das später einen OGS-Platz bekommt (#4803)",
		DependsOn: []string{
			studentMembershipWithoutCarePlaceVersion,
		},
	})
	Migrations.MustRegister(studentMembershipClassMemberFromUp, studentMembershipClassMemberFromDown)
}

// studentMembershipClassMemberFromUpSQL keeps the day a child without an OGS
// place (#4803) joined its class when it gets a place: the place starts no
// earlier than the day it is granted, so its enrollment start moves, yet the
// child's morning absences before the place still belong to the class's
// Fehlzeitenliste. Only School Membership writes it, when it grants the place;
// every existing row has no such earlier class time. The class it belongs to
// is kept beside it: a later class change, by whatever write, ends it.
const studentMembershipClassMemberFromUpSQL = `
ALTER TABLE users.student_school_memberships
	ADD COLUMN IF NOT EXISTS class_member_from DATE,
	ADD COLUMN IF NOT EXISTS class_member_class TEXT;
COMMENT ON COLUMN users.student_school_memberships.class_member_from IS
	'First day in class_member_class of a child that had no OGS place before its place started (#4803). Written only by School Membership.';
COMMENT ON COLUMN users.student_school_memberships.class_member_class IS
	'Class the time from class_member_from belongs to (#4803); it counts only while the child is still in that class. Written only by School Membership.';
`

const studentMembershipClassMemberFromDownSQL = `
ALTER TABLE users.student_school_memberships
	DROP COLUMN IF EXISTS class_member_class,
	DROP COLUMN IF EXISTS class_member_from;
`

func studentMembershipClassMemberFromUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, studentMembershipClassMemberFromUpSQL); err != nil {
		return fmt.Errorf("add the class start of children without an OGS place: %w", err)
	}
	return nil
}

func studentMembershipClassMemberFromDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, studentMembershipClassMemberFromDownSQL); err != nil {
		return fmt.Errorf("drop the class start of children without an OGS place: %w", err)
	}
	return nil
}
