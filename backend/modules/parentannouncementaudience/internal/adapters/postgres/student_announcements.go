package parentaudience

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/parentannouncementaudience/contract"
)

// studentAnnouncementsSQL lists every published Elternbrief and
// Einverständnis of the school that reached one child (#4814): its recorded
// children once published (#6988), the targets of today before that, and
// every declaration a guardian answered for the child (the history links),
// so a given consent stays in the child's record after a class change and
// after the school retracted it (published_at is then NULL; the answers and
// their proof remain, as the declaration's retention guards intend). A
// letter carries the child's confirmation as letterChildStatusesSQL derives
// it: the first acknowledgement by a portal guardian of exactly this child.
//
// Bind order: history (jsonb), school, student, guardian links of the
// school, student, guardian links of the school, student, school, student,
// school, school, today, today, today.
const studentAnnouncementsSQL = `WITH history AS (
			SELECT DISTINCT h.announcement_id
			FROM jsonb_to_recordset(?::jsonb) AS h(tenant_id bigint, announcement_id bigint, student_id bigint)
			WHERE h.tenant_id = ? AND h.student_id = ?
		)
			SELECT ra.id AS announcement_id, ra.title, ra.delivery_mode, ra.published_at,
				ra.response_deadline,
				EXISTS (
					SELECT 1 FROM (?) sg
					JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = ra.tenant_id
						AND gp.account_id IS NOT NULL
					JOIN auth.account_tenants act ON act.account_id = gp.account_id
						AND act.tenant_id = gp.tenant_id AND act.status = 'active'
					WHERE sg.student_id = ?
						AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
				) AS can_confirm,
				ack.acknowledged_at AS acknowledged_at,
				COALESCE(ack.first_name, '') AS ack_first_name,
				COALESCE(ack.last_name, '') AS ack_last_name
			FROM users.parent_announcements ra
			LEFT JOIN LATERAL (
				SELECT par.acknowledged_at, gp.first_name, gp.last_name
				FROM (?) sg
				JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id
					AND gp.tenant_id = ra.tenant_id AND gp.account_id IS NOT NULL
				JOIN users.parent_announcement_reads par ON par.announcement_id = ra.id
					AND par.tenant_id = ra.tenant_id AND par.account_id = gp.account_id
				WHERE sg.student_id = ?
					AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
					AND par.acknowledged_at IS NOT NULL
				ORDER BY par.acknowledged_at ASC
				LIMIT 1
			) ack ON ra.delivery_mode = 'letter'
			WHERE ra.tenant_id = ?
				AND ra.system_kind IS NULL
				AND ra.delivery_mode IN ('letter', 'declaration')
				AND (
					-- A retracted class letter is its author's private draft again.
					(ra.delivery_mode = 'declaration' AND ra.id IN (SELECT announcement_id FROM history)
						AND (ra.published_at IS NOT NULL OR ra.sender_name IS NULL))
					OR (ra.published_at IS NOT NULL AND EXISTS (
						SELECT 1
						FROM users.parent_announcement_targets pt
						JOIN users.student_profiles s ON s.id = ? AND s.tenant_id = ?` + studentMembershipJoins + ` AND (` + studentReachedBound + `
						)
						JOIN users.persons p ON p.id = s.person_id AND p.deleted_at IS NULL
						WHERE pt.announcement_id = ra.id AND pt.tenant_id = ra.tenant_id
					))
				)
			ORDER BY ra.published_at DESC NULLS LAST, ra.id DESC`

type studentAnnouncementRow struct {
	AnnouncementID   int64      `bun:"announcement_id"`
	Title            string     `bun:"title"`
	DeliveryMode     string     `bun:"delivery_mode"`
	PublishedAt      *time.Time `bun:"published_at"`
	ResponseDeadline *time.Time `bun:"response_deadline"`
	CanConfirm       bool       `bun:"can_confirm"`
	AcknowledgedAt   *time.Time `bun:"acknowledged_at"`
	AckFirstName     string     `bun:"ack_first_name"`
	AckLastName      string     `bun:"ack_last_name"`
}

// studentOfSchoolSQL reports whether the child belongs to the school.
//
// Bind order: student, school.
const studentOfSchoolSQL = `SELECT EXISTS (
			SELECT 1 FROM users.student_profiles s WHERE s.id = ? AND s.tenant_id = ?
		)`

// StudentAnnouncements returns the published letters and declarations of
// the school that reached the child or that a guardian answered for it,
// newest first. A child of another school, or none at all, is
// contract.ErrStudentNotInSchool: its record must not be read or logged
// in this school.
func (p *Projection) StudentAnnouncements(ctx context.Context, schoolID, studentID int64, history []contract.DeclarationHistoryLink) ([]*contract.StudentAnnouncement, error) {
	db, _, err := p.database(ctx)
	if err != nil {
		return nil, err
	}
	var known bool
	if err := db.NewRaw(studentOfSchoolSQL, studentID, schoolID).Scan(ctx, &known); err != nil {
		return nil, fmt.Errorf("student of the school: %w", err)
	}
	if !known {
		return nil, contract.ErrStudentNotInSchool
	}
	historyJSON, err := declarationHistoryJSON(history)
	if err != nil {
		return nil, err
	}
	today := p.day()
	var rows []studentAnnouncementRow
	if err := db.NewRaw(studentAnnouncementsSQL,
		historyJSON, schoolID, studentID,
		p.guardianLinks(db, schoolID), studentID,
		p.guardianLinks(db, schoolID), studentID,
		schoolID,
		studentID, schoolID, schoolID, today, today, today,
	).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("parent announcements of a student: %w", err)
	}
	out := make([]*contract.StudentAnnouncement, 0, len(rows))
	for _, row := range rows {
		value := contract.StudentAnnouncement(row)
		out = append(out, &value)
	}
	return out, nil
}
