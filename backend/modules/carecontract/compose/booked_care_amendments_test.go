package compose_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestSchoolContractProjectionsUseOnlyConcludedChangesOrTheInitialOffer(t *testing.T) {
	t.Parallel()
	for name, scenario := range map[string]struct {
		firstStatus, nextStatus string
		active                  bool
		wantVersion             int
	}{
		"initial offer":       {firstStatus: "beantragt", wantVersion: 1},
		"waiting amendment":   {firstStatus: "wirksam", nextStatus: "beantragt", active: true, wantVersion: 1},
		"cancelled amendment": {firstStatus: "wirksam", nextStatus: "ueberholt", active: true, wantVersion: 1},
		"signed amendment":    {firstStatus: "abgeloest", nextStatus: "wirksam", active: true, wantVersion: 2},
		"replaced offer":      {firstStatus: "ueberholt", nextStatus: "beantragt", wantVersion: 2},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			db := testpkg.SetupTestDB(t)
			ctx := tenant.WithUnitOfWork(t.Context(), testpkg.TenantRuntime(t, db))
			organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
				Name: "Träger Vertragsänderung", Slug: fmt.Sprintf("traeger-soll-aenderung-%d", testpkg.UniqueTestTenantID(t)),
			}).ID
			testpkg.OwnTraegerCareContracts(t, db, organization)
			school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "OGS Vertragsänderung")
			student := testpkg.UniqueTestTenantID(t)
			august, september := calendar.NewDate(2099, 8, 3), calendar.NewDate(2099, 9, 1)
			contract := testpkg.CreateTestCareContract(t, db, organization, school, student, "versendet", august,
				testpkg.CareContractService{Weekday: "mon", Module: "Früh", EndsAt: "14:00"})
			if scenario.firstStatus == "abgeloest" {
				_, err := db.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = 'wirksam' WHERE contract_id = ?`, contract)
				require.NoError(t, err)
			}
			_, err := db.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = ? WHERE contract_id = ?`, scenario.firstStatus, contract)
			require.NoError(t, err)
			if scenario.active {
				_, err = db.ExecContext(ctx, `UPDATE care_contract.contracts SET status = 'aktiv', concluded_at = NOW(),
					conclusion_method = 'mit_anmeldung' WHERE id = ?`, contract)
				require.NoError(t, err)
			}
			if scenario.nextStatus != "" {
				var next int64
				require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contract_versions (organization_id, contract_id, version_number,
						effective_from, ends_on, child_first_name, child_last_name, school_name, term_kind, notice_months, notice_to,
						special_termination, special_termination_note, statute_required, statute_title, statute_url, contract_partner, source)
					VALUES (?, ?, 2, ?, '2099-12-31', 'Kind', 'Vertrag', 'Schule', 'open_ended', 1, 'month_end',
						false, '', false, '', '', '', 'buchungsaenderung') RETURNING id`,
					organization, contract, september).Scan(ctx, &next))
				_, err = db.ExecContext(ctx, `INSERT INTO care_contract.contract_version_services (organization_id,
						contract_version_id, weekday, care_offering_id, module_name, ends_at)
					VALUES (?, ?, 'mon', 1, 'Ganztag', '16:00'), (?, ?, 'wed', 1, 'Ganztag', '16:00')`,
					organization, next, organization, next)
				require.NoError(t, err)
				_, err = db.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = ? WHERE id = ?`, scenario.nextStatus, next)
				require.NoError(t, err)
			}
			var child int64
			require.NoError(t, db.NewRaw(`SELECT request_child_id FROM care_contract.contracts WHERE id = ?`, contract).Scan(ctx, &child))
			id, err := tenant.NewTenantID(school)
			require.NoError(t, err)
			require.NoError(t, tenant.WithinTenant(ctx, id, func(txCtx context.Context) error {
				booked, err := compose.NewBookedCare().BookedCare(txCtx, []int64{student}, september, calendar.NewDate(2100, 1, 31))
				if err != nil {
					return err
				}
				contracts, err := compose.NewApplicationContracts().ApplicationContracts(txCtx, []int64{child})
				if err != nil {
					return err
				}
				soll := booked[student]
				wantEnd, wantStart, wantServices := "14:00", august, 1
				if scenario.wantVersion == 2 {
					wantEnd, wantStart, wantServices = "16:00", september, 2
				}
				pickup := soll.Day(calendar.NewDate(2099, 9, 7)).EndsAt
				require.NotNil(t, pickup)
				assert.Equal(t, wantEnd, pickup.Time().Format("15:04"), "pickup follows the valid offer or concluded version")
				assert.Equal(t, scenario.wantVersion == 2, soll.Day(calendar.NewDate(2099, 9, 9)).Booked)
				if !scenario.active {
					assert.Len(t, soll.Versions, 1, "an overtaken first offer never returns")
					assert.Equal(t, scenario.wantVersion, soll.Versions[0].Number)
					assert.Equal(t, scenario.wantVersion == 1, soll.Day(calendar.NewDate(2100, 1, 4)).InForce)
				} else if scenario.wantVersion == 1 {
					assert.Len(t, soll.Versions, 1, "unsigned changes do not enter the school's Soll")
				}
				require.Len(t, contracts, 1)
				assert.Equal(t, &wantStart, contracts[0].EffectiveFrom)
				require.Len(t, contracts[0].Services, wantServices)
				assert.Equal(t, wantEnd, contracts[0].Services[0].EndsAt)
				return nil
			}))
		})
	}
}
