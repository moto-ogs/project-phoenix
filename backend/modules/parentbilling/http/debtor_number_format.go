package parentbillinghttp

import (
	"errors"
	"net/http"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// renderDebtorNumberFormat answers a debtor number in another format than
// the Träger's (#6675) as a field error on debtor_number with the format in
// its details, so the text can name it: "5 Ziffern, zum Beispiel 20815".
// It reports whether err was such a refusal.
func renderDebtorNumberFormat(w http.ResponseWriter, r *http.Request, err error) bool {
	fields, ok := errors.AsType[validation.Errors](err)
	if !ok {
		return false
	}
	refusal, ok := errors.AsType[*capability.DebtorNumberFormatError](fields["debtor_number"])
	if !ok {
		return false
	}
	format := refusal.Format
	code := common.CodeParentBillingDebtorNumberDigitRange
	var details any = DebtorNumberDigitRangeDetails{MinDigits: format.MinDigits, MaxDigits: format.MaxDigits, Example: format.Example()}
	if format.MinDigits == format.MaxDigits {
		code, details = common.CodeParentBillingDebtorNumberDigits, DebtorNumberDigitsDetails{Digits: format.MinDigits, Example: format.Example()}
	}
	// The field errors stay with the code; the format travels in details.
	refused := common.ErrorInvalidRequestWithCode(err, code)
	if response, ok := refused.(*common.ErrResponse); ok {
		response.Details = details
	}
	common.RenderError(w, r, refused)
	return true
}

// renderDebtorNumberRefusal answers a refused debtor number of a holiday
// registration: another format (#6675) or a number that differs from the
// family's, named with the family (#6692). It reports whether err was one.
func renderDebtorNumberRefusal(w http.ResponseWriter, r *http.Request, err error) bool {
	if renderDebtorNumberFormat(w, r, err) {
		return true
	}
	conflict, ok := errors.AsType[*capability.FamilyDebtorNumberConflict](err)
	if !ok {
		return false
	}
	details := FamilyDebtorNumberDetails{
		FamilyDebtorNumber: conflict.FamilyDebtorNumber, DebtorNumber: conflict.DebtorNumber,
		FamilyEmail: conflict.FamilyEmail,
	}
	if len(conflict.Families) > 1 {
		details.Families = make([]FamilyDebtorNumberEntry, len(conflict.Families))
		for i, family := range conflict.Families {
			details.Families[i] = FamilyDebtorNumberEntry{FamilyEmail: family.FamilyEmail, FamilyDebtorNumber: family.DebtorNumber}
		}
	}
	common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeParentBillingFamilyDebtorNumberConflict, details))
	return true
}

type DebtorNumberDigitRangeDetails struct {
	MinDigits int    `json:"min_digits"`
	MaxDigits int    `json:"max_digits"`
	Example   string `json:"example"`
}

type DebtorNumberDigitsDetails struct {
	Digits  int    `json:"digits"`
	Example string `json:"example"`
}

type FamilyDebtorNumberEntry struct {
	FamilyEmail        string `json:"family_email"`
	FamilyDebtorNumber string `json:"family_debtor_number"`
}

type FamilyDebtorNumberDetails struct {
	FamilyDebtorNumberEntry
	DebtorNumber string                    `json:"debtor_number"`
	Families     []FamilyDebtorNumberEntry `json:"families,omitempty"`
}
