package compose

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Nachweise am Personalstamm (#4707): the warning before a proof of the
// Träger expires reaches the Leitung of every live Einsatzort once and the
// person once, and the school's own reminder of a kind it mapped onto the
// Träger's stays silent for the people the Träger keeps.

// schoolStaffFake answers the staff reads per school of the transaction.
type schoolStaffFake map[int64]qualificationStaffFake

type proofSchoolKey struct{}

func (f schoolStaffFake) of(ctx context.Context) qualificationStaffFake {
	school, _ := ctx.Value(proofSchoolKey{}).(int64)
	return f[school]
}

func (f schoolStaffFake) ListStaffMembers(ctx context.Context) ([]workforce.QualificationStaffMember, error) {
	return f.of(ctx).ListStaffMembers(ctx)
}

func (f schoolStaffFake) StaffContact(ctx context.Context, staffID int64) (workforce.QualificationStaffMember, error) {
	return f.of(ctx).StaffContact(ctx, staffID)
}

func (f schoolStaffFake) StammdatenManagers(ctx context.Context) ([]workforce.QualificationStaffMember, error) {
	return f.of(ctx).StammdatenManagers(ctx)
}

type proofRuntime struct{}

func (proofRuntime) WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
	return testpkg.WithinCurrentTenant(context.WithValue(testpkg.ContextForTenant(ctx, schoolID), proofSchoolKey{}, schoolID), fn)
}

func (proofRuntime) WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error {
	return testpkg.WithinTraeger(ctx, organizationID, fn)
}

type proofFixture struct {
	organization int64
	north, south int64
	mira         [2]int64 // the employments of one person at north and south
	proof        int64
}

func exec(t *testing.T, db *bun.DB, query string, args ...any) int64 {
	t.Helper()
	var id int64
	require.NoError(t, db.NewRaw(query, args...).Scan(context.Background(), &id))
	return id
}

// newProofFixture keeps one person of two schools in a record of a released
// Träger with a certificate of conduct that expires on 31.01.2027; its
// twelve-week lead starts on 08.11.2026.
func newProofFixture(t *testing.T, db *bun.DB) proofFixture {
	t.Helper()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Nachweise", Slug: fmt.Sprintf("traeger-nachweise-%d", time.Now().UnixNano())})
	f := proofFixture{organization: organization.ID}
	f.north = testpkg.CreateTestSchoolInOrganization(t, db, f.organization, "OGS Nord")
	f.south = testpkg.CreateTestSchoolInOrganization(t, db, f.organization, "OGS Süd")
	f.mira[0] = testpkg.CreateTestStaffForTenant(t, db, f.north, "Mira", "Sommer").ID
	f.mira[1] = testpkg.CreateTestStaffForTenant(t, db, f.south, "Mira", "Sommer").ID
	exec(t, db, `INSERT INTO workforce.staff_releases (organization_id, representation, released_by_operator_id) VALUES (?, 'none', 1) RETURNING organization_id`, f.organization)
	record := exec(t, db, `INSERT INTO workforce.staff_records (organization_id, first_name, last_name) VALUES (?, 'Mira', 'Sommer') RETURNING id`, f.organization)
	for i, school := range []int64{f.north, f.south} {
		exec(t, db, `INSERT INTO workforce.staff_record_links (organization_id, staff_record_id, school_id, membership_id, linked_by_account_id)
			VALUES (?, ?, ?, ?, 1) RETURNING id`, f.organization, record, school, f.mira[i])
	}
	kind := exec(t, db, `INSERT INTO workforce.staff_proof_types (organization_id, standard_key, name, validity_months, reminder_lead_weeks, mandatory)
		VALUES (?, 'police_certificate', 'Erweitertes Führungszeugnis', 60, 12, TRUE) RETURNING id`, f.organization)
	f.proof = exec(t, db, `INSERT INTO workforce.staff_proofs (organization_id, staff_record_id, type_id, presented_on, issued_on, no_relevant_entry, expires_on, recorded_by_account_id)
		VALUES (?, ?, ?, '2022-02-10', '2022-01-31', TRUE, '2027-01-31', 1) RETURNING id`, f.organization, record, kind)
	return f
}

func TestTraegerProofRemindersWarnEveryEinsatzortOnce(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	f := newProofFixture(t, db)
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	directory := schoolStaffFake{
		f.north: {
			members:  []workforce.QualificationStaffMember{{StaffID: f.mira[0], FirstName: "Mira", LastName: "Sommer", AccountID: 901, Email: "mira@example.com"}},
			managers: []workforce.QualificationStaffMember{{StaffID: 1, FirstName: "Lea", LastName: "Nord", AccountID: 900, Email: "nord@example.com"}},
		},
		f.south: {
			members:  []workforce.QualificationStaffMember{{StaffID: f.mira[1], FirstName: "Mira", LastName: "Sommer", AccountID: 901, Email: "mira@example.com"}},
			managers: []workforce.QualificationStaffMember{{StaffID: 2, FirstName: "Sven", LastName: "Süd", AccountID: 910, Email: "sued@example.com"}},
		},
	}
	deliveries := &qualificationDeliveries{}
	var mu sync.Mutex
	today := calendar.NewDate(2026, 11, 7)
	composed, err := NewQualifications(db, directory, workforce.QualificationReminderPorts{
		Notify: deliveries.notify, Mail: deliveries, Schools: qualificationSchoolFake{},
		FrontendURL:    "https://moto.example.com",
		Traeger:        func(context.Context) ([]int64, error) { return []int64{f.organization}, nil },
		TraegerRuntime: proofRuntime{},
	}, func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return today.BerlinMidnight().Add(12 * time.Hour)
	})
	require.NoError(t, err)
	reminders := composed.TraegerProofs
	setToday := func(day calendar.Date) {
		mu.Lock()
		defer mu.Unlock()
		today = day
	}

	require.NoError(t, reminders.RunDue(ctx))
	notices, mails := deliveries.counts()
	assert.Zero(t, notices, "nothing the day before the twelve-week lead starts")
	assert.Zero(t, mails)

	setToday(calendar.NewDate(2026, 11, 8))
	require.NoError(t, reminders.RunDue(ctx))
	notices, mails = deliveries.counts()
	require.Equal(t, 3, notices, "the Leitung of both Einsatzorte and the person once")
	assert.Equal(t, 3, mails)
	recipients := map[int64]int{}
	for _, notice := range deliveries.notices {
		for _, account := range notice.RecipientAccountIDs {
			recipients[account]++
		}
		assert.Contains(t, notice.Body, "Erweitertes Führungszeugnis")
		assert.NotContains(t, notice.Body, "Sommer", "a push names no person")
	}
	assert.Equal(t, map[int64]int{900: 1, 910: 1, 901: 1}, recipients)

	require.NoError(t, reminders.RunDue(ctx))
	notices, _ = deliveries.counts()
	assert.Equal(t, 3, notices, "the claimed lead reminder goes out once")

	// South ends the employment; the expiry day reaches north only.
	directory[f.south] = qualificationStaffFake{managers: directory[f.south].managers}
	setToday(calendar.NewDate(2027, 1, 31))
	require.NoError(t, reminders.RunDue(ctx))
	notices, _ = deliveries.counts()
	assert.Equal(t, 5, notices, "the expiry day: Leitung north and the person")
	assert.Contains(t, deliveries.notices[3].Title, "heute")
	var claimed int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM workforce.staff_proofs WHERE id = ? AND lead_reminded_for = '2027-01-31' AND expiry_reminded_for = '2027-01-31'`, f.proof).Scan(context.Background(), &claimed))
	assert.Equal(t, 1, claimed)
}

func TestSchoolRemindersLeaveKindsTheTraegerKeepsToItsProofs(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	f := newProofFixture(t, db)
	school := testpkg.TenantContext(f.north)
	capability := buildWorkforce(t, db)
	schoolKind := exec(t, db, `INSERT INTO users.staff_qualification_types (tenant_id, standard_key, name, validity_months)
		VALUES (?, 'extended_police_certificate', 'Erweitertes Führungszeugnis', 60) RETURNING id`, f.north)
	other := testpkg.CreateTestStaffForTenant(t, db, f.north, "Jonas", "Keller").ID
	for _, staffID := range []int64{f.mira[0], other} {
		_, err := capability.ReplaceStaffQualifications(school, staffID, []workforce.StaffQualification{{TypeID: &schoolKind, ExpiresOn: "2026-12-28"}})
		require.NoError(t, err)
	}
	deliveries := &qualificationDeliveries{}
	reminders, err := NewQualifications(db, qualificationStaffFake{
		members: []workforce.QualificationStaffMember{{StaffID: f.mira[0], AccountID: 901}, {StaffID: other, AccountID: 902}},
	}, workforce.QualificationReminderPorts{Notify: deliveries.notify, Mail: deliveries, Schools: qualificationSchoolFake{}},
		func() time.Time { return calendar.NewDate(2026, 11, 2).BerlinMidnight().Add(12 * time.Hour) })
	require.NoError(t, err)

	require.NoError(t, runWithin(t, school, reminders.RunDue))
	notices, _ := deliveries.counts()
	assert.Equal(t, 2, notices, "without a mapping the school reminds both people")

	exec(t, db, `INSERT INTO workforce.staff_proof_type_mappings (organization_id, school_id, school_type_id, proof_type_id, mapped_by_account_id)
		SELECT ?, ?, ?, id, 1 FROM workforce.staff_proof_types WHERE organization_id = ? RETURNING school_id`, f.organization, f.north, schoolKind, f.organization)
	_, err = capability.ReplaceStaffQualifications(school, f.mira[0], []workforce.StaffQualification{{TypeID: &schoolKind, ExpiresOn: "2026-12-27"}})
	require.NoError(t, err)
	_, err = capability.ReplaceStaffQualifications(school, other, []workforce.StaffQualification{{TypeID: &schoolKind, ExpiresOn: "2026-12-27"}})
	require.NoError(t, err)
	require.NoError(t, runWithin(t, school, reminders.RunDue))
	notices, _ = deliveries.counts()
	assert.Equal(t, 3, notices, "a mapped kind of a person the Träger keeps reminds through the Träger; the others stay")
	assert.Equal(t, other, deliveries.notices[2].StaffID)

	proofs, err := within(t, school, func(ctx context.Context) ([]workforce.SchoolTraegerProof, error) {
		return reminders.StaffTraegerProofs(ctx, f.mira[0])
	})
	require.NoError(t, err)
	assert.Equal(t, []workforce.SchoolTraegerProof{{TypeName: "Erweitertes Führungszeugnis", Status: workforce.TraegerProofStatusValid, ExpiresOn: "2027-01-31"}}, proofs,
		"the school sees the status of the Träger's proof, nothing of the proof itself")
	none, err := within(t, school, func(ctx context.Context) ([]workforce.SchoolTraegerProof, error) {
		return reminders.StaffTraegerProofs(ctx, other)
	})
	require.NoError(t, err)
	assert.Empty(t, none, "a person the Träger does not keep has no Träger proofs")
	southView, err := within(t, testpkg.TenantContext(f.south), func(ctx context.Context) ([]workforce.SchoolTraegerProof, error) {
		return reminders.StaffTraegerProofs(ctx, f.mira[0])
	})
	require.NoError(t, err)
	assert.Empty(t, southView, "another school does not read north's employment")
}
