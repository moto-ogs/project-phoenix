package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// "Already billed" counts per child (#7892, ADR 0158 Nachtrag "Schon
// abgerechnet je Kind"). Noah's contract is billed and withdrawn afterwards;
// his new contract would bill January again. The next run holds Noah back
// and names the issued invoice, its release keeps that in sight (E5), and
// after the Storno a later run bills the new contract.
func TestCareMonthlyRunHoldsAChildAnIssuedInvoiceAlreadyBills(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Monatsbeitrag Schon abgerechnet")
	school := f.office.schools[0]
	withdrawn := careContract(t, f.db, f.office.organization, school, "Noah", careMonth, sjrServices()...)
	rec := putCarePriceList(t, f.traeger, f.office.token, carePriceList(school, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	first := f.startRun(t, careMonth)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(first.ID), "/release"), careRelease(f.run(t, int64(first.ID))))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	issued := decodeSchoolPortalData[careRunBody](t, rec.Body.Bytes()).Invoices[0]

	ctx := context.Background()
	_, err := f.db.NewRaw(`UPDATE care_contract.contracts SET status = 'widerrufen' WHERE id = ?`, withdrawn).Exec(ctx)
	require.NoError(t, err)
	again := careContract(t, f.db, f.office.organization, school, "Noah", careMonth, sjrServices()...)
	mia := careContract(t, f.db, f.office.organization, school, "Mia", careMonth, sjrServices()...)
	// Without a student record the contracts are one child by his name and
	// date of birth (ADR 0158 E1).
	_, err = f.db.NewRaw(`UPDATE care_contract.contract_versions SET child_birth_date = '2020-02-01'
		WHERE organization_id = ? AND contract_id IN (?, ?)`, f.office.organization, withdrawn, again).Exec(ctx)
	require.NoError(t, err)

	type heldRun struct {
		careRunBody
		BilledChildren []struct {
			ChildFirstName string `json:"child_first_name"`
			Reason         string `json:"reason"`
			Contracts      []struct {
				ContractID wireID `json:"contract_id"`
			} `json:"contracts"`
			Invoices []struct {
				Source       string `json:"source"`
				RunID        wireID `json:"run_id"`
				ContractID   wireID `json:"contract_id"`
				SchoolName   string `json:"school_name"`
				Number       string `json:"number"`
				DocumentKind string `json:"document_kind"`
			} `json:"invoices"`
		} `json:"billed_children"`
	}
	shown := func(id int64) heldRun {
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, careRunPath(id, ""), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeSchoolPortalData[heldRun](t, rec.Body.Bytes())
	}
	second := shown(int64(f.startRun(t, careMonth).ID))
	require.Len(t, second.Invoices, 1, "only Mia is billed: Noah's January has an invoice")
	assert.Equal(t, mia, int64(second.Invoices[0].ContractID))
	require.Len(t, second.BilledChildren, 1, "the review names Noah")
	held := second.BilledChildren[0]
	assert.Equal(t, "Noah", held.ChildFirstName)
	assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, held.Reason)
	require.Len(t, held.Contracts, 1)
	assert.Equal(t, again, int64(held.Contracts[0].ContractID), "the contract the run holds back")
	require.Len(t, held.Invoices, 1)
	assert.Equal(t, withdrawn, int64(held.Invoices[0].ContractID))
	assert.Equal(t, issued.Number, held.Invoices[0].Number, "the invoice in its way, as InvoicedContracts reads it")
	assert.Equal(t, int64(first.ID), int64(held.Invoices[0].RunID))
	assert.Equal(t, parentbilling.BilledByCareRun, held.Invoices[0].Source)
	assert.Equal(t, parentbilling.DocumentKindInvoice, held.Invoices[0].DocumentKind)
	assert.NotEmpty(t, held.Invoices[0].SchoolName)

	// E5: the release stores the held child with the invoice, and the
	// released run shows it from there.
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(second.ID), "/release"), careRelease(second.careRunBody))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, second.BilledChildren, shown(int64(second.ID)).BilledChildren, "the released run keeps the held child in sight")

	// The office cancels the invoice of the withdrawn contract: the next
	// run of the month bills Noah's new contract, 32,00 € + 45,50 €.
	brandCareTraeger(t, f)
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(first.ID), "/letters"), careLettersInput())
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunPath(int64(first.ID), fmt.Sprintf("/invoices/%d/cancellation", issued.ID)),
		map[string]any{"reason": "Vertrag widerrufen"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	third := shown(int64(f.startRun(t, careMonth).ID))
	assert.Empty(t, third.BilledChildren)
	require.Len(t, third.Invoices, 1)
	assert.Equal(t, again, int64(third.Invoices[0].ContractID))
	assert.Equal(t, int64(7750), third.Invoices[0].TotalCents)
}

// A child changes to another school of the Träger with a record of its own
// (#7874) after the Jahresbescheid of its old school assessed the year. The
// notice still assesses the months after the change, so the monthly run of
// the new school holds the child back and names the notice (#7892), read
// through the routes: the notice month with its days, the child of the ended
// contract and the school change by name, date of birth and family.
func TestCareMonthlyRunHoldsAChildAJahresbescheidOfItsOldSchoolBills(t *testing.T) {
	t.Parallel()
	f, old := newNoticeFixture(t, "Träger Schulwechsel nach Bescheid")
	school, next := f.office.schools[0], f.office.schools[1]
	writeLegalRemedy(t, f.db, f.office.organization)
	noticeRun := f.startNoticeRun(t, "2030-09-01", "2030-09-24")
	notice := f.releaseNoticeRun(t, f.noticeRun(t, int64(noticeRun.ID))).Notices[0]

	// Mia leaves her school on the 30.09. and starts at the next one on the
	// 01.10., for the same family.
	ctx := context.Background()
	moved := careContract(t, f.db, f.office.organization, next, "Mia", "2030-10-01", sjrServices()...)
	sameFamily(t, f, moved, old)
	_, err := f.db.NewRaw(`UPDATE care_contract.contract_versions SET ends_on = '2030-09-30' WHERE organization_id = ? AND contract_id = ?`,
		f.office.organization, old).Exec(ctx)
	require.NoError(t, err)
	_, err = f.db.NewRaw(`UPDATE care_contract.contract_versions SET child_birth_date = '2020-02-01'
		WHERE organization_id = ? AND contract_id IN (?, ?)`, f.office.organization, old, moved).Exec(ctx)
	require.NoError(t, err)
	for contract, record := range map[int64]int64{old: old + 7000000, moved: moved + 7000000} {
		_, err = f.db.NewRaw(`UPDATE care_contract.contracts SET student_id = ? WHERE organization_id = ? AND id = ?`,
			record, f.office.organization, contract).Exec(ctx)
		require.NoError(t, err)
	}
	rec := putCarePriceList(t, f.traeger, f.office.token, carePriceList(next, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPost, careRunsPath,
		map[string]any{"billing_month": "2030-10-01", "school_ids": []string{fmt.Sprint(next)}})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(decodeSchoolPortalData[careRunBody](t, rec.Body.Bytes()).ID), ""), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	october := decodeSchoolPortalData[struct {
		careRunBody
		BilledChildren []struct {
			Reason    string `json:"reason"`
			Contracts []struct {
				ContractID wireID `json:"contract_id"`
			} `json:"contracts"`
			Invoices []struct {
				Source     string `json:"source"`
				RunID      wireID `json:"run_id"`
				ContractID wireID `json:"contract_id"`
				SchoolID   wireID `json:"school_id"`
				Number     string `json:"number"`
			} `json:"invoices"`
		} `json:"billed_children"`
		JoinedChildren []struct {
			Contracts []struct {
				ContractID wireID `json:"contract_id"`
			} `json:"contracts"`
		} `json:"joined_children"`
	}](t, rec.Body.Bytes())
	assert.Empty(t, october.Invoices, "the notice of the old school assesses Mia's October")
	require.Len(t, october.BilledChildren, 1)
	held := october.BilledChildren[0]
	assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, held.Reason)
	require.Len(t, held.Contracts, 1)
	assert.Equal(t, moved, int64(held.Contracts[0].ContractID))
	require.Len(t, held.Invoices, 1)
	assert.Equal(t, parentbilling.BilledByNoticeRun, held.Invoices[0].Source)
	assert.Equal(t, notice.Number, held.Invoices[0].Number)
	assert.Equal(t, int64(noticeRun.ID), int64(held.Invoices[0].RunID))
	assert.Equal(t, old, int64(held.Invoices[0].ContractID))
	assert.Equal(t, school, int64(held.Invoices[0].SchoolID))
	require.Len(t, october.JoinedChildren, 1, "the review says that the name joined the two records")
	assert.Len(t, october.JoinedChildren[0].Contracts, 2)
}
