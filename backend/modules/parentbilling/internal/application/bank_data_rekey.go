package application

import (
	"context"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

type BankDataRekeyStore interface {
	RewriteBankData(context.Context, int64, string, int64, int, func(string, []byte, []byte) ([]byte, []byte, error)) (parentbilling.BankDataRekeyResult, error)
}

type BankDataRekey struct {
	store  BankDataRekeyStore
	cipher parentbilling.BankDataRewrapper
}

func NewBankDataRekey(store BankDataRekeyStore, cipher parentbilling.BankDataRewrapper) *BankDataRekey {
	if store == nil || cipher == nil {
		panic("bank data rekey requires store and cipher")
	}
	return &BankDataRekey{store: store, cipher: cipher}
}

// bankDataSources are the tables of sealed bank data a batch rewraps.
var bankDataSources = []string{"mandates", "debits", "consents", "debit_files", "care_invoices", "documents"}

// singleBankDataContexts identify sources with one sealed value.
var singleBankDataContexts = map[string]func(int64, string) []byte{
	"consents":      consentTextContext,
	"debit_files":   debitFileContext,
	"care_invoices": holderContext,
	"documents":     holderContext,
}

func (r *BankDataRekey) Batch(ctx context.Context, organizationID int64, source string, afterID int64, limit int) (parentbilling.BankDataRekeyResult, error) {
	if !slices.Contains(bankDataSources, source) || organizationID <= 0 || afterID < 0 || limit < 1 || limit > 1000 {
		return parentbilling.BankDataRekeyResult{}, errors.New("bank data rekey requires organization, nonnegative cursor and batch size 1..1000")
	}
	if contextFor := singleBankDataContexts[source]; contextFor != nil {
		return r.store.RewriteBankData(ctx, organizationID, source, afterID, limit, func(reference string, sealed, _ []byte) ([]byte, []byte, error) {
			rewrapped, err := r.cipher.Rewrap(sealed, contextFor(organizationID, reference))
			if err != nil {
				return nil, nil, errors.New("bank data rekey: sealed value does not open")
			}
			return rewrapped, nil, nil
		})
	}
	return r.store.RewriteBankData(ctx, organizationID, source, afterID, limit, func(reference string, iban, holder []byte) ([]byte, []byte, error) {
		newIBAN, err := r.cipher.Rewrap(iban, ibanContext(organizationID, reference))
		if err != nil {
			return nil, nil, errors.New("bank data rekey: sealed IBAN does not open")
		}
		newHolder, err := r.cipher.Rewrap(holder, holderContext(organizationID, reference))
		if err != nil {
			return nil, nil, errors.New("bank data rekey: sealed account holder does not open")
		}
		return newIBAN, newHolder, nil
	})
}
