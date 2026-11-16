package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// RequiredDetailStore reads the creditor and the number ranges of a Träger.
type RequiredDetailStore interface {
	SEPACreditor(ctx context.Context, organizationID int64) (*parentbilling.SEPACreditor, error)
	numberRangeReader
}

// RequiredDetails checks the details of a Träger its booked modules need
// (#7177).
type RequiredDetails struct {
	store   RequiredDetailStore
	sources parentbilling.RequiredDetailSources
}

var _ parentbilling.RequiredDetailsCheck = (*RequiredDetails)(nil)

// NewRequiredDetails builds the check over the store and the root-bound
// sources.
func NewRequiredDetails(store RequiredDetailStore, sources parentbilling.RequiredDetailSources) *RequiredDetails {
	if store == nil || sources.Schools == nil || sources.Modules == nil || sources.Sender == nil || sources.Accounts == nil {
		panic("parent billing: the required details need the store and their sources")
	}
	return &RequiredDetails{store: store, sources: sources}
}

// RequiredDetails reads only what a booked module needs.
func (r *RequiredDetails) RequiredDetails(ctx context.Context, organizationID int64) (parentbilling.RequiredDetails, error) {
	result := requiredDetails{}
	if organizationID <= 0 {
		return result.done(), errTraegerRequired
	}
	modules, err := r.modules(ctx, organizationID)
	if err != nil {
		return result.done(), err
	}
	billing := modules.CareBilling || modules.HolidayCare
	if !billing && !modules.Contracts {
		return result.done(), nil
	}
	sender, err := r.sources.Sender.SenderText(ctx, organizationID)
	if err != nil {
		return result.done(), fmt.Errorf("parent billing: read letterhead: %w", err)
	}
	result.add(parentbilling.RequiredLetterhead, missingSender(parentbilling.Letterhead{SenderText: sender}))
	if !billing {
		return result.done(), nil
	}
	hasAccount, err := r.sources.Accounts.HasBankAccount(ctx, organizationID)
	if err != nil {
		return result.done(), fmt.Errorf("parent billing: read bank account: %w", err)
	}
	result.add(parentbilling.RequiredBankAccount, !hasAccount)
	if modules.CareBilling {
		creditor, err := r.store.SEPACreditor(ctx, organizationID)
		if err != nil {
			return result.done(), fmt.Errorf("parent billing: read creditor: %w", err)
		}
		result.add(parentbilling.RequiredSEPACreditor, creditor == nil || creditor.CreditorID == "")
	}
	ranges, err := r.store.ListNumberRanges(ctx, organizationID)
	if err != nil {
		return result.done(), fmt.Errorf("parent billing: read number ranges: %w", err)
	}
	result.add(parentbilling.RequiredNumberRangeHoliday, modules.HolidayCare && !hasPattern(ranges, parentbilling.ServiceHoliday))
	result.add(parentbilling.RequiredNumberRangeCare, modules.CareBilling && !hasPattern(ranges, parentbilling.ServiceCare))
	return result.done(), nil
}

// modules reads which modules the schools of the Träger book; a Träger
// without a school books none.
func (r *RequiredDetails) modules(ctx context.Context, organizationID int64) (parentbilling.TraegerModules, error) {
	schools, err := r.sources.Schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return parentbilling.TraegerModules{}, fmt.Errorf("parent billing: read schools: %w", err)
	}
	if len(schools) == 0 {
		return parentbilling.TraegerModules{}, nil
	}
	ids := make([]int64, len(schools))
	for i, school := range schools {
		ids[i] = school.ID
	}
	modules, err := r.sources.Modules.BookedModules(ctx, ids)
	if err != nil {
		return parentbilling.TraegerModules{}, fmt.Errorf("parent billing: read booked modules: %w", err)
	}
	return modules, nil
}

// requiredDetails collects the missing details in the order they are
// checked.
type requiredDetails []parentbilling.RequiredDetail

func (r *requiredDetails) add(detail parentbilling.RequiredDetail, missing bool) {
	if missing {
		*r = append(*r, detail)
	}
}

func (r requiredDetails) done() parentbilling.RequiredDetails {
	return parentbilling.RequiredDetails{Missing: append([]parentbilling.RequiredDetail{}, r...)}
}

func hasPattern(ranges []parentbilling.NumberRange, service string) bool {
	_, ok := patternOf(ranges, service)
	return ok
}
