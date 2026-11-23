// Router-level tests for the Personalstamm of the Träger (#4705, ADR 0089,
// ADR 0233): the Personalverwaltung of a released Träger sees the staff of
// all its schools with proposals, links the employments of one person into
// one record with one personnel number per Träger, and the bank values move
// from the schools into the record. A school keeps seeing only its own
// staff; a role without the right gets 403; no Träger reaches another
// Träger's records; every read of personal data is in the access log of
// each school it shows.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// newTraegerStaffFixture mounts the staff record routes of the Träger as the
// serving root does and returns them with the school side they write into.
func newTraegerStaffFixture(t *testing.T, db *bun.DB) (http.Handler, *traegerPortalHandler, *workforce.StaffAdmin, tenant.UnitOfWork, traegerOffice) {
	t.Helper()
	return newTraegerStaffFixtureAt(t, db, nil)
}

// newTraegerStaffFixtureAt is newTraegerStaffFixture on a pinned clock; nil
// is the wall clock.
func newTraegerStaffFixtureAt(t *testing.T, db *bun.DB, now func() time.Time) (http.Handler, *traegerPortalHandler, *workforce.StaffAdmin, tenant.UnitOfWork, traegerOffice) {
	t.Helper()
	handler, portal, admin, unit, office, _ := newTraegerStaffFixtureWith(t, db, now, &StaffPlanningTestRules{})
	return handler, portal, admin, unit, office
}

// newTraegerStaffFixtureWith also mounts the Einsatzplanung (#4708) over the
// real Dienstplan with rules, and returns the school's staff-shift router.
func newTraegerStaffFixtureWith(t *testing.T, db *bun.DB, now func() time.Time, rules *StaffPlanningTestRules) (http.Handler, *traegerPortalHandler, *workforce.StaffAdmin, tenant.UnitOfWork, traegerOffice, http.Handler) {
	t.Helper()
	unit := testpkg.TenantRuntime(t, db)
	portal, _ := traegerPortalOn(t, db, unit)
	organizations, err := owners.NewOrganizationTenancy(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	persons, err := owners.NewPeopleDirectory(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	repos := NewPeopleRepositorySuiteFactory(testpkg.NewDatabase(t, db))
	membership := NewSchoolMembershipSuiteRepositories(testpkg.NewDatabase(t, db)).SchoolMembership()
	audits := owners.NewTestAuditPersistence(testpkg.MustDatabase(db), nil)
	admin, err := NewStaffAdmin(testpkg.MustDatabase(db), repos.Staff, repos.Person, membership, StaffAdminDependencies{
		MasterDataAudit: audits.StaffMasterDataChange, PersonnelNumber: audits.PersonnelNumberChange, DataAccessLog: audits.DataAccessLog,
		Now: now,
	})
	require.NoError(t, err)
	tenantAudit, err := auditCompose.NewTenantPersistence(db, time.Now)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(tenant.WithUnitOfWork(r.Context(), unit)))
		})
	})
	schoolShifts, sites, err := StaffPlanningTestComposition(testpkg.NewDatabase(t, db), rules)
	require.NoError(t, err)
	// The school months of the Stundenkonto (#4711) come from the time
	// tracking the service graph composes.
	var clocks []func() time.Time
	if now != nil {
		clocks = append(clocks, now)
	}
	workforceModule, _, err := NewWorkforceTestModule(testpkg.NewDatabase(t, db), unit, clocks...)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(testpkg.NewDatabase(t, db), unit)
	require.NoError(t, err)
	// The school's routes: its Dienstplan and, under /api as in production,
	// the Vertretungspool (#4709).
	tenantAPI := chi.NewRouter()
	schoolRoutes := chi.NewRouter()
	schoolRoutes.Handle("/staff-shifts/*", schoolShifts)
	schoolRoutes.Mount("/api", tenantAPI)
	// The first block employs a Springer through Identity & Access (#7173).
	identity, err := lifecycleTestModule(testpkg.NewDatabase(t, db), unit, GuardianInvitationTestConfig{})
	require.NoError(t, err)
	require.NoError(t, mountTraegerStaffRoutes(router, tenantAPI, admin, workforceModule.TimeTracking.TraegerMonths, organizations, persons, membership, tenantAudit.DataAccessLog, sites,
		workforceModule.TimeTracking.TraegerExports, settings.Traeger, identity, workforceModule.TimeTracking.Today))
	office := newTraegerOffice(t, db, portal, "Träger Personal", identityaccess.TraegerRolePersonnel)
	return testpkg.SessionVerifier(router), portal, admin, unit, office, schoolRoutes
}

func staffRelease(t *testing.T, db *bun.DB, organization int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO workforce.staff_releases (organization_id, representation, released_by_operator_id) VALUES (?, 'agreement', 1)`, organization)
	require.NoError(t, err)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	return envelope.Data
}

// setPersonnelNumber gives an employment of a school its number.
func staffSetPersonnelNumber(t *testing.T, db *bun.DB, schoolID, staffID int64, number string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `UPDATE users.staff_employment_profiles SET personnel_number = ? WHERE tenant_id = ? AND membership_id = ?`, number, schoolID, staffID)
	require.NoError(t, err)
}

// setIBAN seals an IBAN into the school's bank row as the school would.
func staffSetIBAN(t *testing.T, db *bun.DB, schoolID, staffID int64, iban string) {
	t.Helper()
	cipher, err := BankDataCipher(viper.GetString("bank_data_keys"), "")
	require.NoError(t, err)
	sealed, err := cipher.Seal([]byte(iban), []byte("users.staff_financial_data.iban|"+strconv.FormatInt(schoolID, 10)+"|"+strconv.FormatInt(staffID, 10)))
	require.NoError(t, err)
	_, err = db.ExecContext(context.Background(), `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked) VALUES (?, ?, ?, ?)`,
		schoolID, staffID, sealed, "•••• "+iban[len(iban)-4:])
	require.NoError(t, err)
}

func staffSchoolValue(t *testing.T, db *bun.DB, query string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, db.NewRaw(query, args...).Scan(context.Background(), &n))
	return n
}

// accessEntries counts the access log entries of the Träger by school.
func staffAccessEntries(t *testing.T, db *bun.DB, organization int64, resource string) map[int64]int {
	t.Helper()
	var rows []struct {
		TenantID int64 `bun:"tenant_id"`
		N        int   `bun:"n"`
	}
	require.NoError(t, db.NewRaw(`SELECT tenant_id, COUNT(*) AS n FROM audit.data_access_log
		WHERE resource_type = ? AND actor_role = 'traeger' AND metadata->>'organization_id' = ? GROUP BY tenant_id`,
		resource, strconv.FormatInt(organization, 10)).Scan(context.Background(), &rows))
	entries := map[int64]int{}
	for _, row := range rows {
		entries[row.TenantID] = row.N
	}
	return entries
}

// staffAccessViews counts the access log entries of one view of the Träger
// by school.
func staffAccessViews(t *testing.T, db *bun.DB, organization int64, view string) map[int64]int {
	t.Helper()
	var rows []struct {
		TenantID int64 `bun:"tenant_id"`
		N        int   `bun:"n"`
	}
	require.NoError(t, db.NewRaw(`SELECT tenant_id, COUNT(*) AS n FROM audit.data_access_log
		WHERE actor_role = 'traeger' AND metadata->>'organization_id' = ? AND metadata->>'view' = ? GROUP BY tenant_id`,
		strconv.FormatInt(organization, 10), view).Scan(context.Background(), &rows))
	entries := map[int64]int{}
	for _, row := range rows {
		entries[row.TenantID] = row.N
	}
	return entries
}

func staffInSchool(t *testing.T, unit tenant.UnitOfWork, schoolID int64) context.Context {
	t.Helper()
	return tenant.WithTenantID(tenant.WithUnitOfWork(context.Background(), unit), schoolID)
}

// assertStaffRefusal checks status and registered code of a refusal.
func assertStaffRefusal(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	require.Equal(t, status, rec.Code, rec.Body.String())
	assert.Equal(t, code, refusalOf(t, rec).Code)
}

type staffOverviewBody struct {
	Release *struct {
		Representation string `json:"representation"`
	} `json:"release"`
	Schools []struct {
		ID wireID `json:"id"`
	} `json:"schools"`
	Records     []staffRecordBody `json:"records"`
	Suggestions []struct {
		Reason   string  `json:"reason"`
		RecordID *wireID `json:"staff_record_id"`
		Members  []struct {
			SchoolID wireID `json:"school_id"`
			StaffID  wireID `json:"staff_id"`
			LastName string `json:"last_name"`
		} `json:"members"`
	} `json:"suggestions"`
}

type staffRecordBody struct {
	ID              wireID  `json:"id"`
	FirstName       string  `json:"first_name"`
	LastName        string  `json:"last_name"`
	Birthday        string  `json:"birthday"`
	PersonnelNumber *string `json:"personnel_number"`
	HasFinancial    bool    `json:"has_financial"`
	Employments     []struct {
		SchoolID wireID `json:"school_id"`
		StaffID  wireID `json:"staff_id"`
		Active   bool   `json:"active"`
	} `json:"employments"`
	Financial struct {
		IBAN *string `json:"iban"`
	} `json:"financial"`
	Changes []struct {
		Kind     string  `json:"kind"`
		Field    string  `json:"field"`
		Value    string  `json:"value"`
		SchoolID *wireID `json:"school_id"`
	} `json:"changes"`
}

// TestTraegerStaffRecordsLinkThePeopleOfAllSchools walks the acceptance of
// #4705 end to end.
func TestTraegerStaffRecordsLinkThePeopleOfAllSchools(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, admin, unit, office := newTraegerStaffFixture(t, db)
	north, south := office.schools[0], office.schools[1]

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer-Berg")
	jonas := testpkg.CreateTestStaffForTenant(t, db, south, "Jonas", "Keller")
	staffSetPersonnelNumber(t, db, north, miraNorth.ID, "70001")
	staffSetIBAN(t, db, south, miraSouth.ID, "DE89370400440532013000")

	t.Run("without the release the Träger sees no person", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		overview := decode[staffOverviewBody](t, rec)
		assert.Nil(t, overview.Release)
		assert.Len(t, overview.Schools, 2)
		assert.Empty(t, overview.Suggestions)
		rec = traegerLink(t, router, office.token, map[string]any{
			"members": []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}},
		})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_not_released")
		assert.Empty(t, staffAccessEntries(t, db, office.organization, "traeger_staff_records"))
	})

	staffRelease(t, db, office.organization)
	members := []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}, {"school_id": south, "staff_id": miraSouth.ID}}

	t.Run("the overview proposes the same account at both schools", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		overview := decode[staffOverviewBody](t, rec)
		require.NotNil(t, overview.Release)
		assert.Equal(t, "agreement", overview.Release.Representation)
		require.NotEmpty(t, overview.Suggestions)
		first := overview.Suggestions[0]
		assert.Equal(t, workforce.TraegerStaffMatchAccount, first.Reason)
		require.Len(t, first.Members, 2)
		assert.ElementsMatch(t, []int64{miraNorth.ID, miraSouth.ID}, []int64{int64(first.Members[0].StaffID), int64(first.Members[1].StaffID)})
		assert.Equal(t, map[int64]int{north: 1, south: 1}, staffAccessEntries(t, db, office.organization, "traeger_staff_records"),
			"each school whose people the overview shows logs the read")
	})

	t.Run("a link needs a choice where the schools disagree", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/link-preview", map[string]any{"members": members})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var preview struct {
			Fields []struct {
				Field    string `json:"field"`
				Conflict bool   `json:"conflict"`
				Options  []struct {
					Source string `json:"source"`
					Value  string `json:"value"`
				} `json:"options"`
			} `json:"fields"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &struct{ Data any }{Data: &preview}))
		conflicts := map[string]bool{}
		for _, field := range preview.Fields {
			conflicts[field.Field] = field.Conflict
			if field.Field == "iban" {
				require.Len(t, field.Options, 1)
				assert.Equal(t, "•••• 3000", field.Options[0].Value, "the preview shows the mask only")
			}
		}
		assert.True(t, conflicts["last_name"])
		assert.False(t, conflicts["first_name"])
		rec = traegerLink(t, router, office.token, map[string]any{"members": members})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_staff_link_invalid")
	})

	t.Run("a number another person of a school holds is refused before anything moves", func(t *testing.T) {
		staffSetPersonnelNumber(t, db, south, jonas.ID, "70001")
		rec := traegerLink(t, router, office.token, map[string]any{
			"members": members, "choices": map[string]string{"last_name": strconv.FormatInt(south, 10)},
		})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.personnel_number_taken")
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records WHERE organization_id = ?`, office.organization), "no record was written")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.staff_financial_data WHERE staff_id = ?`, miraSouth.ID), "the school keeps its bank row")
		_, err := db.ExecContext(context.Background(), `UPDATE users.staff_employment_profiles SET personnel_number = NULL WHERE membership_id = ?`, jonas.ID)
		require.NoError(t, err)
	})

	t.Run("a link takes no value that changed since its preview", func(t *testing.T) {
		stale, ok := readToken(t, traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/link-preview", map[string]any{"members": members}), "fingerprint")
		require.True(t, ok)
		reseal := func(iban string) {
			cipher, err := BankDataCipher(viper.GetString("bank_data_keys"), "")
			require.NoError(t, err)
			sealed, err := cipher.Seal([]byte(iban), []byte("users.staff_financial_data.iban|"+strconv.FormatInt(south, 10)+"|"+strconv.FormatInt(miraSouth.ID, 10)))
			require.NoError(t, err)
			_, err = db.ExecContext(context.Background(), `UPDATE users.staff_financial_data SET iban_sealed = ? WHERE tenant_id = ? AND staff_id = ?`, sealed, south, miraSouth.ID)
			require.NoError(t, err)
		}
		// The school enters another IBAN behind the same mask.
		reseal("DE02120300000000203000")
		for _, fingerprint := range []string{stale, ""} {
			rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
				"members": members, "choices": map[string]string{"last_name": strconv.FormatInt(south, 10)}, "expected_fingerprint": fingerprint,
			})
			assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		}
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records WHERE organization_id = ?`, office.organization), "no record was written")
		reseal("DE89370400440532013000")
	})

	var record staffRecordBody
	t.Run("the link takes the chosen values and the bank values of the schools", func(t *testing.T) {
		rec := traegerLink(t, router, office.token, map[string]any{
			"members": members, "choices": map[string]string{"last_name": strconv.FormatInt(south, 10)},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		record = decode[staffRecordBody](t, rec)
		assert.Equal(t, "Sommer-Berg", record.LastName)
		require.NotNil(t, record.PersonnelNumber)
		assert.Equal(t, "70001", *record.PersonnelNumber)
		assert.True(t, record.HasFinancial)
		require.NotNil(t, record.Financial.IBAN)
		assert.Equal(t, "•••• 3000", *record.Financial.IBAN)
		assert.Len(t, record.Employments, 2)
		notChosen := 0
		for _, change := range record.Changes {
			if change.Kind == workforce.TraegerStaffChangeNotChosen {
				notChosen++
				assert.Equal(t, "last_name", change.Field)
				assert.Equal(t, "Sommer", change.Value)
				require.NotNil(t, change.SchoolID)
				assert.Equal(t, north, int64(*change.SchoolID), "the value not taken keeps its school")
			}
		}
		assert.Equal(t, 1, notChosen)
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.staff_financial_data WHERE staff_id IN (?, ?)`, miraNorth.ID, miraSouth.ID),
			"no school keeps a copy of the bank values")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.staff_employment_profiles WHERE tenant_id = ? AND membership_id = ? AND personnel_number = '70001'`, south, miraSouth.ID),
			"every Einsatzort carries the Träger's personnel number")
		rec = traegerLink(t, router, office.token, map[string]any{"members": members[:1]})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_already_linked")
		_, err := db.ExecContext(context.Background(), `UPDATE users.staff_employment_profiles SET personnel_number = '70077' WHERE membership_id = ?`, miraSouth.ID)
		require.Error(t, err, "no path of the school, the import included, writes another number than the Träger's")
	})

	t.Run("the bank values open only after the access log of every Einsatzort", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/financial/reveal", record.ID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		financial := decode[workforce.TraegerStaffFinancial](t, rec)
		require.NotNil(t, financial.IBAN)
		assert.Equal(t, "DE89370400440532013000", *financial.IBAN)
		assert.Equal(t, map[int64]int{north: 1, south: 1}, staffAccessEntries(t, db, office.organization, "traeger_staff_financial"))
	})

	t.Run("the bank section reads masked and saves through its own route", func(t *testing.T) {
		path := fmt.Sprintf("/traeger/staff-records/%d/financial", record.ID)
		rec := traegerJSON(t, router, office.token, http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		masked := decode[workforce.TraegerStaffFinancial](t, rec)
		require.NotNil(t, masked.IBAN)
		assert.Equal(t, "•••• 3000", *masked.IBAN, "the read shows the mask only")
		assert.Nil(t, masked.TaxID)

		rec = traegerJSON(t, router, office.token, http.MethodPut, path, map[string]any{"iban": "DE89 3704 0044 0532 0130 00"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, record.ID, decode[struct {
			ID wireID `json:"id"`
		}](t, rec).ID)
		rec = traegerJSON(t, router, office.token, http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "•••• 3000", *decode[workforce.TraegerStaffFinancial](t, rec).IBAN, "the same IBAN in another spelling changes nothing")
	})

	t.Run("the school reads that the Träger keeps the values and changes none of them", func(t *testing.T) {
		keptIn := func(staffID int64) bool {
			school, err := tenant.NewTenantID(south)
			require.NoError(t, err)
			var kept bool
			require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, south), school, func(ctx context.Context) error {
				var err error
				kept, err = admin.StaffKeptByTraeger(ctx, staffID)
				return err
			}))
			return kept
		}
		assert.True(t, keptIn(miraSouth.ID))
		assert.False(t, keptIn(jonas.ID))
		number := "70099"
		_, err := admin.UpdatePersonnelNumber(staffInSchool(t, unit, south), miraSouth.ID, &number, nil, jonas.ID, "")
		require.ErrorIs(t, err, workforce.ErrStaffKeptByTraeger)
	})

	t.Run("a school sees only its own staff", func(t *testing.T) {
		var records, foreignLinks int
		school, err := tenant.NewTenantID(north)
		require.NoError(t, err)
		require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, north), school, func(ctx context.Context) error {
			tx, err := tenant.CurrentTransaction[bun.Tx](ctx)
			if err != nil {
				return err
			}
			if err := tx.NewRaw(`SELECT COUNT(*) FROM workforce.staff_records`).Scan(ctx, &records); err != nil {
				return err
			}
			return tx.NewRaw(`SELECT COUNT(*) FROM workforce.staff_record_links WHERE school_id <> ?`, north).Scan(ctx, &foreignLinks)
		}))
		assert.Zero(t, records, "a school reads no record of its Träger")
		assert.Zero(t, foreignLinks, "a school reads no link of another school")
	})

	t.Run("the personnel number is unique per Träger and reaches every Einsatzort", func(t *testing.T) {
		staffSetPersonnelNumber(t, db, south, jonas.ID, "70002")
		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/personnel-number", record.ID), map[string]any{"personnel_number": "70002"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.personnel_number_taken")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/personnel-number", record.ID), map[string]any{"personnel_number": "70005"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.staff_employment_profiles WHERE membership_id IN (?, ?) AND personnel_number = '70005'`, miraNorth.ID, miraSouth.ID))
		jonasRecord := traegerLink(t, router, office.token, map[string]any{
			"members": []map[string]int64{{"school_id": south, "staff_id": jonas.ID}},
		})
		require.Equal(t, http.StatusCreated, jonasRecord.Code, jonasRecord.Body.String())
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/personnel-number", decode[staffRecordBody](t, jonasRecord).ID), map[string]any{"personnel_number": "70005"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.personnel_number_taken")
	})

	// #4718: the list as PDF, Excel and CSV, without bank or tax values,
	// logged as its own view at every school it shows.
	t.Run("the export lists the records and logs its own view", func(t *testing.T) {
		before := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewOverviewExport)
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/export", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		body := strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")
		lines := strings.Split(strings.TrimSpace(body), "\n")
		require.Len(t, lines, 3, body)
		assert.Equal(t, "Nachname;Vorname;Geburtsdatum;Personalnummer;Einsatzorte", strings.TrimSpace(lines[0]))
		assert.Contains(t, body, "Keller;Jonas;;70002;Träger Personal OGS Süd")
		assert.Contains(t, body, "Sommer-Berg;Mira;;70005;Träger Personal OGS Nord, Träger Personal OGS Süd")
		assert.NotContains(t, body, "3000", "no bank value, not even its mask")
		after := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewOverviewExport)
		assert.Equal(t, map[int64]int{north: before[north] + 1, south: before[south] + 1}, after)

		assertTraegerListFormats(t, router, office.token, "/traeger/staff-records/export", "personalakten")
		logged := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewOverviewExport)
		assert.Equal(t, after[north]+2, logged[north], "the PDF and the Excel export are logged like the CSV")
	})

	// #7379: the Personalverwaltung corrects name and birthday in the
	// record; the trail keeps the old values, the schools keep their own.
	t.Run("name and birthday are corrected in the record and stand in its trail", func(t *testing.T) {
		path := fmt.Sprintf("/traeger/staff-records/%d/person", record.ID)
		// The correction answers no record; the reader loads it again.
		save := func(body map[string]any) staffRecordBody {
			t.Helper()
			rec := traegerJSON(t, router, office.token, http.MethodPut, path, body)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			raw := decode[json.RawMessage](t, rec)
			assert.True(t, len(raw) == 0 || string(raw) == "null", "the correction answers no record: %s", raw)
			rec = traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", record.ID), nil)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			return decode[staffRecordBody](t, rec)
		}
		rec := traegerJSON(t, router, office.token, http.MethodPut, path, map[string]any{"first_name": " ", "last_name": "Sommer-Berg", "birthday": nil})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.stammdaten_invalid")
		require.Len(t, refusalOf(t, rec).Errors, 1)
		assert.Equal(t, "first_name", refusalOf(t, rec).Errors[0].Field)
		rec = traegerJSON(t, router, office.token, http.MethodPut, path, map[string]any{"first_name": "Mira", "last_name": "Sommer-Berg", "birthday": "2999-01-01"})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.stammdaten_invalid")
		assert.Equal(t, "birthday", refusalOf(t, rec).Errors[0].Field, "a birthday that has not come yet is refused")

		corrected := save(map[string]any{"first_name": " Myra ", "last_name": "Sommer-Berg", "birthday": "1990-04-12"})
		assert.Equal(t, "Myra", corrected.FirstName)
		assert.Equal(t, "Sommer-Berg", corrected.LastName)
		assert.Equal(t, "1990-04-12", corrected.Birthday)
		changed := map[string]string{}
		for _, change := range corrected.Changes {
			if change.Kind == workforce.TraegerStaffChangeChanged {
				changed[change.Field] = change.Value
			}
		}
		assert.Equal(t, "Mira", changed["first_name"], "the trail keeps the name before the correction")
		assert.Contains(t, changed, "birthday", "a birthday set for the first time stands in the trail")
		assert.NotContains(t, changed, "last_name", "an unchanged value writes no entry")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.persons p JOIN users.staff_school_memberships s ON s.person_id = p.id WHERE s.id = ? AND p.first_name = 'Mira'`, miraNorth.ID),
			"the school keeps its own person")

		before := len(corrected.Changes)
		assert.Len(t, save(map[string]any{"first_name": "Myra", "last_name": "Sommer-Berg", "birthday": "1990-04-12"}).Changes, before,
			"saving the same values writes nothing")

		cleared := save(map[string]any{"first_name": "Myra", "last_name": "Sommer-Berg", "birthday": nil})
		assert.Empty(t, cleared.Birthday)
		require.NotEmpty(t, cleared.Changes)
		assert.Equal(t, workforce.TraegerStaffChangeRemoved, cleared.Changes[0].Kind, "an emptied birthday is removed, not replaced")
		assert.Equal(t, "birthday", cleared.Changes[0].Field)
		assert.Equal(t, "1990-04-12", cleared.Changes[0].Value)
	})

	t.Run("no role without the right and no other Träger reaches the records", func(t *testing.T) {
		overviewOnly := newTraegerOffice(t, db, portal, "Träger Übersicht", identityaccess.TraegerRoleReadOnly)
		rec := traegerJSON(t, router, overviewOnly.token, http.MethodGet, "/traeger/staff-records/", nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, overviewOnly.token, http.MethodGet, "/traeger/staff-records/export", nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		other := newTraegerOffice(t, db, portal, "Träger Fremd", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec = traegerJSON(t, router, other.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", record.ID), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		rec = traegerJSON(t, router, other.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/person", record.ID),
			map[string]any{"first_name": "Fremd", "last_name": "Fremd", "birthday": nil})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		rec = traegerJSON(t, router, other.token, http.MethodGet, "/traeger/staff-records/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[staffOverviewBody](t, rec).Records)
	})

	t.Run("dissolving gives the schools their bank values back", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-records/%d", record.ID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM users.staff_financial_data WHERE staff_id IN (?, ?) AND iban_masked = '•••• 3000'`, miraNorth.ID, miraSouth.ID))
		masked, err := admin.StaffFinancialMasked(staffInSchool(t, unit, north), miraNorth.ID, account.ID, "admin")
		require.NoError(t, err)
		assert.False(t, masked.KeptByTraeger)
		require.NotNil(t, masked.IBANMasked)
		rec = traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", record.ID), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
	})
}

// TestTraegerStaffOverviewQueryBudget pins the statements of the overview:
// flat in the number of people and records at a fixed set of schools.
func TestTraegerStaffOverviewQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, "/traeger/staff-records/", nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	add := func(n int) {
		for i := range n {
			for _, school := range office.schools {
				staff := testpkg.CreateTestStaffForTenant(t, db, school, "Kraft", fmt.Sprintf("Nummer %d", i))
				if i == 0 {
					rec := traegerLink(t, router, office.token, map[string]any{
						"members": []map[string]int64{{"school_id": school, "staff_id": staff.ID}},
					})
					require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
				}
			}
		}
	}
	add(1)
	few := read()
	add(3)
	assert.Len(t, read().Statements, len(few.Statements), "the overview loads set-based")
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_records", few)
}
