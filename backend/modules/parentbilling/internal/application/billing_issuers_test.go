package application

import (
	"context"
	"time"

	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

var hardt = &parentbilling.BillingIssuer{Key: "DE13ZZZ00000012345", Body: parentbilling.IssuerGemeinde, Name: "Gemeinde Hardt",
	SenderText: "Gemeinde Hardt\nRathausplatz 1\n41749 Viersen", ContactName: "Petra Sommer", CreditorID: "DE13ZZZ00000012345",
	BankAccount: &parentbilling.LetterheadBankAccount{AccountHolder: "Gemeindekasse Hardt", IBAN: "DE02120300000000202051"}}

// TestHolidayChildrenOfTwoIssuersGetADocumentEach (ADR 0321 point 3): the
// children of one registration at schools of different issuers never share
// a document, even while the Träger writes one per registration; a
// registration of one issuer stays whole and takes it.
func TestHolidayChildrenOfTwoIssuersGetADocumentEach(t *testing.T) {
	t.Parallel()
	week := calendar.NewDate(2027, 1, 4)
	weekEnd := week.AddDays(4)
	booked := func(ids ...int64) parentbilling.HolidayContribution {
		contribution := parentbilling.HolidayContribution{}
		for _, id := range ids {
			contribution.Children = append(contribution.Children, parentbilling.HolidayChildContribution{ChildID: ident.ID(id), TotalCents: 4500,
				Lines: []parentbilling.HolidayContributionLine{{Kind: parentbilling.LineBase, AmountCents: 4500, WeekStartsOn: &week, WeekEndsOn: &weekEnd}}})
		}
		return contribution
	}
	registrations := []parentbilling.HolidayBillingRegistration{
		{ID: 21, Children: []parentbilling.HolidayBillingChild{{ID: 211}, {ID: 212}}},
		{ID: 22, Children: []parentbilling.HolidayBillingChild{{ID: 221}, {ID: 222}}},
	}
	result := buildPreview(previewInput{
		run: parentbilling.BillingRun{ID: 40}, registrations: registrations,
		contributions: map[int64]parentbilling.HolidayContribution{21: booked(211, 212), 22: booked(221, 222)},
		issuers:       map[int64]*parentbilling.BillingIssuer{211: hardt, 221: hardt, 222: hardt},
	})
	type drafted struct {
		registration, child int64
		issuer              string
	}
	var got []drafted
	for _, document := range result.documents {
		got = append(got, drafted{document.RegistrationID.Int64(), document.RegistrationChildID.Int64(), parentbilling.IssuerKeyOf(document.Issuer)})
	}
	assert.Equal(t, []drafted{{21, 211, hardt.Key}, {21, 212, ""}, {22, 0, hardt.Key}}, got)
}

// TestFirstHostIsTheHostOfTheEarliestWeek: a holiday guest is billed by the
// issuer of the host school of its first booked week.
func TestFirstHostIsTheHostOfTheEarliestWeek(t *testing.T) {
	t.Parallel()
	first, second := calendar.NewDate(2027, 7, 5), calendar.NewDate(2027, 7, 12)
	const child, firstSchool, secondSchool int64 = 7, 3, 4
	contribution := parentbilling.HolidayContribution{Children: []parentbilling.HolidayChildContribution{{ChildID: ident.ID(child), Lines: []parentbilling.HolidayContributionLine{
		{Kind: parentbilling.LineBase, WeekStartsOn: &second}, {Kind: parentbilling.LineBase, WeekStartsOn: &first},
	}}}}
	hosts := []parentbilling.HolidayWeekHost{
		{StartsOn: first, EndsOn: first.AddDays(4), HostSchoolID: firstSchool}, {StartsOn: second, EndsOn: second.AddDays(4), HostSchoolID: secondSchool},
	}
	assert.Equal(t, firstSchool, firstHost(contribution, child, hosts))
	assert.Zero(t, firstHost(contribution, child+1, hosts), "a child without a week has no host")
}

// TestLetterOfABodyPrintsItsSenderAndAccount: a body replaces sender,
// contact and account of the Träger and leaves logo and footer off; the
// Träger's documents keep its letterhead.
func TestLetterOfABodyPrintsItsSenderAndAccount(t *testing.T) {
	t.Parallel()
	head := parentbilling.Letterhead{Logo: []byte{1}, SenderText: "Ganztag e.V.\nAm Markt 4\n49143 Bissendorf", FooterText: "Vorstand",
		ContactName: "Tom", BankAccount: &parentbilling.LetterheadBankAccount{IBAN: "DE89370400440532013000"}, PaymentText: "Bitte zahle."}
	assert.Equal(t, head, issuerLetterhead(head, nil))
	own := issuerLetterhead(head, hardt)
	assert.Equal(t, hardt.SenderText, own.SenderText)
	assert.Equal(t, "Petra Sommer", own.ContactName)
	assert.Equal(t, hardt.BankAccount, own.BankAccount)
	assert.Nil(t, own.Logo)
	assert.Empty(t, own.FooterText)
	assert.Equal(t, "Bitte zahle.", own.PaymentText, "the payment sentence of the Träger stays")
	assert.Equal(t, "Gemeinde Hardt", mailSenderOf(hardt, "Ganztag e.V."))
	assert.Equal(t, "Ganztag e.V.", mailSenderOf(nil, "Ganztag e.V."))
}

// TestEachIssuerNumbersItsOwnDocumentsInTheirOrder: the Träger's documents
// come first, each issuer's keep their order.
func TestEachIssuerNumbersItsOwnDocumentsInTheirOrder(t *testing.T) {
	t.Parallel()
	documents := []parentbilling.CareInvoice{{ContractID: 1, Issuer: hardt}, {ContractID: 2}, {ContractID: 3, Issuer: hardt}, {ContractID: 4}}
	groups := byIssuer(documents, func(invoice parentbilling.CareInvoice) string { return parentbilling.IssuerKeyOf(invoice.Issuer) })
	require.Len(t, groups, 2)
	contracts := func(group []parentbilling.CareInvoice) []int64 {
		ids := []int64{}
		for _, invoice := range group {
			ids = append(ids, invoice.ContractID.Int64())
		}
		return ids
	}
	assert.Equal(t, []int64{2, 4}, contracts(groups[0]))
	assert.Equal(t, []int64{1, 3}, contracts(groups[1]))
	groups[1][0].Number = "GH-1"
	assert.Equal(t, "GH-1", documents[2].Number, "a group is a part of the documents: its numbers reach them")
}

// TestAMandateBindsTheCreditorOfItsIssuer: an invoice of a body takes the
// family's mandate for the body's creditor identifier, the Träger's
// invoice the Träger's mandate; without one for the body the invoice is a
// transfer with the gap, never collected with another creditor's mandate.
func TestAMandateBindsTheCreditorOfItsIssuer(t *testing.T) {
	t.Parallel()
	signed := calendar.NewDate(2026, 9, 1)
	traegerMandate := parentbilling.SEPAMandate{ID: 1, FamilyEmail: "eva@example.org", CreditorID: "DE98ZZZ09999999999", SignedOn: signed,
		Kind: parentbilling.MandateRecurring, Sequence: parentbilling.SequenceRecurring, CreatedAt: signed.BerlinMidnight()}
	payments := invoicePayments{creditor: parentbilling.SEPACreditor{CreditorID: "DE98ZZZ09999999999", PrenotificationDays: 14,
		MissingMandate: parentbilling.MissingMandateTransfer},
		mandates:     map[mandateKey]*parentbilling.SEPAMandate{{familyEmail: "eva@example.org", creditorID: "DE98ZZZ09999999999"}: &traegerMandate},
		usedMandates: map[int64]parentbilling.SEPAMandate{}}
	payments.withIssuers(map[int64]parentbilling.BillingIssuer{3: *hardt})
	terms := parentbilling.ServiceTerms{PaymentMethod: parentbilling.PaymentDirectDebit, DueDays: 10}
	issuedOn := calendar.NewDate(2026, 11, 2)
	direct := parentbilling.InvoicePayment{Method: parentbilling.PaymentDirectDebit, DueOn: issuedOn.AddDays(20)}

	byTraeger := payments.debit(direct, terms, nil, "eva@example.org", nil, issuedOn)
	require.NotNil(t, byTraeger.Mandate)
	assert.Equal(t, "DE98ZZZ09999999999", byTraeger.Mandate.CreditorID)
	byGemeinde := payments.debit(direct, terms, nil, "eva@example.org", hardt, issuedOn)
	assert.Nil(t, byGemeinde.Mandate, "the Träger's mandate is no mandate for the Gemeinde")
	assert.Equal(t, parentbilling.DebitGapMandate, byGemeinde.DebitGap)
	assert.Equal(t, parentbilling.PaymentTransfer, byGemeinde.Method)
}

// issuerLetterheads lets hardt bill school 3 (#8040).
type issuerLetterheads struct{ fakeLetterheads }

func (issuerLetterheads) SchoolBillingIssuers(context.Context, int64, []int64) (map[int64]parentbilling.BillingIssuer, error) {
	return map[int64]parentbilling.BillingIssuer{3: *hardt}, nil
}

// TestEachIssuerCollectsItsDebitsInAFileOfItsOwn (ADR 0321 point 8): the
// Träger's file holds only the Träger's debits; the body's file carries its
// creditor identifier and its account, and the run names the body.
func TestEachIssuerCollectsItsDebitsInAFileOfItsOwn(t *testing.T) {
	t.Parallel()
	store := sjrDebits()
	byHardt := sealedDebit(4, 14, "GH-2027-0001", 3100, parentbilling.SequenceTypeFirst, "Eva Kranz", "DE89370400440532013000")
	byHardt.Issuer, byHardt.CreditorID = &parentbilling.BillingIssuer{Key: hardt.Key, Body: hardt.Body, Name: hardt.Name,
		BankAccount: &parentbilling.LetterheadBankAccount{AccountHolder: "Alte Kasse", IBAN: "DE75512108001245126199"}}, hardt.Key
	store.debits = append(store.debits, byHardt)
	debits := NewSEPADebits(store, issuerLetterheads{fakeLetterheads{account: &parentbilling.LetterheadBankAccount{
		AccountHolder: "Stadtjugendring Pforzheim e. V.", IBAN: "DE75 5121 0800 1245 1261 99", BIC: "SOLADES1PFO"}}},
		prefixCipher{}, func() calendar.Date { return calendar.NewDate(2026, 11, 20) },
		func() time.Time { return time.Date(2026, 11, 20, 9, 30, 0, 0, time.UTC) }, testpkg.ContentFingerprint)
	ctx := context.Background()

	traeger, err := debits.SEPADebitRun(ctx, sjrReviewer, parentbilling.DebitRunCare, 3, "")
	require.NoError(t, err)
	assert.Equal(t, 3, traeger.Count, "the Gemeinde's debit stays out of the Träger's file")
	assert.Empty(t, traeger.Left)
	assert.Nil(t, traeger.Issuer)
	assert.Equal(t, []parentbilling.BillingIssuer{{Key: hardt.Key, Body: hardt.Body, Name: hardt.Name}}, traeger.Issuers)

	own, err := debits.SEPADebitRun(ctx, sjrReviewer, parentbilling.DebitRunCare, 3, hardt.Key)
	require.NoError(t, err)
	assert.Equal(t, 1, own.Count)
	assert.Equal(t, hardt.Key, own.CreditorID)
	assert.Equal(t, "Gemeindekasse Hardt", own.CreditorName, "the body's account now, not the one printed earlier")
	require.NotNil(t, own.Issuer)
	assert.Equal(t, "Gemeinde Hardt", own.Issuer.Name)
	assert.NotEqual(t, traeger.MessageID, own.MessageID)

	file, err := debits.SEPADebitFile(ctx, sjrReviewer, parentbilling.DebitRunCare, 3, hardt.Key)
	require.NoError(t, err)
	xml := string(file.Data)
	for _, want := range []string{"<Id>" + hardt.Key + "</Id>", "<IBAN>DE02120300000000202051</IBAN>", "<Nm>Gemeindekasse Hardt</Nm>",
		"<EndToEndId>GH-2027-0001</EndToEndId>", "<NbOfTxs>1</NbOfTxs>"} {
		assert.Contains(t, xml, want)
	}
	assert.NotContains(t, xml, "RE-2027-0001")
	_, err = debits.SubmitSEPADebits(ctx, sjrReviewer, parentbilling.DebitRunCare, 3, hardt.Key, own.MessageID)
	require.NoError(t, err)
	require.Len(t, store.submitted, 1)
	assert.Equal(t, []int64{4}, store.submitted[0], "the confirmation of the body's file submits only its debits")

	_, err = debits.SEPADebitRun(ctx, sjrReviewer, parentbilling.DebitRunCare, 3, "DE57ZZZ00000067890")
	assert.ErrorIs(t, err, parentbilling.ErrSEPADebitRunNotFound, "a creditor without debits in the run has no file")
}
