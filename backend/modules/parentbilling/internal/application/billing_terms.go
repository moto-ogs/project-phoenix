package application

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"slices"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Actions of the trail of a family deviation.
const (
	familyBillingRead   = "read"
	familyBillingSave   = "save"
	familyBillingDelete = "delete"
)

// paymentTermsReader reads in one statement what decides the payment and
// the recipient of the invoices of a run: the terms of the Träger, the
// deviations of its families and the due dates of a monthly run
// (careRunID) or of a holiday run (holidayRunID); the other is zero.
type paymentTermsReader interface {
	InvoicePaymentTerms(ctx context.Context, organizationID, careRunID, holidayRunID int64) (
		[]parentbilling.ServiceTerms, []parentbilling.FamilyBilling, parentbilling.RunDueDates, error)
	// InsertFamilyBillingEvents records one action for each deviation, with
	// its contract, in one statement.
	InsertFamilyBillingEvents(ctx context.Context, organizationID, accountID int64, action string, families []parentbilling.FamilyBilling) error
	// InvoiceDebitTerms reads in one statement the creditor of the Träger
	// (nil without one) and the SEPA mandates in force (#4695, ADR 0171).
	InvoiceDebitTerms(ctx context.Context, organizationID int64) (*parentbilling.SEPACreditor, []parentbilling.SEPAMandate, error)
	InsertSEPAMandateEvents(ctx context.Context, organizationID, accountID int64, action, source string, fields []string,
		mandates []parentbilling.SEPAMandate) error
	// ChildDebtorNumbers reads every number of a child of the Träger
	// (#7007).
	ChildDebtorNumbers(ctx context.Context, organizationID int64) ([]parentbilling.ChildDebtorNumber, error)
	// InsertChildDebtorNumberEvents records one action for each number of
	// a child in one statement.
	InsertChildDebtorNumberEvents(ctx context.Context, organizationID, accountID int64, action string,
		numbers []parentbilling.ChildDebtorNumber) error
}

// TermsStore persists the terms, the deviations and the due dates.
type TermsStore interface {
	paymentTermsReader
	ServiceTerms(ctx context.Context, organizationID int64) ([]parentbilling.ServiceTerms, error)
	FamilyBillings(ctx context.Context, organizationID int64) ([]parentbilling.FamilyBilling, error)
	SaveServiceTerms(ctx context.Context, organizationID, accountID int64, terms parentbilling.ServiceTerms) error
	// LockBillingSetting holds one setting of the Abrechnung of the Träger
	// until the transaction ends.
	LockBillingSetting(ctx context.Context, organizationID int64, setting string) error
	// SaveFamilyBilling inserts or replaces the deviation of its family.
	SaveFamilyBilling(ctx context.Context, organizationID, accountID int64, family parentbilling.FamilyBilling) (parentbilling.FamilyBilling, error)
	// DeleteFamilyBilling removes a deviation by its ID or, with id zero, by
	// its family; it answers the deviation it removed, nil for none.
	DeleteFamilyBilling(ctx context.Context, organizationID, id int64, familyEmail string) (*parentbilling.FamilyBilling, error)
	// FamilyBillingOf reads the row of a family, nil without one.
	FamilyBillingOf(ctx context.Context, organizationID int64, familyEmail string) (*parentbilling.FamilyBilling, error)
	// LockFamilyBilling holds the family until the transaction ends, also
	// while it has no row, and reads its row, nil without one.
	LockFamilyBilling(ctx context.Context, organizationID int64, familyEmail string) (*parentbilling.FamilyBilling, error)
	// ReplaceRunDueDates replaces the due dates of a run; the database
	// refuses it for a released run.
	ReplaceRunDueDates(ctx context.Context, organizationID, accountID, careRunID, holidayRunID int64, dates parentbilling.RunDueDates) error
	CareRun(ctx context.Context, organizationID, runID int64, lock bool) (parentbilling.CareRun, error)
	LockBillingRun(ctx context.Context, organizationID, runID int64) (parentbilling.BillingRun, error)
}

// BillingTerms serves parentbilling.BillingTerms. The family of a contract
// comes from the Betreuungsvertrag through the root-bound port.
type BillingTerms struct {
	store     TermsStore
	contracts parentbilling.CareContracts
	formats   parentbilling.DebtorNumberFormats
	// today is the Berlin day a contract still runs on.
	today func() calendar.Date
}

var _ parentbilling.BillingTerms = (*BillingTerms)(nil)

// NewBillingTerms builds the terms; a family's debtor number has the
// format of the Träger (#6675).
func NewBillingTerms(store TermsStore, contracts parentbilling.CareContracts, formats parentbilling.DebtorNumberFormats, today func() calendar.Date) *BillingTerms {
	if store == nil || contracts == nil || formats == nil || today == nil {
		panic("parent billing: the store, the care contracts, the debtor number format and the day clock are required")
	}
	return &BillingTerms{store: store, contracts: contracts, formats: formats, today: today}
}

// ServiceTerms answers the terms of every service, the defaults where the
// Träger set none.
func (t *BillingTerms) ServiceTerms(ctx context.Context, organizationID int64) ([]parentbilling.ServiceTerms, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	stored, err := t.store.ServiceTerms(ctx, organizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the service terms: %w", err)
	}
	return termsList(stored), nil
}

// termsList answers the terms of every service of BillingServices in their
// order, the defaults where the Träger set none.
func termsList(stored []parentbilling.ServiceTerms) []parentbilling.ServiceTerms {
	set := termsSetOf(stored)
	list := make([]parentbilling.ServiceTerms, 0, len(parentbilling.BillingServices))
	for _, service := range parentbilling.BillingServices {
		terms := set.Of(service.Service)
		terms.Version = serviceTermsVersion(terms)
		list = append(list, terms)
	}
	return list
}

// settingServiceTerms names the lock of the service terms.
const settingServiceTerms = "service_terms"

// serviceTermsVersion is the read-state token of the terms of one service
// (ADR 0311): what the form shows, the defaults where the Träger set none.
func serviceTermsVersion(terms parentbilling.ServiceTerms) string {
	return readstate.Fingerprint(struct {
		Service       string `json:"service"`
		PaymentMethod string `json:"payment_method"`
		DueDays       int    `json:"due_days"`
		BundleWith    string `json:"bundle_with"`
		Custom        bool   `json:"custom"`
	}{terms.Service, terms.PaymentMethod, terms.DueDays, terms.BundleWith, terms.Custom})
}

// termsSetOf keys the stored terms of a Träger by service.
func termsSetOf(stored []parentbilling.ServiceTerms) parentbilling.TermsSet {
	set := parentbilling.TermsSet{}
	for _, terms := range stored {
		terms.Custom = true
		set[terms.Service] = terms
	}
	return set
}

// SaveServiceTerms validates and stores the terms of one service as the
// Abrechnung read them: under the lock of the terms, terms changed since
// expectedVersion are refused with readstate.ErrChanged (ADR 0311).
func (t *BillingTerms) SaveServiceTerms(ctx context.Context, reviewer parentbilling.HolidayReviewer, terms parentbilling.ServiceTerms,
	expectedVersion string,
) ([]parentbilling.ServiceTerms, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	normalized, err := normalizeServiceTerms(terms)
	if err != nil {
		return nil, err
	}
	if err := t.store.LockBillingSetting(ctx, reviewer.OrganizationID, settingServiceTerms); err != nil {
		return nil, fmt.Errorf("parent billing: hold the service terms: %w", err)
	}
	before, err := t.store.ServiceTerms(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the service terms: %w", err)
	}
	if err := readstate.Check(expectedVersion, serviceTermsVersion(termsSetOf(before).Of(normalized.Service))); err != nil {
		return nil, err
	}
	if err := t.store.SaveServiceTerms(ctx, reviewer.OrganizationID, reviewer.AccountID, normalized); err != nil {
		return nil, err
	}
	stored, err := t.store.ServiceTerms(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the service terms: %w", err)
	}
	return termsList(stored), nil
}

func normalizeServiceTerms(terms parentbilling.ServiceTerms) (parentbilling.ServiceTerms, error) {
	index := slices.IndexFunc(parentbilling.BillingServices, func(s parentbilling.BillingService) bool { return s.Service == terms.Service })
	if index < 0 {
		return terms, parentbilling.ErrServiceUnknown
	}
	errs := validation.Errors{}
	if !slices.Contains(parentbilling.PaymentMethods, terms.PaymentMethod) {
		errs["payment_method"] = errors.New("must be transfer or direct_debit")
	}
	if terms.DueDays < 0 || terms.DueDays > parentbilling.MaxDueDays {
		errs["due_days"] = fmt.Errorf("must be between 0 and %d", parentbilling.MaxDueDays)
	}
	if terms.BundleWith != "" && !slices.Contains(parentbilling.BillingServices[index].BundleWith, terms.BundleWith) {
		errs["bundle_with"] = errors.New("this service cannot travel on that invoice")
	}
	if len(errs) > 0 {
		return terms, errs
	}
	return parentbilling.ServiceTerms{Service: terms.Service, PaymentMethod: terms.PaymentMethod, DueDays: terms.DueDays,
		BundleWith: terms.BundleWith}, nil
}

// ListFamilyBilling lists the deviations and records the read of each.
func (t *BillingTerms) ListFamilyBilling(ctx context.Context, reviewer parentbilling.HolidayReviewer) ([]parentbilling.FamilyBilling, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	families, err := t.store.FamilyBillings(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, err
	}
	if err := t.store.InsertFamilyBillingEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingRead, families); err != nil {
		return nil, fmt.Errorf("parent billing: record the read of the family billing: %w", err)
	}
	return families, nil
}

// familyOfContract names the party a contract's invoice goes to and the key
// of its family. A contract of another Träger is not among the recipients
// and names no family: ErrFamilyUnknown. Neither is a draft (the root
// leaves it out): it can be discarded, and a deviation set through it would
// go with it.
func (t *BillingTerms) familyOfContract(ctx context.Context, organizationID, contractID int64) (parentbilling.CareRecipient, string, error) {
	if contractID <= 0 {
		return parentbilling.CareRecipient{}, "", parentbilling.ErrFamilyUnknown
	}
	recipients, err := t.contracts.Recipients(ctx, organizationID, []int64{contractID})
	if err != nil {
		return parentbilling.CareRecipient{}, "", fmt.Errorf("parent billing: read the contract party: %w", err)
	}
	recipient, known := recipients[contractID]
	key := parentbilling.ContractFamilyKey(recipient.Email, contractID)
	if !known || key == "" {
		return parentbilling.CareRecipient{}, "", parentbilling.ErrFamilyUnknown
	}
	return recipient, key, nil
}

// FamilyBillingOfContract reads the family of a contract with the deviation
// it has, so the Abrechnung sets it without a run (#7770), and records the
// read of a deviation in its trail. The deviation is the family's: a
// sibling's contract answers the same one.
func (t *BillingTerms) FamilyBillingOfContract(ctx context.Context, reviewer parentbilling.HolidayReviewer, contractID int64) (parentbilling.ContractFamilyBilling, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.ContractFamilyBilling{}, err
	}
	recipient, key, err := t.familyOfContract(ctx, reviewer.OrganizationID, contractID)
	if err != nil {
		return parentbilling.ContractFamilyBilling{}, err
	}
	stored, err := t.store.FamilyBillingOf(ctx, reviewer.OrganizationID, key)
	if err != nil {
		return parentbilling.ContractFamilyBilling{}, err
	}
	if stored != nil {
		if err := t.store.InsertFamilyBillingEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingRead,
			[]parentbilling.FamilyBilling{*stored}); err != nil {
			return parentbilling.ContractFamilyBilling{}, fmt.Errorf("parent billing: record the read of the family billing: %w", err)
		}
	}
	return parentbilling.ContractFamilyBilling{ContractID: ident.ID(contractID), FamilyEmail: key,
		PartyFirstName: recipient.FirstName, PartyLastName: recipient.LastName, Family: stored, Version: familyBillingVersion(key, stored)}, nil
}

// familyBillingVersion is the read-state token of a family and its row,
// nil without one (ADR 0311). It names the family: a contract whose party
// moved to another family without a deviation reads another token, so a
// save never lands on a family the form did not name. It covers the whole
// row: not every writer moves updated_at (the retention moves the contract
// of a family without it).
func familyBillingVersion(key string, stored *parentbilling.FamilyBilling) string {
	state := struct {
		Key string                       `json:"key"`
		Row *parentbilling.FamilyBilling `json:"row"`
	}{Key: key}
	if stored != nil {
		canonical := *stored
		canonical.UpdatedAt = canonical.UpdatedAt.UTC()
		state.Row = &canonical
	}
	return readstate.Fingerprint(state)
}

// SaveFamilyBilling validates the deviation and stores it for the family of
// the contract. A deviation that deviates in nothing removes the stored one,
// so the family falls back to the registration and the terms; a family the
// holiday care knows keeps its row without the deviation (#6692), so its
// parent and its period stay. The office saves over the deviation it read:
// under the lock of the family, a deviation stored differently since is
// refused with readstate.ErrChanged (ADR 0311).
func (t *BillingTerms) SaveFamilyBilling(ctx context.Context, reviewer parentbilling.HolidayReviewer, input parentbilling.FamilyBillingInput) (*parentbilling.FamilyBilling, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	_, key, err := t.familyOfContract(ctx, reviewer.OrganizationID, input.ContractID)
	if err != nil {
		return nil, err
	}
	stored, err := t.store.LockFamilyBilling(ctx, reviewer.OrganizationID, key)
	if err != nil {
		return nil, err
	}
	format, err := debtorNumberFormatOf(ctx, t.formats, reviewer.OrganizationID)
	if err != nil {
		return nil, err
	}
	// Existing numbers keep their format when only recipient or payment changes.
	if stored != nil && strings.TrimSpace(input.DebtorNumber) == stored.DebtorNumber {
		format = parentbilling.DebtorNumberFormat{}
	}
	family, err := normalizeFamilyBilling(input, format)
	if err != nil {
		return nil, err
	}
	if err := readstate.Check(input.ExpectedVersion, familyBillingVersion(key, stored)); err != nil {
		return nil, err
	}
	binding, err := t.bindingContract(ctx, reviewer.OrganizationID, key, input.ContractID, stored)
	if err != nil {
		return nil, err
	}
	family.FamilyEmail, family.ContractID = key, ident.ID(binding)
	if !deviates(family) && (stored == nil || stored.LastUsedOn == nil) {
		return nil, t.removeFamilyBilling(ctx, reviewer, key)
	}
	saved, err := t.store.SaveFamilyBilling(ctx, reviewer.OrganizationID, reviewer.AccountID, family)
	if err != nil {
		return nil, err
	}
	if err := t.store.InsertFamilyBillingEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingSave,
		[]parentbilling.FamilyBilling{saved}); err != nil {
		return nil, fmt.Errorf("parent billing: record the family billing: %w", err)
	}
	return &saved, nil
}

// familyContract is a contract of a family in force around today.
type familyContract struct {
	id int64
	// from and until are its first and last day within the window read; a
	// contract without an end is clipped to the window's.
	from, until calendar.Date
}

// bindingContract answers the contract the deviation of the family hangs
// on. The row goes when that contract is deleted (#6692), so it is the
// family's contract that runs longest, whichever contract the office saved
// through (#7770).
func (t *BillingTerms) bindingContract(ctx context.Context, organizationID int64, family string, saved int64, stored *parentbilling.FamilyBilling) (int64, error) {
	versions, err := contractVersionsAround(ctx, t.contracts, organizationID, t.today())
	if err != nil {
		return 0, err
	}
	first, until, ids := contractSpans(versions)
	recipients, err := t.contracts.Recipients(ctx, organizationID, ids)
	if err != nil {
		return 0, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	var contracts []familyContract
	for _, id := range ids {
		if parentbilling.ContractFamilyKey(recipients[id].Email, id) == family {
			contracts = append(contracts, familyContract{id: id, from: first[id].From, until: until[id]})
		}
	}
	held := int64(0)
	if stored != nil {
		held = stored.ContractID.Int64()
	}
	return bindingContractOf(contracts, saved, held, t.today()), nil
}

// bindingContractOf picks the contract of the family that runs today and
// ends last; a contract that only starts later does not count, it can
// still be withdrawn. Among contracts ending on the same day (two without
// an end look alike) the one saved through wins, then the one the
// deviation hangs on. Without a running contract, a contract saved through
// that is signed and starts later takes it; else the deviation stays on
// the contract it hangs on, and a new one takes the contract saved
// through: nothing tells an old contract from one that is only sent.
func bindingContractOf(contracts []familyContract, saved, held int64, today calendar.Date) int64 {
	if running := longestRunning(contracts, saved, held, today); running != 0 {
		return running
	}
	startsLater := slices.ContainsFunc(contracts, func(contract familyContract) bool {
		return contract.id == saved && contract.from.After(today)
	})
	if held != 0 && !startsLater {
		return held
	}
	return saved
}

// longestRunning answers the contract that runs on the day and ends last,
// 0 for none; among equal ends saved wins, then held, then the first.
func longestRunning(contracts []familyContract, saved, held int64, today calendar.Date) int64 {
	var last calendar.Date
	for _, contract := range contracts {
		if contract.runsOn(today) && contract.until.After(last) {
			last = contract.until
		}
	}
	best := int64(0)
	for _, contract := range contracts {
		if !contract.runsOn(today) || contract.until != last {
			continue
		}
		if contract.id == saved {
			return saved
		}
		if best == 0 || contract.id == held {
			best = contract.id
		}
	}
	return best
}

// runsOn tells whether the contract has started and has not ended.
func (c familyContract) runsOn(day calendar.Date) bool {
	return !c.from.After(day) && !c.until.Before(day)
}

// removeFamilyBilling removes the row of a family that deviates in nothing
// and records the removal in its trail.
func (t *BillingTerms) removeFamilyBilling(ctx context.Context, reviewer parentbilling.HolidayReviewer, key string) error {
	removed, err := t.store.DeleteFamilyBilling(ctx, reviewer.OrganizationID, 0, key)
	if err != nil || removed == nil {
		return err
	}
	if err := t.store.InsertFamilyBillingEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingDelete,
		[]parentbilling.FamilyBilling{*removed}); err != nil {
		return fmt.Errorf("parent billing: record the family billing: %w", err)
	}
	return nil
}

// deviates tells whether a deviation changes anything.
func deviates(family parentbilling.FamilyBilling) bool {
	return family.RecipientKind != parentbilling.RecipientApplicant || family.PaymentMethod != "" || family.DueDay != nil ||
		family.DebtorNumber != ""
}

var postalCodePattern = regexp.MustCompile(`^[0-9]{5}$`)

// normalizeFamilyBilling trims the input and checks that a kind brings the
// names it needs: both parents a second name, another payer a name, a mail
// address and a postal address.
func normalizeFamilyBilling(input parentbilling.FamilyBillingInput, format parentbilling.DebtorNumberFormat) (parentbilling.FamilyBilling, error) {
	family := parentbilling.FamilyBilling{RecipientKind: input.RecipientKind, PaymentMethod: input.PaymentMethod, DueDay: input.DueDay}
	errs := validation.Errors{}
	number, err := parentbilling.NormalizeDebtorNumber(input.DebtorNumber, format)
	if err != nil {
		errs["debtor_number"] = err
	}
	family.DebtorNumber = number
	switch input.RecipientKind {
	case parentbilling.RecipientApplicant:
	case parentbilling.RecipientBoth:
		family.SecondFirstName, family.SecondLastName = strings.TrimSpace(input.SecondFirstName), strings.TrimSpace(input.SecondLastName)
		requireName(errs, "second_first_name", family.SecondFirstName)
		requireName(errs, "second_last_name", family.SecondLastName)
	case parentbilling.RecipientPayer:
		family.PayerFirstName, family.PayerLastName = strings.TrimSpace(input.PayerFirstName), strings.TrimSpace(input.PayerLastName)
		family.PayerEmail = strings.TrimSpace(input.PayerEmail)
		requireName(errs, "payer_first_name", family.PayerFirstName)
		requireName(errs, "payer_last_name", family.PayerLastName)
		if address, err := mail.ParseAddress(family.PayerEmail); err != nil || address.Address != family.PayerEmail || len(family.PayerEmail) > 320 {
			errs["payer_email"] = errors.New("must be a valid e-mail address")
		}
		family.PayerAddress = normalizeAddress(errs, "payer_address", input.PayerAddress)
	default:
		errs["recipient_kind"] = errors.New("must be applicant, both or payer")
	}
	if family.PaymentMethod != "" && !slices.Contains(parentbilling.PaymentMethods, family.PaymentMethod) {
		errs["payment_method"] = errors.New("must be transfer or direct_debit")
	}
	if family.DueDay != nil && (*family.DueDay < 1 || *family.DueDay > parentbilling.MaxDueDay) {
		errs["due_day"] = fmt.Errorf("must be between 1 and %d", parentbilling.MaxDueDay)
	}
	if len(errs) > 0 {
		return family, errs
	}
	return family, nil
}

func requireName(errs validation.Errors, field, value string) {
	switch {
	case value == "":
		errs[field] = errors.New("is required")
	case len([]rune(value)) > parentbilling.MaxBillingNameLength:
		errs[field] = fmt.Errorf("must be at most %d characters", parentbilling.MaxBillingNameLength)
	}
}

// normalizeAddress trims a postal address and checks it under the field
// name of the request.
func normalizeAddress(errs validation.Errors, field string, address *parentbilling.PostalAddress) *parentbilling.PostalAddress {
	if address == nil {
		errs[field] = errors.New("is required")
		return nil
	}
	normalized := &parentbilling.PostalAddress{Street: strings.TrimSpace(address.Street), PostalCode: strings.TrimSpace(address.PostalCode),
		City: strings.TrimSpace(address.City)}
	if normalized.Street == "" || len([]rune(normalized.Street)) > 100 {
		errs[field+".street"] = errors.New("is required, at most 100 characters")
	}
	if !postalCodePattern.MatchString(normalized.PostalCode) {
		errs[field+".postal_code"] = errors.New("must be five digits")
	}
	if normalized.City == "" || len([]rune(normalized.City)) > 100 {
		errs[field+".city"] = errors.New("is required, at most 100 characters")
	}
	return normalized
}

// invoicePayments is what decides the payment and the recipient of the
// invoices of one run.
type invoicePayments struct {
	terms    parentbilling.TermsSet
	run      parentbilling.RunDueDates
	families map[string]*parentbilling.FamilyBilling
	// used are the deviations the invoices took, by ID, for the trail.
	used map[int64]parentbilling.FamilyBilling
	// creditor and mandates decide a direct debit (#4695, ADR 0171); the
	// mandates are those in force, by family. usedMandates are the ones
	// the invoices took, by ID, for the trail.
	creditor     parentbilling.SEPACreditor
	mandates     map[string]*parentbilling.SEPAMandate
	usedMandates map[int64]parentbilling.SEPAMandate
	// children are the numbers of the children by ChildDebtorNumberKey when
	// the Träger keeps one per child (#7007), nil when it keeps one per
	// payer; usedChildren are the ones the invoices took, by ID, for the
	// trail. contractChildren is the ChildKey of the child of each contract
	// the monthly invoices bill.
	children         map[string]*parentbilling.ChildDebtorNumber
	usedChildren     map[int64]parentbilling.ChildDebtorNumber
	contractChildren map[int64]string
	// Loading child numbers for preserved holiday invoices must not change
	// the fallback of whole-registration invoices in a payer-scope run.
	payerNumbers bool
}

// perChild tells whether the invoices take the number of the child.
func (p invoicePayments) perChild() bool { return p.children != nil && !p.payerNumbers }

// childNumber answers the number of a child of a family and notes its
// read; empty without one.
func (p invoicePayments) childNumber(familyEmail, childKey string) string {
	if childKey == "" {
		return ""
	}
	number := p.children[parentbilling.ChildDebtorNumberKey(familyEmail, childKey)]
	if number == nil {
		return ""
	}
	p.usedChildren[number.ID] = *number
	return number.DebtorNumber
}

// childNumbersRead are the numbers of children the invoices took.
func (p invoicePayments) childNumbersRead() []parentbilling.ChildDebtorNumber {
	read := make([]parentbilling.ChildDebtorNumber, 0, len(p.usedChildren))
	for _, number := range p.usedChildren {
		read = append(read, number)
	}
	slices.SortFunc(read, func(a, b parentbilling.ChildDebtorNumber) int { return compareOrdered(a.ID, b.ID) })
	return read
}

// recordChildNumberReads records in the trail of each number of a child
// that a run showed it to the account (#7007).
func recordChildNumberReads(ctx context.Context, store paymentTermsReader, reviewer parentbilling.HolidayReviewer,
	numbers []parentbilling.ChildDebtorNumber,
) error {
	if err := store.InsertChildDebtorNumberEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingRead, numbers); err != nil {
		return fmt.Errorf("parent billing: record the read of the children's debtor numbers: %w", err)
	}
	return nil
}

// contractChildKeys is the ChildKey of the child of each contract of the
// versions, from its first version.
func contractChildKeys(versions []parentbilling.CareContractVersion) map[int64]string {
	keys := make(map[int64]string, len(versions))
	for _, version := range versions {
		if _, seen := keys[version.ContractID]; !seen {
			keys[version.ContractID] = parentbilling.ChildKey(version.ChildFirstName, version.ChildLastName, version.ChildBirthDate)
		}
	}
	return keys
}

// mandatesRead are the mandates the invoices took.
func (p invoicePayments) mandatesRead() []parentbilling.SEPAMandate {
	read := make([]parentbilling.SEPAMandate, 0, len(p.usedMandates))
	for _, mandate := range p.usedMandates {
		read = append(read, mandate)
	}
	slices.SortFunc(read, func(a, b parentbilling.SEPAMandate) int { return compareOrdered(a.ID, b.ID) })
	return read
}

// debit completes a payment by direct debit with the family's mandate and
// notes its read (ResolveDebit).
func (p invoicePayments) debit(payment parentbilling.InvoicePayment, terms parentbilling.ServiceTerms, family *parentbilling.FamilyBilling,
	familyEmail string, issuedOn calendar.Date,
) parentbilling.InvoicePayment {
	if payment.Method != parentbilling.PaymentDirectDebit {
		return payment
	}
	mandate := p.mandates[familyEmail]
	if mandate != nil {
		p.usedMandates[mandate.ID.Int64()] = *mandate
	}
	return parentbilling.ResolveDebit(payment, terms, p.run, family, issuedOn, p.creditor, mandate)
}

// recordMandateReads records in the trail of each mandate that a run
// showed its mask to the account (#4695).
func recordMandateReads(ctx context.Context, store paymentTermsReader, reviewer parentbilling.HolidayReviewer, mandates []parentbilling.SEPAMandate) error {
	if err := store.InsertSEPAMandateEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, mandateRead, mandateFromRun, nil, mandates); err != nil {
		return fmt.Errorf("parent billing: record the read of the SEPA mandates: %w", err)
	}
	return nil
}

// debitBlocked tells whether an invoice stays a direct debit without a
// mandate, which the release refuses (MissingMandateBlock). An invoice of
// 0 € collects nothing and never blocks.
func debitBlocked(totalCents int64, payment *parentbilling.InvoicePayment) bool {
	return totalCents > 0 && payment != nil && payment.Method == parentbilling.PaymentDirectDebit && payment.DebitGap != ""
}

// deviationsRead are the deviations the invoices took.
func (p invoicePayments) deviationsRead() []parentbilling.FamilyBilling {
	read := make([]parentbilling.FamilyBilling, 0, len(p.used))
	for _, family := range p.used {
		read = append(read, family)
	}
	slices.SortFunc(read, func(a, b parentbilling.FamilyBilling) int { return compareOrdered(a.ID, b.ID) })
	return read
}

// family answers the deviation of a family and notes its read.
func (p invoicePayments) family(key string) *parentbilling.FamilyBilling {
	family := p.families[key]
	if family != nil {
		p.used[family.ID.Int64()] = *family
	}
	return family
}

// recordDeviationReads records in the trail of each deviation that a run
// showed it to the account (#4689, ADR 0167).
func recordDeviationReads(ctx context.Context, store paymentTermsReader, reviewer parentbilling.HolidayReviewer, families []parentbilling.FamilyBilling) error {
	if err := store.InsertFamilyBillingEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingRead, families); err != nil {
		return fmt.Errorf("parent billing: record the read of the family billing: %w", err)
	}
	return nil
}

// debtorNumberScopeOf reads whom the Träger's debtor numbers name (#7007).
func debtorNumberScopeOf(ctx context.Context, scopes parentbilling.DebtorNumberScopes, organizationID int64) (string, error) {
	scope, err := scopes.DebtorNumberScope(ctx, organizationID)
	if err != nil {
		return "", fmt.Errorf("parent billing: read whom the debtor numbers name: %w", err)
	}
	return scope, nil
}

// readInvoicePayments reads the terms, the deviations and the dates of a
// run, and the numbers of the children when the Träger keeps the number
// per child (scope, #7007) or a preserved holiday invoice still bills a child.
func readInvoicePayments(ctx context.Context, store paymentTermsReader, organizationID, careRunID, holidayRunID int64, scope string, childInvoices bool) (invoicePayments, error) {
	stored, families, dates, err := store.InvoicePaymentTerms(ctx, organizationID, careRunID, holidayRunID)
	if err != nil {
		return invoicePayments{}, fmt.Errorf("parent billing: read the payment terms: %w", err)
	}
	if dates == nil {
		dates = parentbilling.RunDueDates{}
	}
	byFamily := make(map[string]*parentbilling.FamilyBilling, len(families))
	for i := range families {
		byFamily[families[i].FamilyEmail] = &families[i]
	}
	creditor, mandates, err := store.InvoiceDebitTerms(ctx, organizationID)
	if err != nil {
		return invoicePayments{}, fmt.Errorf("parent billing: read the SEPA mandates: %w", err)
	}
	payments := invoicePayments{payerNumbers: scope == parentbilling.DebtorNumberScopePayer, terms: termsSetOf(stored), run: dates, families: byFamily, used: map[int64]parentbilling.FamilyBilling{},
		creditor: parentbilling.DefaultSEPACreditor(), mandates: make(map[string]*parentbilling.SEPAMandate, len(mandates)),
		usedMandates: map[int64]parentbilling.SEPAMandate{}}
	if creditor != nil {
		payments.creditor = *creditor
	}
	for i := range mandates {
		payments.mandates[mandates[i].FamilyEmail] = &mandates[i]
	}
	if scope == parentbilling.DebtorNumberScopeChild || childInvoices {
		children, err := store.ChildDebtorNumbers(ctx, organizationID)
		if err != nil {
			return invoicePayments{}, err
		}
		payments.children = make(map[string]*parentbilling.ChildDebtorNumber, len(children))
		payments.usedChildren = map[int64]parentbilling.ChildDebtorNumber{}
		for i := range children {
			// A child whose number was removed has none (#7007).
			if children[i].DebtorNumber != "" {
				payments.children[children[i].Key()] = &children[i]
			}
		}
	}
	return payments, nil
}

// careInvoice sets the recipient and the payment of a monthly invoice.
// The invoice carries the care and every service bundled with it, or the
// Mensa on an invoice of its own with the Mensa's terms (#4686).
func (p invoicePayments) careInvoice(invoice *parentbilling.CareInvoice, issuedOn calendar.Date) {
	family := p.family(invoice.FamilyEmail)
	recipient := parentbilling.ResolveRecipient(parentbilling.BillingRecipient{FirstName: invoice.Recipient.FirstName,
		LastName: invoice.Recipient.LastName, Email: invoice.Recipient.Email}, family)
	invoice.Recipient = parentbilling.CareRecipient{FirstName: recipient.FirstName, LastName: recipient.LastName,
		Email: recipient.Email, Kind: recipient.Kind, SecondName: recipient.SecondName, Address: recipient.Address}
	switch {
	case p.perChild():
		invoice.DebtorNumber = p.childNumber(invoice.FamilyEmail, p.contractChildren[invoice.ContractID.Int64()])
	case family != nil:
		invoice.DebtorNumber = family.DebtorNumber
	}
	service := invoice.Service
	if service == "" {
		service = parentbilling.ServiceCare
	}
	terms := p.terms.Of(service)
	payment := p.debit(parentbilling.ResolvePayment(terms, p.run, family, issuedOn), terms, family, invoice.FamilyEmail, issuedOn)
	invoice.Payment = &payment
}

// holidayDocument sets the recipient, the debtor number and the payment of
// a holiday invoice; the registration's address stays for both parents.
// The registration's debtor number wins; without one the invoice takes the
// family's, as the monthly invoice does (#6677), or, when the Träger keeps
// the number per child (#7007), the number of its child: an invoice per
// child bills one, and only an invoice of a whole registration issued
// before the switch bills several and takes its first child's. Every later
// reader (letter, overview for the Kämmerei, Sollstellung, DATEV) reads the
// copy the release stores, so this is the one place that falls back.
func (p invoicePayments) holidayDocument(document *parentbilling.BillingDocument, issuedOn calendar.Date) {
	document.FamilyEmail = parentbilling.FamilyKey(document.RecipientEmail)
	family := p.family(document.FamilyEmail)
	switch {
	case document.DebtorNumber != "":
	case document.RegistrationChildID != 0 || p.perChild():
		if len(document.Children) > 0 {
			child := document.Children[0]
			document.DebtorNumber = p.childNumber(document.FamilyEmail, parentbilling.ChildKey(child.FirstName, child.LastName, &child.BirthDate))
		}
	case family != nil:
		document.DebtorNumber = family.DebtorNumber
	}
	recipient := parentbilling.ResolveRecipient(parentbilling.BillingRecipient{FirstName: document.RecipientFirstName,
		LastName: document.RecipientLastName, Email: document.RecipientEmail, Address: document.RecipientAddress}, family)
	document.RecipientFirstName, document.RecipientLastName, document.RecipientEmail = recipient.FirstName, recipient.LastName, recipient.Email
	document.RecipientAddress, document.RecipientKind, document.RecipientSecondName = recipient.Address, recipient.Kind, recipient.SecondName
	terms := p.terms.Of(parentbilling.ServiceHoliday)
	payment := p.debit(parentbilling.ResolvePayment(terms, p.run, family, issuedOn), terms, family, document.FamilyEmail, issuedOn)
	document.Payment = &payment
}
