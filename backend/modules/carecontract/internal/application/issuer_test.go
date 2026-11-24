package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// currentIssuers names the body every school is set to now and counts how
// often it is asked.
type currentIssuers struct {
	issuer carecontract.Issuer
	asked  int
}

func (c *currentIssuers) SchoolIssuers(_ context.Context, _ int64, schoolIDs []int64) (map[int64]carecontract.Issuer, error) {
	c.asked++
	issuers := map[int64]carecontract.Issuer{}
	for _, id := range schoolIDs {
		issuers[id] = c.issuer
	}
	return issuers, nil
}

// TestContractKeepsTheBodyThatIssuedItsPDF pins #4811: a contract without a
// stored PDF names the body its school is set to now; once a PDF is stored
// the contract keeps the body that issued it, also on a later version that
// has no PDF of its own (an amendment) and when that body was the Träger.
func TestContractKeepsTheBodyThatIssuedItsPDF(t *testing.T) {
	t.Parallel()
	gemeinde := carecontract.Issuer{SenderText: "Gemeinde Hardt\nRathausplatz 1\n41749 Viersen", ContactPhone: "02162 1010"}
	stadt := carecontract.Issuer{SenderText: "Stadt Viersen\nBahnhofstraße 23\n41747 Viersen"}
	const school = 41
	var documentID int64 = 7
	record := func(change func(*ContractRecord)) ContractRecord {
		r := ContractRecord{Summary: carecontract.ContractSummary{SchoolID: ident.ID(school)}}
		change(&r)
		return r
	}
	for name, test := range map[string]struct {
		record ContractRecord
		want   *carecontract.Issuer
		asked  int
	}{
		"a draft names the body of today": {
			record: record(func(*ContractRecord) {}), want: &stadt, asked: 1,
		},
		"a sent contract keeps its Gemeinde": {
			record: record(func(r *ContractRecord) { r.DocumentID, r.Issuer = &documentID, &gemeinde }), want: &gemeinde,
		},
		"a contract the Träger sent stays with the Träger": {
			record: record(func(r *ContractRecord) { r.DocumentID = &documentID }), want: nil,
		},
		"an amended version without a PDF keeps the body of the sent PDF": {
			record: record(func(r *ContractRecord) {
				r.SentDocument = &SentDocument{ID: documentID, VersionID: 3, Issuer: &gemeinde}
			}), want: &gemeinde,
		},
		"an amended version of a contract the Träger sent stays with the Träger": {
			record: record(func(r *ContractRecord) { r.SentDocument = &SentDocument{ID: documentID, VersionID: 3} }), want: nil,
		},
	} {
		current := &currentIssuers{issuer: stadt}
		got, err := contractIssuer(context.Background(), current, 1, test.record)
		require.NoError(t, err, name)
		assert.Equal(t, test.want, got, name)
		assert.Equal(t, test.asked, current.asked, "%s: a stored PDF answers without a read", name)
		// The mails, reminders and notices of the contract follow the same body.
		wantSender := "Träger e.V.\nAm Markt 4\n49143 Bissendorf"
		if test.asked == 0 && test.want != nil { // a stored PDF of another body
			wantSender = test.want.SenderText
		}
		assert.Equal(t, wantSender, issuedSender("Träger e.V.\nAm Markt 4\n49143 Bissendorf", test.record), name)
	}

	// A composition without the port knows only the Träger.
	got, err := contractIssuer(context.Background(), nil, 1, record(func(*ContractRecord) {}))
	require.NoError(t, err)
	assert.Nil(t, got)

	// The issuer's letterhead: its own sender and contact, never the
	// Träger's logo, footer or withdrawal contact.
	head := gemeinde.Letterhead(carecontract.Letterhead{
		AccentColor: "#217A78", Logo: []byte{1}, SenderText: "Träger e.V.", FooterText: "Vorstand", ContactName: "Petra",
		ContactPhone: "0541 1", WithdrawalEmail: "widerruf@traeger.example", Template: carecontract.LetterTemplate{Version: 4},
	})
	assert.Equal(t, carecontract.Letterhead{
		AccentColor: "#217A78", SenderText: gemeinde.SenderText, ContactPhone: "02162 1010", Template: carecontract.LetterTemplate{Version: 4},
	}, head)
	assert.Equal(t, carecontract.WithdrawalReach{ContactPhone: "02162 1010"}, gemeinde.Reach())
}
