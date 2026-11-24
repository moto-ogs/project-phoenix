package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("enrollment.holiday_host_registration_consents", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableEnrollmentHolidayHostRegistrationConsentsSQL)
		return err
	})
}

// repeatableEnrollmentHolidayHostRegistrationConsentsSQL is the definition
// of enrollment.holiday_host_registration_consents() (#8038, ADR 0321, ADR
// 0223). Change the function here.
//
// It tells the hosting school of a holiday week, in its tenant transaction,
// the voluntary consents of the registration of one of its children: every
// enabled consent block of the form version the registration came with, in
// the order of the form, whether the parents gave it right now and since
// when, or since when they withdrew it. Nothing is copied: a withdrawal in
// the parents portal answers "given": false in the next read.
//
// It answers only while enrollment.holiday_host_booking admits the child's
// booking of that week to the calling school (the school hosts the week of
// a published period at its Träger, the registration is confirmed, the
// booking placed, the last day not passed) and NULL otherwise. It returns
// no other field of the registration: no guardian, no answer, no health
// information.
const repeatableEnrollmentHolidayHostRegistrationConsentsSQL = `
CREATE OR REPLACE FUNCTION enrollment.holiday_host_registration_consents(p_organization_id BIGINT, p_week_id BIGINT, p_child_id BIGINT)
	RETURNS JSONB
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
	AS $$
	SELECT COALESCE(jsonb_agg(jsonb_build_object(
			'key', block.definition->>'key',
			'title', COALESCE(block.definition->>'title', ''),
			'label', COALESCE(block.definition->>'label', ''),
			'given', registration.legal_acceptances->(block.definition->>'key') IS NOT NULL,
			'changed_at', COALESCE(registration.legal_acceptances->(block.definition->>'key'),
				registration.legal_withdrawals->(block.definition->>'key')))
			ORDER BY COALESCE((block.definition->>'sort_order')::int, 0), block.position)
			FILTER (WHERE block.definition IS NOT NULL), '[]'::jsonb)
	FROM enrollment.holiday_registration_children AS child
	JOIN enrollment.holiday_registrations AS registration
		ON registration.organization_id = child.organization_id AND registration.id = child.holiday_registration_id
	LEFT JOIN enrollment.holiday_period_forms AS form
		ON form.organization_id = registration.organization_id AND form.holiday_period_id = registration.holiday_period_id
			AND form.version = registration.form_version
	LEFT JOIN LATERAL jsonb_array_elements(COALESCE(form.legal_blocks, '[]'::jsonb)) WITH ORDINALITY AS block(definition, position)
		ON block.definition->>'kind' = 'consent' AND COALESCE((block.definition->>'enabled')::boolean, false)
	WHERE child.organization_id = p_organization_id AND child.id = p_child_id
		AND enrollment.holiday_host_booking(p_organization_id, p_week_id, p_child_id)
	GROUP BY registration.id
	$$;
REVOKE ALL ON FUNCTION enrollment.holiday_host_registration_consents(BIGINT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enrollment.holiday_host_registration_consents(BIGINT, BIGINT, BIGINT) TO phoenix_tenant;
COMMENT ON FUNCTION enrollment.holiday_host_registration_consents(BIGINT, BIGINT, BIGINT) IS
	'The voluntary consents of the registration of a child of a week the calling school hosts, read live; NULL when the school has no access to the booking (#8038, ADR 0321).';
`
