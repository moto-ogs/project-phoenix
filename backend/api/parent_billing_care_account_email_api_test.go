package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The invoice follows the parents account; the contract stays as signed
// (#8215, rule „Kopie oder Verbindung“).

type careAccountLetterBody struct {
	InvoiceID      wireID `json:"invoice_id"`
	Kind           string `json:"kind"`
	RecipientEmail string `json:"recipient_email"`
}

// careAccountRunBody is the run with the addresses of its invoices.
type careAccountRunBody struct {
	Invoices []struct {
		ID         wireID `json:"id"`
		ContractID wireID `json:"contract_id"`
		Recipient  struct {
			Email         string `json:"email"`
			ContractEmail string `json:"contract_email"`
		} `json:"recipient"`
	} `json:"invoices"`
}

// careAccountRecipient is the recipient of the contract's invoice in body.
func careAccountRecipient(t *testing.T, body []byte, contractID int64) (int64, string, string) {
	t.Helper()
	for _, invoice := range decodeSchoolPortalData[careAccountRunBody](t, body).Invoices {
		if int64(invoice.ContractID) == contractID {
			return int64(invoice.ID), invoice.Recipient.Email, invoice.Recipient.ContractEmail
		}
	}
	require.FailNow(t, "no invoice for the contract")
	return 0, "", ""
}

type careAccountContractBody struct {
	Parties []struct {
		Email        string `json:"email"`
		HasAccount   bool   `json:"has_account"`
		AccountEmail string `json:"account_email"`
	} `json:"parties"`
}

// linkPartyAccount gives the contract's party a parents account and answers
// the address the contract was signed with.
func linkPartyAccount(t *testing.T, f careBillingFixture, contractID int64, accountEmail string) (int64, string) {
	t.Helper()
	account := testpkg.CreateTestAccount(t, f.db, accountEmail)
	var signed string
	require.NoError(t, f.db.NewRaw(`UPDATE care_contract.contract_parties SET account_id = ? WHERE contract_id = ? RETURNING email`,
		account.ID, contractID).Scan(context.Background(), &signed))
	return account.ID, signed
}

// changeAccountEmail is the parent changing the address of the account.
func changeAccountEmail(t *testing.T, f careBillingFixture, accountID int64, email string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `UPDATE auth.accounts SET email = ? WHERE id = ?`, email, accountID)
	require.NoError(t, err)
}

// contractsOffice signs in a colleague with the right "Verträge".
func contractsOffice(t *testing.T, f careBillingFixture) traegerOffice {
	t.Helper()
	password := testpkg.NewTestPassword()
	account := traegerAccount(t, f.db, password)
	testpkg.CreateTestTraegerMember(t, f.db, f.office.organization, account.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, f.traeger, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	office := f.office
	office.token = answer.AccessToken
	return office
}

// careMailedAddresses are the addresses the Träger's letters were mailed to.
func careMailedAddresses(t *testing.T, f careBillingFixture) []string {
	t.Helper()
	var addresses []string
	require.NoError(t, f.db.NewRaw(`SELECT recipient_email FROM parent_billing.care_letter_mailings
		WHERE organization_id = ? ORDER BY id`, f.office.organization).Scan(context.Background(), &addresses))
	return addresses
}

func careAccountLetter(t *testing.T, f careBillingFixture, runID, invoiceID int64) careAccountLetterBody {
	t.Helper()
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, careRunPath(runID, "/letters"), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	for _, document := range decodeSchoolPortalData[struct {
		Documents []careAccountLetterBody `json:"documents"`
	}](t, rec.Body.Bytes()).Documents {
		if int64(document.InvoiceID) == invoiceID && document.Kind == "invoice" {
			return document
		}
	}
	require.FailNow(t, "no letter for the invoice")
	return careAccountLetterBody{}
}

// A parent changes the account's address: the next invoice goes there, the
// contract keeps the signed address, and both places name the difference.
func TestCareInvoiceGoesToTheParentsAccountAddressAndTheContractStaysAsSigned(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kontoadresse")
	brandCareTraeger(t, f)
	school := f.office.schools[0]
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careMonth, sjrServices()...)
	accountID, signed := linkPartyAccount(t, f, mia, "eva-konto")
	moved := fmt.Sprintf("eva.neu.%d@example.org", mia)
	changeAccountEmail(t, f, accountID, moved)

	rec := putCarePriceList(t, f.traeger, f.office.token, carePriceList(school, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	run := f.startRun(t, careMonth)
	preview := f.run(t, int64(run.ID))
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/release"), careRelease(preview))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	invoiceID, email, contractEmail := careAccountRecipient(t, rec.Body.Bytes(), mia)
	assert.Equal(t, moved, email, "the invoice goes to the account's address of today")
	assert.Equal(t, signed, contractEmail, "the Abrechnung names the differing contract address")
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet, careRunPath(int64(run.ID), ""), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	_, email, contractEmail = careAccountRecipient(t, rec.Body.Bytes(), mia)
	assert.Equal(t, []string{moved, signed}, []string{email, contractEmail}, "the issued invoice keeps both addresses")
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/letters"), careLettersInput())
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, moved, careAccountLetter(t, f, int64(run.ID), invoiceID).RecipientEmail)

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/letters/mail"), nil)
	require.Equal(t, http.StatusAccepted, rec.Code, rec.Body.String())
	assert.Equal(t, careSeriesBody{Queued: 1}, decodeSchoolPortalData[careSeriesBody](t, rec.Body.Bytes()))
	assert.Equal(t, []string{moved}, careMailedAddresses(t, f), "the mail goes to the account's address")

	contracts := contractsOffice(t, f)
	rec = traegerJSON(t, f.traeger, contracts.token, http.MethodGet, fmt.Sprintf("/traeger/contracts/%d", mia), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	detail := decodeSchoolPortalData[careAccountContractBody](t, rec.Body.Bytes())
	require.Len(t, detail.Parties, 1)
	assert.Equal(t, signed, detail.Parties[0].Email, "the contract keeps the signed address")
	assert.True(t, detail.Parties[0].HasAccount)
	assert.Equal(t, moved, detail.Parties[0].AccountEmail, "the contract names where its invoices go")

	// Another Träger's office reads neither the contract nor its address.
	other := newTraegerOffice(t, f.db, f.traeger, "Träger Fremd", identityaccess.TraegerRoleAdministration)
	rec = traegerJSON(t, f.traeger, other.token, http.MethodGet, fmt.Sprintf("/traeger/contracts/%d", mia), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), moved)
}

// An invoice that copied the contract's address before the account's
// address counted still goes out while the contract keeps that address.
func TestCareInvoiceIssuedToTheContractAddressStillGoesOutAfterAnAccountIsLinked(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kontoadresse später")
	brandCareTraeger(t, f)
	run, contracts := releasedCareRun(t, f, "Mia")
	mia := invoiceOfContract(t, run, contracts["Mia"])
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), "/letters"), careLettersInput())
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	_, signed := linkPartyAccount(t, f, contracts["Mia"], "eva-spaeter")

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(run.ID), fmt.Sprintf("/invoices/%d/mail", mia.ID)), nil)
	require.Equal(t, http.StatusAccepted, rec.Code, rec.Body.String())
	assert.Equal(t, []string{signed}, careMailedAddresses(t, f), "the issued invoice keeps the address it copied")
}
