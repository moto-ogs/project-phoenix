package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// 20261116221657_student_membership_without_care_place.go
const studentMembershipWithoutCarePlaceVersion = "20261116221657"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     studentMembershipWithoutCarePlaceVersion,
		Description: "Mitgliedschaft merkt sich ein Kind der Klasse ohne OGS-Platz (#4803)",
		DependsOn: []string{
			studentMembershipCareGapVersion, // the last migration that altered the membership table
		},
	})
	Migrations.MustRegister(studentMembershipWithoutCarePlaceUp, studentMembershipWithoutCarePlaceDown)
}

// studentMembershipWithoutCarePlaceUpSQL adds School Membership's mark of a
// child who attends the school without a place in the OGS (#4803). Such a
// child is a normal student record, so its family reaches the parent app,
// but it never takes part in OGS care. A group is OGS care, so a child
// without a place has none; the check keeps that true whatever writes the
// row. Every existing row keeps its OGS place.
const studentMembershipWithoutCarePlaceUpSQL = `
ALTER TABLE users.student_school_memberships
	ADD COLUMN IF NOT EXISTS without_care_place BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN users.student_school_memberships.without_care_place IS
	'Child attends the school without an OGS place (#4803): no group, no OGS care, no Stichtag or child quota. Written only by School Membership.';
ALTER TABLE users.student_school_memberships
	DROP CONSTRAINT IF EXISTS chk_student_school_memberships_without_care_place_group;
ALTER TABLE users.student_school_memberships
	ADD CONSTRAINT chk_student_school_memberships_without_care_place_group
	CHECK (NOT without_care_place OR group_id IS NULL);
`

const studentMembershipWithoutCarePlaceDownSQL = `
ALTER TABLE users.student_school_memberships
	DROP CONSTRAINT IF EXISTS chk_student_school_memberships_without_care_place_group;
ALTER TABLE users.student_school_memberships DROP COLUMN IF EXISTS without_care_place;
`

func studentMembershipWithoutCarePlaceUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, studentMembershipWithoutCarePlaceUpSQL); err != nil {
			return fmt.Errorf("add the mark of children without an OGS place: %w", err)
		}
		return nil
	})
}

func studentMembershipWithoutCarePlaceDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, studentMembershipWithoutCarePlaceDownSQL); err != nil {
		return fmt.Errorf("drop the mark of children without an OGS place: %w", err)
	}
	return nil
}
