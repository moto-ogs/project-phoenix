package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The parents sign a changed contract version (#4816, ADR 0325). The
// fixture's child books the Ganztag on Monday to Wednesday from 1 August
// 2027; from 1 October 2027 it also books a late care on Thursday.

// amendmentSignature is a drawn signature with the confirmed withdrawal
// notice, as the signing page sends it.
func amendmentSignature(t *testing.T) map[string]any {
	t.Helper()
	return map[string]any{"method": "drawn", "image_png": signatureImage(t), "withdrawal_notice_acknowledged": true}
}

// signedCareContract is the fixture's contract, sent and signed by the
// parents: an active contract with one version in force.
func signedCareContract(t *testing.T, f careContractFixture) int64 {
	t.Helper()
	require.Equal(t, http.StatusOK, putTemplate(t, f.traeger, f.office.token, f.school, f.offering, careContractTemplate).Code)
	contract, link := sentCareContract(t, f, f.child)
	rec := publicSigning(t, f.traeger, http.MethodPost, link+"/sign", amendmentSignature(t))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	settleContractMails(t, f)
	return contract
}

// settleContractMails marks the Träger's queued mails as sent, as the mail
// worker does: the next mail of a contract waits for the one before.
func settleContractMails(t *testing.T, f careContractFixture) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `UPDATE platform.email_outbox SET status = 'sent', sent_at = NOW()
		WHERE organization_id = ? AND status = 'pending'`, f.office.organization)
	require.NoError(t, err)
}

// bookLateCare books a late care on Thursday for the fixture's child from
// 1 October 2027, as the school writes a booking, and answers the module.
func bookLateCare(t *testing.T, f careContractFixture) int64 {
	t.Helper()
	late := &testpkg.CareOffering{PhaseID: f.phase, Name: "Spätbetreuung", DaysOfWeekMode: "fixed", AvailableDays: []string{"thu"},
		AutoAddGradeLevels: []int{}, IsActive: true, CountsAsCare: true, PickupTimes: map[string]string{"thu": "17:00"}}
	late.TenantID = f.school
	testpkg.InsertTestCareOffering(t, f.db, testpkg.TenantContext(f.school), late)
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO enrollment.care_offering_bookings (tenant_id, request_child_id,
			care_offering_id, manual_selected_days, valid_from) VALUES (?, ?, ?, '[]'::jsonb, DATE '2027-10-01')`, f.school, f.child, late.ID)
	require.NoError(t, err)
	return late.ID
}

// signChangedVersion signs the version of the link as the signing page
// does: with the checksum of the PDF the page showed.
func signChangedVersion(t *testing.T, f careContractFixture, link string) *httptest.ResponseRecorder {
	t.Helper()
	rec := publicSigning(t, f.traeger, http.MethodGet, link, nil)
	if rec.Code != http.StatusOK {
		return rec
	}
	body := amendmentSignature(t)
	body["document_sha256"] = decodeSchoolPortalData[carecontract.SigningView](t, rec.Body.Bytes()).DocumentSHA256
	return publicSigning(t, f.traeger, http.MethodPost, link+"/sign", body)
}

func amendCareContracts(t *testing.T, f careContractFixture) carecontract.AmendmentRun {
	t.Helper()
	conclusion, ctx := careContractConclusionOf(t, f)
	run, err := conclusion.AmendFromBookings(ctx, f.office.organization)
	require.NoError(t, err)
	return run
}

func careContractDetail(t *testing.T, f careContractFixture, id int64) carecontract.ContractDetail {
	t.Helper()
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, contractPath(id, ""), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[carecontract.ContractDetail](t, rec.Body.Bytes())
}

func versionStatuses(detail carecontract.ContractDetail) []string {
	statuses := make([]string, len(detail.Versions))
	for i, version := range detail.Versions {
		statuses[i] = fmt.Sprintf("%d:%s", version.Number, version.Status)
	}
	return statuses
}

// billedVersions are the version numbers the Elternabrechnung reads for the
// first week of October 2027.
func billedVersions(t *testing.T, f careContractFixture, contract int64) []int {
	t.Helper()
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	numbers := []int{}
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		periods, err := careContractCompose.NewContractVersions().VersionsInForce(txCtx, f.office.organization,
			calendar.NewDate(2027, 10, 4), calendar.NewDate(2027, 10, 10), contract)
		for _, period := range periods {
			numbers = append(numbers, period.Version.Number)
		}
		return err
	}))
	return numbers
}

// lastContractMail reads the newest mail of the contract from the outbox.
func lastContractMail(t *testing.T, f careContractFixture, contract int64) carecontract.ContractMail {
	t.Helper()
	var payload string
	require.NoError(t, f.db.NewRaw(`SELECT payload::text FROM platform.email_outbox WHERE organization_id = ? AND kind = 'care_contract'
		AND related_entity_id = ? ORDER BY id DESC LIMIT 1`, f.office.organization, contract).Scan(context.Background(), &payload))
	var mail carecontract.ContractMail
	require.NoError(t, json.Unmarshal([]byte(payload), &mail))
	return mail
}

// TestCareContractChangeByTheSchoolWaitsForTheParentsSignature pins the core
// of #4816: a change the parents did not ask for makes a version that waits
// as beantragt. The version in force holds and is the one billed until the
// parents sign; they see what changes, and their signature makes the new
// version wirksam from its effective date.
func TestCareContractChangeByTheSchoolWaitsForTheParentsSignature(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Unterschrift")
	contract := signedCareContract(t, f)
	late := bookLateCare(t, f)

	run := amendCareContracts(t, f)
	october := calendar.NewDate(2027, 10, 1)
	assert.Empty(t, run.Amended, "nobody agreed to the change yet")
	require.Equal(t, []carecontract.AmendedContract{{ContractID: contract, VersionNumber: 2, EffectiveFrom: october}}, run.Awaiting)
	detail := careContractDetail(t, f, contract)
	assert.Equal(t, []string{"1:wirksam", "2:beantragt"}, versionStatuses(detail), "the changed version waits")
	assert.True(t, detail.ChangeAwaitsSignature)
	assert.Equal(t, carecontract.StatusActive, detail.Status)
	assert.Equal(t, 1, detail.Version.Number, "the version in force is still the contract's version")
	assert.Equal(t, []int{1}, billedVersions(t, f, contract), "the billing reads only the version in force")

	mail := lastContractMail(t, f, contract)
	assert.Equal(t, carecontract.MailPurposeAmendment, mail.Purpose)
	assert.Equal(t, "01.10.2027", mail.EffectiveFrom)
	assert.NotEmpty(t, mail.PDF, "the changed version goes out as a PDF")
	link := lastSigningLink(t, f, contract)
	rec := publicSigning(t, f.traeger, http.MethodGet, link, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	view := decodeSchoolPortalData[carecontract.SigningView](t, rec.Body.Bytes())
	assert.True(t, view.AwaitsSignature)
	require.NotNil(t, view.Previous, "the parents see the version they have so far")
	assert.Len(t, view.Previous.Services, 3, "Monday to Wednesday so far")
	require.Len(t, view.Version.Services, 4, "and Thursday from October")
	assert.Equal(t, "Spätbetreuung", view.Version.Services[3].ModuleName)
	assert.Equal(t, october, view.Version.EffectiveFrom)

	again := amendCareContracts(t, f)
	assert.Empty(t, again.Awaiting, "a repeated run leaves the waiting version alone")
	assert.Equal(t, link, lastSigningLink(t, f, contract), "and sends no second mail")

	rec = publicSigning(t, f.traeger, http.MethodPost, link+"/sign", amendmentSignature(t))
	assert.Equal(t, http.StatusConflict, rec.Code, "a changed version is signed only with the checksum of the PDF the page showed")
	stale := amendmentSignature(t)
	stale["document_sha256"] = strings.Repeat("0", 64)
	rec = publicSigning(t, f.traeger, http.MethodPost, link+"/sign", stale)
	assert.Equal(t, http.StatusConflict, rec.Code, "another PDF than the one that waits is never signed")
	rec = signChangedVersion(t, f, link)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	detail = careContractDetail(t, f, contract)
	assert.Equal(t, []string{"1:abgeloest", "2:wirksam"}, versionStatuses(detail), "the signature makes the version effective")
	require.NotNil(t, detail.Versions[0].ValidUntil)
	assert.Equal(t, calendar.NewDate(2027, 9, 30), *detail.Versions[0].ValidUntil, "the old version holds until the day before")
	assert.Equal(t, october, detail.Versions[1].EffectiveFrom)
	assert.Nil(t, detail.Versions[1].AgreedFrom, "signed in time: it holds from the date its document names")
	assert.False(t, detail.ChangeAwaitsSignature)
	require.Len(t, detail.VersionSignatures, 2, "each version has its own signature")
	assert.Equal(t, carecontract.SignatureDrawn, detail.VersionSignatures[1].Method)
	require.NotNil(t, detail.Signature)
	assert.True(t, detail.Signature.Intact, "the newest signature checks against the version and PDF it signed")
	assert.Equal(t, []int{2}, billedVersions(t, f, contract), "from October the billing reads the signed version")
	assert.Equal(t, carecontract.MailPurposeSigned, lastContractMail(t, f, contract).Purpose, "the parents get the confirmation")

	rec = publicSigning(t, f.traeger, http.MethodPost, link+"/sign", amendmentSignature(t))
	assert.Equal(t, http.StatusGone, rec.Code, "the link signs once")
	assert.Empty(t, amendCareContracts(t, f).Awaiting, "the timeline carries the change")
	assert.Equal(t, 1, countRows(t, f, `SELECT COUNT(*) FROM care_contract.contract_version_services AS s
		JOIN care_contract.contract_versions AS v ON v.id = s.contract_version_id
		WHERE v.contract_id = ? AND v.version_number = 2 AND s.care_offering_id = ?`, contract, late))
}

func countRows(t *testing.T, f careContractFixture, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, f.db.NewRaw(query, args...).Scan(context.Background(), &count))
	return count
}

// approveParentRequest stores the parents' own request for the booked care
// from 1 October 2027 as the school approved it, sent with account.
func approveParentRequest(t *testing.T, f careContractFixture, account, late int64) int64 {
	t.Helper()
	payload := fmt.Sprintf(`{"offerings":[{"offering_id":%d,"selected_days":[]},{"offering_id":%d,"selected_days":[]}]}`, f.offering, late)
	var id int64
	ctx := context.Background()
	student := testpkg.CreateTestStudentForTenant(t, f.db, f.school, "Lina", "Muster", "1a").ID
	require.NoError(t, f.db.NewRaw(`INSERT INTO enrollment.offering_change_requests (tenant_id, student_id, request_child_id, submitted_by,
			payload, effective_from, status, reviewed_at, applied_at)
		VALUES (?, ?, ?, ?, ?::jsonb, DATE '2027-10-01', 'approved', NOW(), NOW()) RETURNING id`,
		f.school, student, f.child, account, payload).Scan(ctx, &id))
	return id
}

// partyAccount gives the contract's party a parents account and answers it.
func partyAccount(t *testing.T, f careContractFixture, contract int64, name string) int64 {
	t.Helper()
	account := testpkg.CreateTestAccount(t, f.db, name+"@example.com")
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_parties SET account_id = ? WHERE contract_id = ?`, account.ID, contract)
	require.NoError(t, err)
	return account.ID
}

// TestCareContractChangeTheParentsAskedForCountsAsTheirSignature pins that
// the parents' own approved request is the signature of the version it
// made: the version holds at once, the request is stored as its proof with
// the checksums, and the parents get the new version without a link.
func TestCareContractChangeTheParentsAskedForCountsAsTheirSignature(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Antrag")
	contract := signedCareContract(t, f)
	late := bookLateCare(t, f)
	// The contract knows no account of its party, as after an enrollment
	// without a login: the party is the account with the party's address.
	account := testpkg.CreateTestAccount(t, f.db, "antrag-partei@example.com").ID
	f.accounts[account] = "Erika.Muster@example.org"
	request := approveParentRequest(t, f, account, late)

	run := amendCareContracts(t, f)
	assert.Empty(t, run.Awaiting, "the parents asked for it themselves: nothing to sign")
	require.Equal(t, []carecontract.AmendedContract{{ContractID: contract, VersionNumber: 2, EffectiveFrom: calendar.NewDate(2027, 10, 1)}}, run.Amended)
	detail := careContractDetail(t, f, contract)
	assert.Equal(t, []string{"1:abgeloest", "2:wirksam"}, versionStatuses(detail))
	assert.False(t, detail.ChangeAwaitsSignature)
	require.Len(t, detail.VersionSignatures, 2)
	proof := detail.VersionSignatures[1]
	assert.Equal(t, carecontract.SignatureRequest, proof.Method)
	assert.Equal(t, carecontract.ChannelParentAccount, proof.Channel)
	assert.Equal(t, "Erika Muster", proof.SignerName)
	assert.Equal(t, 1, countRows(t, f, `SELECT COUNT(*) FROM care_contract.contract_signatures WHERE contract_id = ? AND method = 'request'
		AND change_request_id = ? AND signer_account_id = ? AND version_sha256 ~ '^[0-9a-f]{64}$' AND document_sha256 ~ '^[0-9a-f]{64}$'
		AND signed_at = (SELECT created_at FROM enrollment.offering_change_requests WHERE id = ?)`, contract, request, account, request),
		"method, instant of the request and both checksums are stored (ADR 0088 section 3)")
	require.NotNil(t, detail.Signature)
	assert.Equal(t, carecontract.SignatureRequest, detail.Signature.Method)
	assert.True(t, detail.Signature.Intact)

	mail := lastContractMail(t, f, contract)
	assert.Equal(t, carecontract.MailPurposeAmended, mail.Purpose, "the parents receive the new version")
	assert.Empty(t, mail.SigningURL, "and sign nothing")
	assert.NotEmpty(t, mail.PDF)
	assert.Equal(t, []int{2}, billedVersions(t, f, contract))
}

// TestCareContractRequestOfAnotherGuardianIsNoSignature pins ADR 0088
// section 7: only a party of the contract signs. A request another guardian
// sent, and a request the approval did not carry out as asked, leave the
// version waiting for the party's signature.
func TestCareContractRequestOfAnotherGuardianIsNoSignature(t *testing.T) {
	t.Parallel()
	for name, arrange := range map[string]func(t *testing.T, f careContractFixture, contract, late int64){
		"another guardian": func(t *testing.T, f careContractFixture, contract, late int64) {
			partyAccount(t, f, contract, "andere-partei")
			approveParentRequest(t, f, testpkg.CreateTestAccount(t, f.db, "anderer-elternteil@example.com").ID, late)
		},
		"another address": func(t *testing.T, f careContractFixture, _, late int64) {
			other := testpkg.CreateTestAccount(t, f.db, "andere-adresse@example.com").ID
			f.accounts[other] = "andere-adresse@example.com"
			approveParentRequest(t, f, other, late)
		},
		"other care than asked": func(t *testing.T, f careContractFixture, contract, late int64) {
			request := approveParentRequest(t, f, partyAccount(t, f, contract, "andere-betreuung"), late)
			// The parents asked for the Ganztag only; the school booked the
			// late care on top.
			_, err := f.db.ExecContext(context.Background(), `UPDATE enrollment.offering_change_requests
				SET payload = jsonb_build_object('offerings', jsonb_build_array(jsonb_build_object('offering_id', ?::bigint, 'selected_days', '[]'::jsonb)))
				WHERE id = ?`, f.offering, request)
			require.NoError(t, err)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newCareContractFixture(t, "Träger Vertrag Änderung "+name)
			contract := signedCareContract(t, f)
			arrange(t, f, contract, bookLateCare(t, f))

			run := amendCareContracts(t, f)
			assert.Empty(t, run.Amended)
			require.Len(t, run.Awaiting, 1, "the party of the contract signs the change")
			assert.Equal(t, []string{"1:wirksam", "2:beantragt"}, versionStatuses(careContractDetail(t, f, contract)))
			assert.Zero(t, countRows(t, f, `SELECT COUNT(*) FROM care_contract.contract_signatures WHERE contract_id = ? AND method = 'request'`, contract))
		})
	}
}

// TestCareContractWaitingChangeFollowsTheBookings pins the wait: a change
// the school changes again overtakes the waiting version with a new PDF and
// link, and a change the school takes back ends the wait. The overtaken
// link signs nothing.
func TestCareContractWaitingChangeFollowsTheBookings(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Überholt")
	contract := signedCareContract(t, f)
	late := bookLateCare(t, f)
	require.Len(t, amendCareContracts(t, f).Awaiting, 1)
	first := lastSigningLink(t, f, contract)
	settleContractMails(t, f)

	// The school moves the late care to November.
	ctx := context.Background()
	_, err := f.db.ExecContext(ctx, `UPDATE enrollment.care_offering_bookings SET valid_from = DATE '2027-11-01'
		WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ?`, f.school, f.child, late)
	require.NoError(t, err)
	run := amendCareContracts(t, f)
	require.Equal(t, []carecontract.AmendedContract{{ContractID: contract, VersionNumber: 3, EffectiveFrom: calendar.NewDate(2027, 11, 1)}}, run.Awaiting)
	assert.Equal(t, []string{"1:wirksam", "2:ueberholt", "3:beantragt"}, versionStatuses(careContractDetail(t, f, contract)))
	second := lastSigningLink(t, f, contract)
	assert.NotEqual(t, first, second, "the new version has its own link")
	rec := publicSigning(t, f.traeger, http.MethodPost, first+"/sign", amendmentSignature(t))
	assert.Equal(t, http.StatusGone, rec.Code, "the overtaken version is never signed: %s", rec.Body.String())

	// The school takes the late care back.
	_, err = f.db.ExecContext(ctx, `DELETE FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?
		AND care_offering_id = ?`, f.school, f.child, late)
	require.NoError(t, err)
	run = amendCareContracts(t, f)
	assert.Empty(t, run.Awaiting)
	detail := careContractDetail(t, f, contract)
	assert.Equal(t, []string{"1:wirksam", "2:ueberholt", "3:ueberholt"}, versionStatuses(detail), "nothing waits any more")
	assert.False(t, detail.ChangeAwaitsSignature)
	rec = publicSigning(t, f.traeger, http.MethodGet, second, nil)
	assert.Equal(t, http.StatusGone, rec.Code, "the link of a change taken back opens nothing")
	assert.Equal(t, []int{1}, billedVersions(t, f, contract))
}

// TestCareContractSentButUnsignedFollowsAnApprovedChange pins the gap of PR
// #5953: a sent contract nobody signed yet follows the bookings with a new
// version to sign. The version sent before is never concluded.
func TestCareContractSentButUnsignedFollowsAnApprovedChange(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Versendet Änderung")
	require.Equal(t, http.StatusOK, putTemplate(t, f.traeger, f.office.token, f.school, f.offering, careContractTemplate).Code)
	contract, outdated := sentCareContract(t, f, f.child)
	// The school drops the Wednesday before the parents signed. The first
	// mail is still on its way: the changed version goes out all the same,
	// so the outdated link never stays the only one.
	_, err := f.db.ExecContext(context.Background(), `UPDATE enrollment.care_offerings SET available_days = '["mon","tue"]'::jsonb WHERE id = ?`, f.offering)
	require.NoError(t, err)
	run := amendCareContracts(t, f)
	require.Len(t, run.Awaiting, 1)
	assert.Equal(t, 2, run.Awaiting[0].VersionNumber)
	detail := careContractDetail(t, f, contract)
	assert.Equal(t, carecontract.StatusSent, detail.Status)
	assert.Equal(t, []string{"1:ueberholt", "2:beantragt"}, versionStatuses(detail))
	assert.Len(t, detail.Version.Services, 2, "the contract shows the care booked now")
	assert.True(t, detail.DocumentFrozen, "with its own frozen PDF")
	assert.Equal(t, carecontract.MailPurposeAmendment, lastContractMail(t, f, contract).Purpose)

	rec := publicSigning(t, f.traeger, http.MethodPost, outdated+"/sign", amendmentSignature(t))
	require.Equal(t, http.StatusGone, rec.Code, "the outdated version cannot conclude the contract: %s", rec.Body.String())
	assert.Equal(t, carecontract.StatusSent, careContractDetail(t, f, contract).Status)

	current := lastSigningLink(t, f, contract)
	rec = publicSigning(t, f.traeger, http.MethodGet, current, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	view := decodeSchoolPortalData[carecontract.SigningView](t, rec.Body.Bytes())
	require.NotNil(t, view.Previous, "the parents see what changed since the version they got first")
	assert.Len(t, view.Previous.Services, 3)
	rec = signChangedVersion(t, f, current)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	detail = careContractDetail(t, f, contract)
	assert.Equal(t, carecontract.StatusActive, detail.Status)
	assert.Equal(t, []string{"1:ueberholt", "2:wirksam"}, versionStatuses(detail), "concluded on the changed version")
	assert.Empty(t, amendCareContracts(t, f).Awaiting)
}

// TestCareContractWaitingChangeIsRemindedAnew pins that a changed version
// is reminded like a first contract (#4679), with its own count.
func TestCareContractWaitingChangeIsRemindedAnew(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Erinnerung")
	contract := signedCareContract(t, f)
	bookLateCare(t, f)
	require.Len(t, amendCareContracts(t, f).Awaiting, 1)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	mails := &owners.CareContractTestMails{}
	remind := func() {
		t.Helper()
		for _, statement := range []string{
			`UPDATE care_contract.contract_mailings SET sent_at = ? WHERE organization_id = ?`,
			`UPDATE care_contract.contract_reminders SET sent_at = ? WHERE organization_id = ?`,
		} {
			_, err := f.db.ExecContext(ctx, statement, holidayFixtureNow().Add(-8*24*time.Hour), f.office.organization)
			require.NoError(t, err)
		}
		reminders := careContractCompose.NewReminders(careContractCompose.ReminderPorts{
			Organizations: reminderTraeger{id: f.office.organization}, Settings: reminderDays{days: 7}, Sender: reminderSender{},
			Post: mails, Runtime: owners.CareContractRuntime{}, Links: owners.CareContractLinks("http://parents.localhost:3000"),
		}, holidayFixtureNow)
		require.NoError(t, reminders.RemindDue(ctx))
	}
	for range 4 {
		remind()
	}
	assert.Len(t, mails.Purposes(), 3, "at most three reminders of the changed version")
	detail := careContractDetail(t, f, contract)
	require.Len(t, detail.Reminders, 3)
	assert.Equal(t, 2, detail.Reminders[0].VersionNumber, "the reminders belong to the version that waits")
	assert.Equal(t, 1, detail.Reminders[0].Number, "and count from one")
}

// TestCareContractInboxOffersTheWaitingChangeToSign pins the parents'
// inbox: the contract shows its changed version with the signature open,
// and the signing view of the portal shows the same change.
func TestCareContractInboxOffersTheWaitingChangeToSign(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Postfach")
	contract := signedCareContract(t, f)
	bookLateCare(t, f)
	student := testpkg.CreateTestStudentForTenant(t, f.db, f.school, "Lina", "Muster", "1a").ID
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET student_id = ? WHERE id = ?`, student, contract)
	require.NoError(t, err)
	children := map[int64][]int64{f.school: {student}}
	reader := carecontract.InboxReader{AccountID: testpkg.CreateTestAccount(t, f.db, "postfach-aenderung@example.com").ID,
		Email: "erika.muster@example.org", Children: children, SigningChildren: children}
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	inbox := func() carecontract.InboxContract {
		t.Helper()
		var listed []carecontract.InboxContract
		require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
			var err error
			listed, err = careContractCompose.NewInbox(owners.CareContractTestHolidays{}, holidayFixtureNow).InboxContracts(txCtx, f.office.organization, reader)
			return err
		}))
		require.Len(t, listed, 1)
		return listed[0]
	}
	before := inbox()
	assert.False(t, before.CanSign, "a signed contract has nothing to sign")
	assert.False(t, before.ChangeAwaitsSignature)

	require.Len(t, amendCareContracts(t, f).Awaiting, 1)
	waiting := inbox()
	assert.True(t, waiting.ChangeAwaitsSignature, "the changed version waits")
	assert.True(t, waiting.CanSign, "and the parents may sign it in the portal")
	assert.Equal(t, calendar.NewDate(2027, 10, 1), waiting.EffectiveOn)
	assert.Equal(t, carecontract.StatusActive, waiting.Status)

	signing := owners.NewParentContractSigningForTests(&owners.CareContractTestMails{})
	var view carecontract.SigningView
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		var err error
		view, err = signing.InboxSigningView(txCtx, f.office.organization, contract, reader)
		return err
	}))
	assert.True(t, view.AwaitsSignature)
	require.NotNil(t, view.Previous)
	assert.Len(t, view.Version.Services, 4)

	stranger := reader
	stranger.Email = "fremd@example.org"
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		_, err := signing.InboxSigningView(txCtx, f.office.organization, contract, stranger)
		assert.ErrorIs(t, err, carecontract.ErrInboxDocumentNotFound, "an account the contract did not go to sees nothing")
		return nil
	}))
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		_, err := signing.SignInInbox(txCtx, f.office.organization, contract, reader, carecontract.SignatureInput{
			Method: carecontract.SignatureDrawn, ImagePNG: signatureImage(t), NoticeAcknowledged: true})
		assert.ErrorIs(t, err, carecontract.ErrContractNotSignable, "the inbox signs a changed version only with the checksum of the PDF it showed")
		return nil
	}))
	require.NoError(t, tenant.WithinTraeger(ctx, f.office.organization, func(txCtx context.Context) error {
		_, err := signing.SignInInbox(txCtx, f.office.organization, contract, reader, carecontract.SignatureInput{
			Method: carecontract.SignatureDrawn, ImagePNG: signatureImage(t), NoticeAcknowledged: true, DocumentSHA256: view.DocumentSHA256})
		return err
	}))
	after := inbox()
	assert.False(t, after.ChangeAwaitsSignature, "signed: nothing waits")
	assert.False(t, after.CanSign)
	assert.Equal(t, []string{"1:abgeloest", "2:wirksam"}, versionStatuses(careContractDetail(t, f, contract)))
}

// TestCareContractRequestOfThePartyOvertakesAWaitingChange pins that a
// version the parents asked for themselves takes the place of one that
// still waits: the link of the waiting version signs nothing afterwards.
func TestCareContractRequestOfThePartyOvertakesAWaitingChange(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Änderung Antrag überholt")
	contract := signedCareContract(t, f)
	late := bookLateCare(t, f)
	require.Len(t, amendCareContracts(t, f).Awaiting, 1)
	waitingLink := lastSigningLink(t, f, contract)

	// The party asks for the same care from the same day; the school
	// approves it.
	approveParentRequest(t, f, partyAccount(t, f, contract, "antrag-ueberholt"), late)
	run := amendCareContracts(t, f)
	require.Len(t, run.Amended, 1, "the request signs the change")
	assert.Equal(t, 3, run.Amended[0].VersionNumber)
	assert.Equal(t, []string{"1:abgeloest", "2:ueberholt", "3:wirksam"}, versionStatuses(careContractDetail(t, f, contract)))
	rec := publicSigning(t, f.traeger, http.MethodGet, waitingLink, nil)
	assert.Equal(t, http.StatusGone, rec.Code, "the overtaken version is never signed")
}
