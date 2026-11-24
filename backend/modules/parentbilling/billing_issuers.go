package parentbilling

import (
	"context"
	"sort"
)

// The Rechnungssteller of a document (#8040, ADR 0321). Who bills the
// parents of a school is the setting responsibility.billing (ADR 0318): the
// Träger, or the school's Schulträger or Gemeinde once its master data,
// creditor identifier and bank account are stored. An issuer is named by its
// key, the SEPA creditor identifier of the body, empty for the Träger: the
// schools whose body has the same creditor identifier share one number
// range, one mandate per family and one debit file. The release copies the
// issuer onto every document, so a later change never changes an issued one.

// Bodies that issue a document.
const (
	IssuerTraeger      = "traeger"
	IssuerSchultraeger = "schultraeger"
	IssuerGemeinde     = "gemeinde"
)

// BillingIssuer is the issuer of a document. The Träger has the empty Key
// and no further data here: its letterhead and creditor are its own. A body
// carries what its documents print: sender, contact, bank account and its
// creditor identifier, which is its Key. Only who it is goes on the wire; the
// release keeps the rest with the document.
type BillingIssuer struct {
	Key          string                 `json:"key"`
	Body         string                 `json:"body"`
	Name         string                 `json:"name"`
	SenderText   string                 `json:"-"`
	ContactName  string                 `json:"-"`
	ContactPhone string                 `json:"-"`
	ContactEmail string                 `json:"-"`
	CreditorID   string                 `json:"-"`
	BankAccount  *LetterheadBankAccount `json:"-"`
}

// TraegerIssuer is the Träger as issuer.
func TraegerIssuer() BillingIssuer { return BillingIssuer{Body: IssuerTraeger} }

// IsTraeger tells whether the Träger issues.
func (i BillingIssuer) IsTraeger() bool { return i.Key == "" }

// IssuerKeyOf is the key of a document's issuer: empty for the Träger.
func IssuerKeyOf(issuer *BillingIssuer) string {
	if issuer == nil {
		return ""
	}
	return issuer.Key
}

// IssuerOf answers the issuer of a school as a document carries it: the body
// in issuers, nil for the Träger.
func IssuerOf(issuers map[int64]BillingIssuer, schoolID int64) *BillingIssuer {
	if issuer, ok := issuers[schoolID]; ok && !issuer.IsTraeger() {
		return &issuer
	}
	return nil
}

// DistinctIssuers lists every issuer once, the Träger first, then the
// bodies by name and key.
func DistinctIssuers(issuers map[int64]BillingIssuer) []BillingIssuer {
	seen := map[string]bool{"": true}
	list := []BillingIssuer{TraegerIssuer()}
	for _, issuer := range issuers {
		if seen[issuer.Key] {
			continue
		}
		seen[issuer.Key] = true
		list = append(list, issuer)
	}
	sort.SliceStable(list[1:], func(a, b int) bool {
		x, y := list[1+a], list[1+b]
		if x.Name != y.Name {
			return x.Name < y.Name
		}
		return x.Key < y.Key
	})
	return list
}

// BillingIssuers names the issuer of the schools of a Träger. The root binds
// it to the responsibilities of Organisation & Tenancy (ADR 0318 §4); it
// runs in the caller's Träger transaction and serves a document, not a
// person, so it logs no read.
type BillingIssuers interface {
	// SchoolBillingIssuers answers per school the body that bills its
	// parents in effect. A school the Träger bills for has no entry, and
	// neither has a school of another Träger. Nil schoolIDs asks for every
	// school of the Träger.
	SchoolBillingIssuers(ctx context.Context, organizationID int64, schoolIDs []int64) (map[int64]BillingIssuer, error)
}
