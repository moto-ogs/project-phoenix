package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// The document inbox answers through the /parent mount as the portal's
// catalog proxy reaches it (#2352): the sent care contracts, the documents a
// Träger released, and reading and signing a contract, over the real owners.

func newDocumentInboxRoutes(t *testing.T, db *bun.DB) parentPortalRoutes {
	t.Helper()
	database := testpkg.NewDatabase(t, db)
	people := NewPeopleRepositorySuiteFactory(database)
	organizations, err := owners.NewOrganizationTenancy(database)
	require.NoError(t, err)
	identity, err := NewIdentityAccessForTests(database)
	require.NoError(t, err)
	portal := portalCompose.New(portalCompose.Dependencies{
		Memberships:         owners.NewParentSchoolMembershipLock(database),
		StudentGuardianRepo: owners.NewParentStudentGuardianReads(people.StudentGuardian),
		StudentRepo:         owners.NewParentStudentReads(people.Student),
		GuardianChanges:     owners.ParentGuardianChanges(), DeparturePolicy: owners.ParentDeparturePolicy(),
		GuardianPolicy: owners.NewParentGuardianPolicy(), Fingerprints: owners.SecurityFingerprints{},
		Declarations: owners.ParentDeclarationPolicy(), Locales: owners.ParentPortalLocales(), Runtime: owners.ParentPortalRuntime{},
		ChildRepo: NewRepositoryTestFactory(database).ParentChildReads(), PersonRepo: owners.NewParentPersonReads(people.Person),
		GuardianProfileRepo: owners.NewParentGuardianProfileReads(people.GuardianProfile),
		Logger:              slog.Default(), CarePlanPolicy: owners.NewParentCarePlanPolicy(),
		BillingDocuments: owners.NewParentBillingDocuments(), SharedDocuments: owners.NewParentSharedDocuments(),
		ContractDocuments: owners.NewParentContractDocuments(owners.NewParentContractSigningForTests(&owners.CareContractTestMails{}), owners.CareContractTestHolidays{}, time.Now),
		TraegerRuntime:    owners.ParentPortalRuntime{}, SchoolTraeger: owners.NewParentSchoolTraeger(organizations), ParentAccounts: owners.NewParentAccounts(identity),
	})
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/parent", parentHTTP.NewResource(parentHTTP.ResourceConfig{Now: time.Now, Parent: portal}).Router(ParentSessionChain))
	return parentPortalRoutes{guardRig: &guardRig{childReadRig: childReadRig{db: db}}, router: router}
}

// inboxOrganization is the Träger of the family's school, owning the rows
// the test writes.
func inboxOrganization(t *testing.T, db *bun.DB, school int64) int64 {
	t.Helper()
	var organization int64
	require.NoError(t, db.NewRaw(`SELECT organization_id FROM platform.schools WHERE id = ?`, school).Scan(context.Background(), &organization))
	return organization
}

// inboxCareContract stores a care contract of the Träger for the child and its
// send to the guardian's address, as the Betreuungsvertrag does (#4679).
func inboxCareContract(t *testing.T, db *bun.DB, organization int64, chain testpkg.ParentChain) int64 {
	t.Helper()
	ctx := context.Background()
	var contract, version, document int64
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, request_child_id, student_id, status, sent_at)
		VALUES (?, ?, ?, ?, 'versendet', NOW()) RETURNING id`, organization, chain.TenantID, testpkg.UniqueTestTenantID(t), chain.StudentID).Scan(ctx, &contract))
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contract_versions (organization_id, contract_id, version_number, effective_from,
			child_first_name, child_last_name, school_name, term_kind, notice_months, notice_to, special_termination,
			special_termination_note, statute_required, statute_title, statute_url, contract_partner)
		VALUES (?, ?, 1, '2027-08-01', 'Felix', 'Schneider', 'OGS Am Lindenhof', 'open_ended', 1, 'month_end', false, '', false, '', '', '')
		RETURNING id`, organization, contract).Scan(ctx, &version))
	_, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_version_services (organization_id, contract_version_id,
			weekday, care_offering_id, module_name, ends_at) VALUES (?, ?, 'mon', 4, 'Ganztag', '16:30')`, organization, version)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO care_contract.contract_parties (organization_id, contract_id, first_name, last_name, email)
		VALUES (?, ?, 'Erika', 'Schneider', ?)`, organization, contract, chain.Email)
	require.NoError(t, err)
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contract_documents (organization_id, contract_id, contract_version_id,
			template_version, filename, pdf) VALUES (?, ?, ?, 0, 'betreuungsvertrag.pdf', ?) RETURNING id`,
		organization, contract, version, []byte("%PDF-1.4 Vertrag Felix")).Scan(ctx, &document))
	_, err = db.ExecContext(ctx, `INSERT INTO care_contract.contract_mailings (organization_id, contract_id, contract_document_id,
			outbox_id, recipient_email) VALUES (?, ?, ?, ?, ?)`, organization, contract, document, testpkg.UniqueTestTenantID(t), chain.Email)
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTraeger(testpkg.WithPackageTenantRuntime(ctx), organization, func(txCtx context.Context) error {
		return owners.RecordCareContractSendForTests(txCtx, organization, contract)
	}))
	return contract
}

func TestParentPortalContractInboxListsReadsAndSignsAContract(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newDocumentInboxRoutes(t, db)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := parentReadToken(t, chain.AccountID)
	organization := inboxOrganization(t, db, chain.TenantID)
	testpkg.OwnTraegerCareContracts(t, db, organization)
	sent := inboxCareContract(t, db, organization, chain)

	var contracts []parentHTTP.BillingDocumentResponse
	r.call(t, http.MethodGet, "/parent/me/documents/contracts", token, nil, &contracts)
	require.Len(t, contracts, 1)
	assert.Equal(t, fmt.Sprint(sent), contracts[0].ID.String())
	assert.True(t, contracts[0].CanSign)

	path := fmt.Sprintf("/parent/me/documents/%d/contracts/%d", organization, sent)
	var view struct {
		Status    string `json:"status"`
		Signature *struct {
			Method string `json:"method"`
		} `json:"signature"`
	}
	r.call(t, http.MethodGet, path+"/signing", token, nil, &view)
	assert.Equal(t, "versendet", view.Status)
	r.call(t, http.MethodPost, path+"/sign", token, map[string]any{
		"method": "drawn", "image_png": signatureImage(t), "withdrawal_notice_acknowledged": true,
	}, &view)
	assert.Equal(t, "aktiv", view.Status, "the signature concludes the contract")
	require.NotNil(t, view.Signature)
	assert.Equal(t, "drawn", view.Signature.Method)
}

func TestParentPortalSharedDocumentsListTheReleasedDocuments(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newDocumentInboxRoutes(t, db)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	organization := inboxOrganization(t, db, chain.TenantID)
	testpkg.OwnTraegerDocuments(t, db, organization)
	document := func(title string) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`INSERT INTO platform.traeger_documents (organization_id, title, file_name, content_type, size_bytes, content)
			VALUES (?, ?, 'brief.pdf', 'application/pdf', 8, '%PDF-1.4'::bytea) RETURNING id`, organization, title).Scan(context.Background(), &id))
		return id
	}
	released := document("Hausordnung")
	_, err := db.ExecContext(context.Background(), `INSERT INTO platform.traeger_document_releases (organization_id, document_id, audience)
		VALUES (?, ?, 'parents')`, organization, released)
	require.NoError(t, err)
	document("Entwurf")

	var documents []parentHTTP.SharedDocumentResponse
	r.call(t, http.MethodGet, "/parent/me/documents/shared", parentReadToken(t, chain.AccountID), nil, &documents)
	require.Len(t, documents, 1, "only the released document")
	assert.Equal(t, fmt.Sprint(released), documents[0].ID.String())
	assert.Equal(t, fmt.Sprint(organization), documents[0].OrganizationID.String())
}
