// Router-level tests for the Nachweise of the Personalstamm (#4707, ADR 0089
// section 7): the Personalverwaltung sets the kinds with validity, lead and
// mandatory flag, records proofs at a record, lists and exports the
// expiring ones, and maps the kinds of each school onto its own. A role
// without the right gets 403, no Träger reaches another Träger's proofs, a
// school sees only the status of its own people, and every read or write of
// a person's proofs is in the access log of each Einsatzort.
package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type staffProofListBody struct {
	Today   string                            `json:"today"`
	Types   []workforce.TraegerStaffProofType `json:"types"`
	Entries []struct {
		RecordID  wireID   `json:"staff_record_id"`
		LastName  string   `json:"last_name"`
		Schools   []string `json:"schools"`
		TypeID    wireID   `json:"type_id"`
		Status    string   `json:"status"`
		ExpiresOn string   `json:"expires_on"`
	} `json:"entries"`
	Counts workforce.TraegerStaffProofCounts `json:"counts"`
}

func proofKindByKey(t *testing.T, kinds []workforce.TraegerStaffProofType, key string) workforce.TraegerStaffProofType {
	t.Helper()
	for _, kind := range kinds {
		if kind.StandardKey == key {
			return kind
		}
	}
	t.Fatalf("no kind %q in %+v", key, kinds)
	return workforce.TraegerStaffProofType{}
}

func linkSingleRecord(t *testing.T, router http.Handler, token string, members ...map[string]int64) staffRecordBody {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodPost, "/traeger/staff-records/", map[string]any{"members": members})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return decode[staffRecordBody](t, rec)
}

// schoolProofStatus reads what a school sees of the Träger's proofs.
func schoolProofStatus(t *testing.T, unit tenant.UnitOfWork, schoolID int64) map[int64][]string {
	t.Helper()
	school, err := tenant.NewTenantID(schoolID)
	require.NoError(t, err)
	seen := map[int64][]string{}
	require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, schoolID), school, func(ctx context.Context) error {
		tx, err := tenant.CurrentTransaction[bun.Tx](ctx)
		if err != nil {
			return err
		}
		var rows []struct {
			MembershipID int64  `bun:"membership_id"`
			TypeName     string `bun:"type_name"`
			Held         bool   `bun:"held"`
		}
		if err := tx.NewRaw(`SELECT membership_id, type_name, held FROM workforce.school_traeger_proof_status()`).Scan(ctx, &rows); err != nil {
			return err
		}
		for _, row := range rows {
			seen[row.MembershipID] = append(seen[row.MembershipID], fmt.Sprintf("%s:%t", row.TypeName, row.Held))
		}
		return nil
	}))
	return seen
}

// TestTraegerStaffProofsWarnBeforeExpiry walks the acceptance of #4707.
func TestTraegerStaffProofsWarnBeforeExpiry(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, _, unit, office := newTraegerStaffFixture(t, db)
	north, south := office.schools[0], office.schools[1]
	mira, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	jonas := testpkg.CreateTestStaffForTenant(t, db, south, "Jonas", "Keller")

	t.Run("without the release there are no proofs", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/", nil)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_not_released")
	})

	staffRelease(t, db, office.organization)
	miraRecord := linkSingleRecord(t, router, office.token,
		map[string]int64{"school_id": north, "staff_id": mira.ID}, map[string]int64{"school_id": south, "staff_id": miraSouth.ID})
	jonasRecord := linkSingleRecord(t, router, office.token, map[string]int64{"school_id": south, "staff_id": jonas.ID})

	var kinds []workforce.TraegerStaffProofType
	t.Run("the Träger starts with the standard kinds and adds its own", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/types", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		kinds = decode[[]workforce.TraegerStaffProofType](t, rec)
		require.Len(t, kinds, 3)
		police := proofKindByKey(t, kinds, "police_certificate")
		assert.True(t, police.PoliceCertificate)
		assert.True(t, police.Mandatory)

		rec = traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-proofs/types", map[string]any{
			"name": "Belehrung Infektionsschutz", "validity_months": 24, "reminder_lead_weeks": 4,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		own := decode[workforce.TraegerStaffProofType](t, rec)
		assert.Equal(t, 4, own.ReminderLeadWeeks)
		rec = traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-proofs/types", map[string]any{"name": " belehrung infektionsschutz "})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_proof_type_name_taken")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-proofs/types/%d", own.ID), map[string]any{
			"name": "Belehrung Infektionsschutz", "reminder_lead_weeks": 60,
		})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_proof_invalid")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-proofs/types/%d", own.ID), map[string]any{
			"name": "Belehrung Infektionsschutz", "reminder_lead_weeks": 4, "archived": true,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.True(t, decode[workforce.TraegerStaffProofType](t, rec).Archived)
	})

	police := proofKindByKey(t, kinds, "police_certificate")
	measles := proofKindByKey(t, kinds, "measles_protection")
	proofPath := func(record staffRecordBody, kind workforce.TraegerStaffProofType) string {
		return fmt.Sprintf("/traeger/staff-proofs/records/%d/%d", record.ID, kind.ID)
	}

	t.Run("a certificate of conduct keeps only its days and the result", func(t *testing.T) {
		before := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		rec := traegerJSON(t, router, office.token, http.MethodPut, proofPath(miraRecord, police), map[string]any{
			"presented_on": "2021-11-20", "issued_on": "2021-11-02",
		})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_proof_invalid")
		assert.Equal(t, "no_relevant_entry", refusalOf(t, rec).Errors[0].Field)

		rec = traegerJSON(t, router, office.token, http.MethodPut, proofPath(miraRecord, police), map[string]any{
			"presented_on": "2021-11-20", "issued_on": "2021-11-02", "no_relevant_entry": true,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		proofs := decode[[]workforce.TraegerStaffProof](t, rec)
		require.NotEmpty(t, proofs)
		assert.Equal(t, police.ID, proofs[0].TypeID)
		assert.Equal(t, "2026-11-02", proofs[0].ExpiresOn, "five years from the issue day")
		after := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		assert.Equal(t, map[int64]int{north: before[north] + 1, south: before[south] + 1}, after,
			"the write shows the record at both Einsatzorte; each logs it once, the refused write not at all")
		columns := staffSchoolValue(t, db, `SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = 'workforce' AND table_name = 'staff_proofs' AND data_type IN ('bytea', 'text')`)
		assert.Zero(t, columns, "no column could carry a copy of a certificate")

		rec = traegerJSON(t, router, office.token, http.MethodPut, proofPath(jonasRecord, measles), map[string]any{"presented_on": "2026-08-03"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	})

	t.Run("the list puts the expired and the missing first and the record shows them", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		list := decode[staffProofListBody](t, rec)
		// Mira: police expired (2026-11-02 before today) or expiring,
		// measles missing; Jonas: police missing, measles valid.
		require.NotEmpty(t, list.Entries)
		assert.Equal(t, 2, list.Counts.Missing, "measles of Mira and the certificate of Jonas are missing")
		assert.Equal(t, 1, list.Counts.Valid)
		assert.Equal(t, 1, list.Counts.Expired+list.Counts.ExpiringSoon)
		assert.NotEqual(t, workforce.TraegerProofStatusValid, list.Entries[0].Status)
		assert.Equal(t, workforce.TraegerProofStatusValid, list.Entries[len(list.Entries)-1].Status)
		assert.Equal(t, []string{"Träger Personal OGS Nord", "Träger Personal OGS Süd"}, firstEntryOf(t, list, int64(miraRecord.ID)).Schools)

		rec = traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", miraRecord.ID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		detail := decode[struct {
			Proofs []workforce.TraegerStaffProof `json:"proofs"`
		}](t, rec)
		require.Len(t, detail.Proofs, 3, "the record shows every live kind; the archived own kind it does not hold stays out")
		assert.True(t, detail.Proofs[0].Held)
		assert.Equal(t, workforce.TraegerProofStatusMissing, detail.Proofs[1].Status)
		assert.Empty(t, detail.Proofs[2].Status, "an optional kind without a proof has no status")
	})

	t.Run("the export writes the access entry before the file", func(t *testing.T) {
		before := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/export", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		body := strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")
		lines := strings.Split(strings.TrimSpace(body), "\n")
		assert.Equal(t, "Nachname;Vorname;Personalnummer;Einsatzorte;Nachweis;Stand;Gültig bis;Vorgelegt am", strings.TrimSpace(lines[0]))
		assert.Len(t, lines, 5)
		assert.Contains(t, body, "Keller;Jonas;;Träger Personal OGS Süd;Erweitertes Führungszeugnis;Fehlt;;")
		after := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		assert.Equal(t, before[north]+1, after[north])
		assert.Equal(t, before[south]+1, after[south])

		// #4718: PDF and Excel hold the same list and are logged alike.
		listed := decode[workforce.TraegerStaffProofList](t, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/", nil))
		assertTraegerListFormats(t, router, office.token, "/traeger/staff-proofs/export", "nachweise-"+listed.Today)
		logged := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		assert.Equal(t, after[north]+3, logged[north], "the list, the PDF and the Excel export are logged like the CSV")
	})

	t.Run("a school kind maps onto a Träger kind and the school sees the status only", func(t *testing.T) {
		var schoolKind int64
		require.NoError(t, db.NewRaw(`INSERT INTO users.staff_qualification_types (tenant_id, standard_key, name, validity_months)
			VALUES (?, 'extended_police_certificate', 'Erweitertes Führungszeugnis', 60) RETURNING id`, north).Scan(context.Background(), &schoolKind))
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/school-kinds", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		schools := decode[[]workforce.TraegerSchoolProofKinds](t, rec)
		require.Len(t, schools, 2)
		require.Len(t, schools[0].Kinds, 1)
		assert.Nil(t, schools[0].Kinds[0].ProofTypeID)

		rec = traegerJSON(t, router, office.token, http.MethodPut, "/traeger/staff-proofs/school-kinds", map[string]any{
			"school_id": south, "school_type_id": schoolKind, "proof_type_id": police.ID,
		})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_proof_mapping_invalid")
		rec = traegerJSON(t, router, office.token, http.MethodPut, "/traeger/staff-proofs/school-kinds", map[string]any{
			"school_id": north, "school_type_id": schoolKind, "proof_type_id": police.ID,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		schools = decode[[]workforce.TraegerSchoolProofKinds](t, rec)
		require.NotNil(t, schools[0].Kinds[0].ProofTypeID)
		assert.Equal(t, police.ID, *schools[0].Kinds[0].ProofTypeID)

		assert.Equal(t, map[int64][]string{mira.ID: {"Erweitertes Führungszeugnis:true", "Masernschutz:false"}}, schoolProofStatus(t, unit, north),
			"the north school sees its own employment only, without the proof's days")
		assert.Len(t, schoolProofStatus(t, unit, south), 2, "the south school sees Mira and Jonas")
	})

	t.Run("no role without the right and no other Träger reaches the proofs", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		for _, path := range []string{"/traeger/staff-proofs/", "/traeger/staff-proofs/export", "/traeger/staff-proofs/types", "/traeger/staff-proofs/school-kinds"} {
			rec := traegerJSON(t, router, readOnly.token, http.MethodGet, path, nil)
			assert.Equal(t, http.StatusForbidden, rec.Code, path)
		}
		for _, write := range []struct{ method, path string }{
			{http.MethodPost, "/traeger/staff-proofs/types"},
			{http.MethodPut, fmt.Sprintf("/traeger/staff-proofs/types/%d", police.ID)},
			{http.MethodPut, "/traeger/staff-proofs/school-kinds"},
			{http.MethodPut, proofPath(miraRecord, police)},
			{http.MethodDelete, proofPath(miraRecord, measles)},
		} {
			rec := traegerJSON(t, router, readOnly.token, write.method, write.path, map[string]any{"name": "x", "presented_on": "2026-11-02"})
			assert.Equal(t, http.StatusForbidden, rec.Code, write.method+" "+write.path)
		}
		other := newTraegerOffice(t, db, portal, "Träger Fremd", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec := traegerJSON(t, router, other.token, http.MethodPut, proofPath(miraRecord, police), map[string]any{
			"presented_on": "2026-11-02", "issued_on": "2026-11-01", "no_relevant_entry": true,
		})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		rec = traegerJSON(t, router, other.token, http.MethodGet, "/traeger/staff-proofs/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[staffProofListBody](t, rec).Entries)
		rec = traegerJSON(t, router, other.token, http.MethodPut, "/traeger/staff-proofs/school-kinds", map[string]any{
			"school_id": north, "school_type_id": 1, "proof_type_id": police.ID,
		})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_proof_mapping_invalid")
	})

	t.Run("a proof entered by mistake goes", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodDelete, proofPath(jonasRecord, measles), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, office.token, http.MethodDelete, proofPath(jonasRecord, measles), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_proof_not_found")
	})
}

func firstEntryOf(t *testing.T, list staffProofListBody, recordID int64) struct {
	RecordID  wireID   `json:"staff_record_id"`
	LastName  string   `json:"last_name"`
	Schools   []string `json:"schools"`
	TypeID    wireID   `json:"type_id"`
	Status    string   `json:"status"`
	ExpiresOn string   `json:"expires_on"`
} {
	t.Helper()
	for _, entry := range list.Entries {
		if int64(entry.RecordID) == recordID {
			return entry
		}
	}
	t.Fatalf("no entry of record %d", recordID)
	return list.Entries[0]
}

// TestTraegerStaffProofListQueryBudget pins the statements of the list:
// flat in the number of records and proofs at a fixed set of schools.
func TestTraegerStaffProofListQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, "/traeger/staff-proofs/", nil)
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
				record := linkSingleRecord(t, router, office.token, map[string]int64{"school_id": school, "staff_id": staff.ID})
				kinds := decode[[]workforce.TraegerStaffProofType](t, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-proofs/types", nil))
				rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-proofs/records/%d/%d", record.ID, proofKindByKey(t, kinds, "measles_protection").ID),
					map[string]any{"presented_on": "2026-08-03"})
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			}
		}
	}
	add(1)
	few := read()
	add(2)
	assert.Len(t, read().Statements, len(few.Statements), "the list loads set-based")
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_proofs", few)
}

// TestTraegerStaffProofKindsQueryBudget pins the kinds and the school kinds:
// flat in the number of kinds, one tenant transaction per school.
func TestTraegerStaffProofKindsQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	read := func(path string) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	add := func(from, to int) {
		for i := from; i < to; i++ {
			rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-proofs/types", map[string]any{"name": fmt.Sprintf("Art %d", i)})
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			for _, school := range office.schools {
				_, err := db.ExecContext(context.Background(), `INSERT INTO users.staff_qualification_types (tenant_id, name) VALUES (?, ?)`, school, fmt.Sprintf("Schulart %d", i))
				require.NoError(t, err)
			}
		}
	}
	add(0, 1)
	types, schoolKinds := read("/traeger/staff-proofs/types"), read("/traeger/staff-proofs/school-kinds")
	add(1, 4)
	assert.Len(t, read("/traeger/staff-proofs/types").Statements, len(types.Statements), "the kinds load set-based")
	assert.Len(t, read("/traeger/staff-proofs/school-kinds").Statements, len(schoolKinds.Statements), "the school kinds load set-based per school")
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_proof_types", types)
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_proof_school_kinds", schoolKinds)
}
