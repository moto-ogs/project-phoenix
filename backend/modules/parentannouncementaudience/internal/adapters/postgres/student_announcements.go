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
// so a given consent stays in the child's record after a class change. A
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
				ra.response_deadline, ra.expires_at, ra.active,
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
				AND ra.published_at IS NOT NULL
				AND ra.system_kind IS NULL
				AND ra.delivery_mode IN ('letter', 'declaration')
				AND (
					ra.id IN (SELECT announcement_id FROM history)
					OR EXISTS (
						SELECT 1
						FROM users.parent_announcement_targets pt
						JOIN users.student_profiles s ON s.id = ? AND s.tenant_id = ?` + studentMembershipJoins + ` AND (` + studentReachedBound + `
						)
						JOIN users.persons p ON p.id = s.person_id AND p.deleted_at IS NULL
						WHERE pt.announcement_id = ra.id AND pt.tenant_id = ra.tenant_id
					)
				)
			ORDER BY ra.published_at DESC, ra.id DESC`

type studentAnnouncementRow struct {
	AnnouncementID   int64      `bun:"announcement_id"`
	Title            string     `bun:"title"`
	DeliveryMode     string     `bun:"delivery_mode"`
	PublishedAt      time.Time  `bun:"published_at"`
	ResponseDeadline *time.Time `bun:"response_deadline"`
	ExpiresAt        *time.Time `bun:"expires_at"`
	Active           bool       `bun:"active"`
	CanConfirm       bool       `bun:"can_confirm"`
	AcknowledgedAt   *time.Time `bun:"acknowledged_at"`
	AckFirstName     string     `bun:"ack_first_name"`
	AckLastName      string     `bun:"ack_last_name"`
}

// StudentAnnouncements returns the published letters and declarations of
// the school that reached the child or that a guardian answered for it,
// newest first, in one statement.
func (p *Projection) StudentAnnouncements(ctx context.Context, schoolID, studentID int64, history []contract.DeclarationHistoryLink) ([]*contract.StudentAnnouncement, error) {
	db, _, err := p.database(ctx)
	if err != nil {
		return nil, err
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
