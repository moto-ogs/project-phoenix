package parentaudience

import "github.com/uptrace/bun"

// guardianLinks is the guardian-link projection (#2756) a query joins as sg.
// A positive school scopes it the way the old `sg.tenant_id = ?` did; zero
// leaves the school to the feed queries' own correlation with the
// announcement row.
func (p *Projection) guardianLinks(db bun.IDB, schoolID int64) *bun.SelectQuery {
	return p.links.GuardianLinkRows(db, schoolID)
}

// The care row is an existence filter, just as in the former compatibility
// view (ADR 0025). No care fields enter this projection. The public student
// ID belongs to s; sm.id is the separate membership ID.
const studentMembershipJoins = `
			JOIN users.student_school_memberships sm
				ON sm.student_profile_id = s.id AND sm.tenant_id = s.tenant_id AND sm.deleted_at IS NULL
			JOIN users.student_care_profiles sc
				ON sc.membership_id = sm.id AND sc.tenant_id = sm.tenant_id`

// Every statement in this projection is a compile-time constant so the
// architecture evaluator can see which tables it reads. The fragments below
// are the shared building blocks; each exported query assembles them once and
// documents its bind order, because a `?` binds in textual order no matter
// which fragment it came from.
//
// A student-guardian relationship is read through the guardian-link
// projection (#2756), bound as a subquery joined as sg: People Directory's
// relationship with Identity & Access's parents-portal permissions. For a
// bound school the subquery carries the school filter the old
// `sg.tenant_id = ?` did, in the same bind position.

// activeEnrollmentBound renders the activity_group branch of a target match:
// the student has an enrollment in pt.target_ref_id that is active on the
// bound calendar day. It mirrors the timetable's active-enrollment rule:
// valid_until is EXCLUSIVE and weekday is either unscoped or matches the ISO
// weekday. The school is bound because the surrounding query binds it too.
//
// Bind order: school, today, today, today.
const activeEnrollmentBound = `(pt.target_type = 'activity_group' AND EXISTS (
						SELECT 1 FROM activities.student_enrollments se
						WHERE se.student_id = s.id AND se.tenant_id = ?
							AND se.activity_group_id = pt.target_ref_id
							AND se.valid_from <= ?::date
							AND (se.valid_until IS NULL OR se.valid_until > ?::date)
							AND (se.weekday IS NULL OR se.weekday = date_part('isodow', ?::date)::INT)
					))`

// activeEnrollmentFeed is activeEnrollmentBound for the cross-school feed,
// where the school comes from the announcement row.
//
// Bind order: today, today, today.
const activeEnrollmentFeed = `(pt.target_type = 'activity_group' AND EXISTS (
						SELECT 1 FROM activities.student_enrollments se
						WHERE se.student_id = s.id AND se.tenant_id = a.tenant_id
							AND se.activity_group_id = pt.target_ref_id
							AND se.valid_from <= ?::date
							AND (se.valid_until IS NULL OR se.valid_until > ?::date)
							AND (se.weekday IS NULL OR se.weekday = date_part('isodow', ?::date)::INT)
					))`

// studentTargetMatchPrefix is the OR-union of the student-based selectors;
// the activity_group branch is appended by the variants below.
const studentTargetMatchPrefix = `
					pt.target_type = 'school_all'
					OR (pt.target_type = 'class' AND LOWER(TRIM(sm.school_class)) = LOWER(TRIM(pt.target_ref_text)))
					OR (pt.target_type = 'group' AND sm.group_id = pt.target_ref_id)
					OR (pt.target_type = 'student' AND s.id = pt.target_ref_id)
					OR `

// Bind order: school, today, today, today.
const studentTargetMatchBound = studentTargetMatchPrefix + activeEnrollmentBound

// Bind order: today, today, today.
const studentTargetMatchFeed = studentTargetMatchPrefix + activeEnrollmentFeed

// A published announcement records the children it reached
// (recipient_student_ids, #6988). From then on it reaches exactly those
// children, whatever their class, group or enrolment says today: a child who
// changes class after a letter went out keeps it, and the new class does not
// get it. The guardian side stays live, so a guardian of a recorded child who
// gains portal access later can still read and confirm, and one who loses it
// loses the announcement. NULL (a draft, or an announcement published before
// recording) keeps matching the targets of today.

// studentReachedBound is studentTargetMatchBound for a target row whose
// announcement is joined as ra.
//
// Bind order: school, today, today, today.
const studentReachedBound = `(ra.recipient_student_ids IS NOT NULL AND s.id = ANY(ra.recipient_student_ids))
					OR (ra.recipient_student_ids IS NULL AND (` + studentTargetMatchBound + `))`

// studentReachedFeed is studentTargetMatchFeed for the announcement row a.
//
// Bind order: today, today, today.
const studentReachedFeed = `(a.recipient_student_ids IS NOT NULL AND s.id = ANY(a.recipient_student_ids))
					OR (a.recipient_student_ids IS NULL AND (` + studentTargetMatchFeed + `))`

// reachedStudentsBound is every live, non-graduated child an announcement's
// targets reach (its recorded children once published, #6988), as the derived table s with the columns id, announcement_id
// and tenant_id. Graduated (alumnus) students are soft-deleted: their
// guardians drop out of every audience once the child has left the OGS.
//
// The set is a MATERIALIZED CTE on purpose. A school seeded or imported after
// the last ANALYZE has a tenant_id the planner estimates at about one row per
// table; joined in one statement with the guardian links, that estimate
// produced nested loops that re-ran the whole student join per guardian and
// exceeded the 10 s read timeout. Computed once, the set stays linear in the
// guardian join whatever the statistics say.
//
// Bind order: school, school, today, today, today, announcement, school.
const reachedStudentsBound = `
			FROM (WITH reached AS MATERIALIZED (
				SELECT DISTINCT s.id, pt.announcement_id, pt.tenant_id
				FROM users.parent_announcement_targets pt
				JOIN users.parent_announcements ra ON ra.id = pt.announcement_id AND ra.tenant_id = pt.tenant_id
				JOIN users.student_profiles s ON s.tenant_id = ?` + studentMembershipJoins + ` AND (` + studentReachedBound + `
				)
				JOIN users.persons p ON p.id = s.person_id AND p.deleted_at IS NULL
					AND sm.status <> 'alumnus'
				WHERE pt.announcement_id = ? AND pt.tenant_id = ?
			) SELECT id, announcement_id, tenant_id FROM reached) s`

// portalGuardiansBound continues reachedStudentsBound with the guardians who
// hold parent_portal.access on the child, a linked account, and an ACTIVE
// membership at the school: a guardian whose mapping went pending or inactive
// keeps the relationship rows but has lost portal access.
//
// Bind order: guardian links of the school, school.
const portalGuardiansBound = `
			JOIN (?) sg ON sg.student_id = s.id
				AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
			JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = ?
				AND gp.account_id IS NOT NULL
			JOIN auth.account_tenants act ON act.account_id = gp.account_id
				AND act.tenant_id = gp.tenant_id AND act.status = 'active'`

// pollGuardiansBound is portalGuardiansBound restricted to guardians who may
// also answer polls for the child.
//
// Bind order: guardian links of the school, school.
const pollGuardiansBound = `
			JOIN (?) sg ON sg.student_id = s.id
				AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
				 AND sg.permissions @> '{"parent_portal.poll.response": true}'::jsonb
			JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = ?
				AND gp.account_id IS NOT NULL
			JOIN auth.account_tenants act ON act.account_id = gp.account_id
				AND act.tenant_id = gp.tenant_id AND act.status = 'active'`

// pollGuardiansForAccountBound is pollGuardiansBound narrowed to one account.
//
// Bind order: guardian links of the school, school, account.
const pollGuardiansForAccountBound = `
			JOIN (?) sg ON sg.student_id = s.id
				AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
				 AND sg.permissions @> '{"parent_portal.poll.response": true}'::jsonb
			JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = ?
				AND gp.account_id IS NOT NULL AND gp.account_id = ?
			JOIN auth.account_tenants act ON act.account_id = gp.account_id
				AND act.tenant_id = gp.tenant_id AND act.status = 'active'`

// pendingApplicantsCTE binds the Enrollment-owned applicant rows as a record
// set, so the audience can be joined without reading Enrollment's tables.
//
// Bind order: applicants (jsonb).
const pendingApplicantsCTE = `WITH pending_applicants AS (
			 SELECT * FROM jsonb_to_recordset(?::jsonb) AS applicant(guardian_account_id bigint, guardian_email text, guardian_first_name text, guardian_last_name text)
			)`

// pendingApplicantsFeedCTE is the cross-school variant with the school on
// every row.
//
// Bind order: applicants (jsonb).
const pendingApplicantsFeedCTE = `WITH pending_applicants AS (
			 SELECT * FROM jsonb_to_recordset(?::jsonb) AS applicant(
			 tenant_id bigint, guardian_account_id bigint, guardian_email text
			 )
			) `

// pendingApplicantAccountsBound resolves the pending_enrollment target to
// accounts: a stamped guardian_account_id, or an unstamped request whose
// guardian_email resolves to an account (the ListByAccount e-mail fallback).
//
// Bind order: announcement, school.
const pendingApplicantAccountsBound = `
			FROM users.parent_announcement_targets pt
			CROSS JOIN pending_applicants req
			LEFT JOIN auth.accounts ea ON req.guardian_account_id IS NULL
				AND ea.email IS NOT NULL
				AND LOWER(TRIM(ea.email)) = LOWER(TRIM(req.guardian_email))
			WHERE pt.announcement_id = ? AND pt.tenant_id = ? AND pt.target_type = 'pending_enrollment'`

// audienceAccountsBound is the distinct guardian ACCOUNT set an announcement
// reaches right now: the student-based targets plus the pending_enrollment
// target.
//
// Bind order: school, school, today, today, today, announcement, school,
// guardian links of the school, school, announcement, school.
const audienceAccountsBound = `
			SELECT DISTINCT gp.account_id AS account_id` + reachedStudentsBound + portalGuardiansBound + `
			UNION
			SELECT DISTINCT COALESCE(req.guardian_account_id, ea.id) AS account_id` + pendingApplicantAccountsBound + `
				AND COALESCE(req.guardian_account_id, ea.id) IS NOT NULL`

// accountChildrenCTE is the bound account's children across schools: each
// child the account holds parent_portal.access on through a linked guardian
// profile with an ACTIVE membership at the child's school, and whether one of
// those relationships also carries parent_portal.poll.response. The feed,
// its outstanding count and the letter children start from it.
//
// The set is a MATERIALIZED CTE on purpose (#7231). Joined in one statement
// with the announcement, its targets and the child's rows, the guardian side
// made the planner search the join orders of about ten relations, and bun
// plans every statement anew: 30 to 75 ms of planning per feed call against
// a few ms of execution. Computed first, from the account's few rows, it
// leaves the planner two small problems. The per-announcement child lists
// (answerableChildrenSQL, declarationChildrenForAccountSQL) keep the inline
// join: without the guardian side they reach join_collapse_limit and measured
// slower to plan, not faster.
//
// Bind order: guardian links, account.
const accountChildrenCTE = `account_children AS MATERIALIZED (
			SELECT sg.tenant_id, sg.student_id,
				bool_or(sg.permissions @> '{"parent_portal.poll.response": true}'::jsonb) AS may_answer
			FROM (?) sg
			JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = sg.tenant_id
				AND gp.account_id = ?
			JOIN auth.account_tenants act ON act.account_id = gp.account_id
				AND act.tenant_id = gp.tenant_id AND act.status = 'active'
			WHERE sg.permissions @> '{"parent_portal.access": true}'::jsonb
			GROUP BY sg.tenant_id, sg.student_id
		)`

// accountReachedChildrenFeed continues a query over announcement a and its
// target row pt with the account's live, non-graduated children that a
// reaches, as s with sm and p. accountChildrenCTE must be in scope as
// account_children.
//
// Bind order: today, today, today.
const accountReachedChildrenFeed = `
			JOIN account_children ac ON ac.tenant_id = a.tenant_id
			JOIN users.student_profiles s ON s.id = ac.student_id AND s.tenant_id = a.tenant_id` + studentMembershipJoins + ` AND (` + studentReachedFeed + `
			)
			JOIN users.persons p ON p.id = s.person_id AND p.deleted_at IS NULL
				AND sm.status <> 'alumnus'`

// reachedAccountFeed is the SQL boolean "the bound account is reached by
// announcement a right now" for the cross-school feed, where the announcement
// and school are column references. accountChildrenCTE must be in scope.
//
// Bind order: today, today, today, account, account.
const reachedAccountFeed = `(
		EXISTS (
			SELECT 1
			FROM users.parent_announcement_targets pt` + accountReachedChildrenFeed + `
			WHERE pt.announcement_id = a.id AND pt.tenant_id = a.tenant_id
		)
		OR EXISTS (
			SELECT 1
			FROM users.parent_announcement_targets pt
			JOIN pending_applicants req ON req.tenant_id = a.tenant_id
				AND (
					req.guardian_account_id = ?
					OR (
						req.guardian_account_id IS NULL
						AND EXISTS (
							SELECT 1 FROM auth.accounts ea
							WHERE ea.id = ? AND ea.email IS NOT NULL
								AND LOWER(TRIM(req.guardian_email)) = LOWER(TRIM(ea.email))
						)
					)
				)
			WHERE pt.announcement_id = a.id AND pt.tenant_id = a.tenant_id
				AND pt.target_type = 'pending_enrollment'
		)
	)`

// reachedAccountBound is reachedAccountFeed for one bound announcement.
//
// Bind order: school, school, today, today, today, announcement, school,
// guardian links of the school, school, account, school, account, account,
// announcement, school.
const reachedAccountBound = `(
		EXISTS (
			SELECT 1` + reachedStudentsBound + `
			JOIN (?) sg ON sg.student_id = s.id
				AND sg.permissions @> '{"parent_portal.access": true}'::jsonb
			JOIN users.guardian_profiles gp ON gp.id = sg.guardian_profile_id AND gp.tenant_id = ?
				AND gp.account_id = ?
			JOIN auth.account_tenants act ON act.account_id = gp.account_id
				AND act.tenant_id = gp.tenant_id AND act.status = 'active'
		)
		OR EXISTS (
			SELECT 1
			FROM users.parent_announcement_targets pt
			JOIN pending_applicants req ON req.tenant_id = ?
				AND (
					req.guardian_account_id = ?
					OR (
						req.guardian_account_id IS NULL
						AND EXISTS (
							SELECT 1 FROM auth.accounts ea
							WHERE ea.id = ? AND ea.email IS NOT NULL
								AND LOWER(TRIM(req.guardian_email)) = LOWER(TRIM(ea.email))
						)
					)
				)
			WHERE pt.announcement_id = ? AND pt.tenant_id = ?
				AND pt.target_type = 'pending_enrollment'
	)
)`

// openPollForAccountFeed is the SQL boolean "announcement a is an open poll
// and at least one of the bound account's reached children has no answer
// yet". A guardian who read a poll but never answered still counts as
// outstanding, because a poll that quietly stops nagging is a poll nobody
// answers. accountChildrenCTE must be in scope.
//
// Bind order: now, today, today, today.
const openPollForAccountFeed = `(
		a.response_type <> 'none'
		AND (a.response_deadline IS NULL OR a.response_deadline > ?)
		AND EXISTS (
			SELECT 1
			FROM users.parent_announcement_targets pt` + accountReachedChildrenFeed + `
			WHERE pt.announcement_id = a.id AND pt.tenant_id = a.tenant_id
				AND ac.may_answer
				AND NOT EXISTS (
					SELECT 1 FROM users.parent_announcement_responses resp
					WHERE resp.announcement_id = a.id AND resp.student_id = s.id
				)
		)
	)`

// feedScopePredicate selects hand-written rows from schools with news on and
// system-authored rows from schools with the cancellation-notice gate on.
//
// Bind order: news schools, notice-only schools.
const feedScopePredicate = `((a.tenant_id IN (?) AND a.system_kind IS NULL) OR (a.tenant_id IN (?) AND a.system_kind IS NOT NULL))`

// liveAnnouncementPredicate is "published, active, and not expired" at the
// projection's instant, the clock that stamps the publication (#7295).
//
// Bind order: now, now.
const liveAnnouncementPredicate = `
				AND a.active
				AND a.published_at IS NOT NULL
				AND a.published_at <= ?
				AND (a.expires_at IS NULL OR a.expires_at > ?)`

// pollAudienceStudentsBound is every portal-visible child a poll reaches.
// Staff results must include every child the announcement reaches, even if
// no guardian may answer the poll.
//
// Bind order: school, school, today, today, today, announcement, school,
// guardian links of the school, school.
const pollAudienceStudentsBound = `
			SELECT DISTINCT s.id AS student_id` + reachedStudentsBound + portalGuardiansBound

// pollAnswerableStudentsBound is the subset of the audience for which at least
// one guardian currently has poll.response: the completion denominator and
// reminder source.
//
// Bind order: school, school, today, today, today, announcement, school,
// guardian links of the school, school.
const pollAnswerableStudentsBound = `
			SELECT DISTINCT s.id AS student_id` + reachedStudentsBound + pollGuardiansBound

// pollAnswerableStudentsForAccountBound narrows pollAnswerableStudentsBound to
// one guardian's children.
//
// Bind order: school, school, today, today, today, announcement, school,
// guardian links of the school, school, account.
const pollAnswerableStudentsForAccountBound = `
			SELECT DISTINCT s.id AS student_id` + reachedStudentsBound + pollGuardiansForAccountBound

// letterReachedStudentsBound is every child the announcement's targets reach
// with NO guardian requirement at all. A letter to the whole school reaches
// every child in it; whether anyone can confirm for a given child is a
// separate question.
//
// Bind order: school, school, today, today, today, announcement, school.
const letterReachedStudentsBound = `
			SELECT DISTINCT s.id AS student_id` + reachedStudentsBound
