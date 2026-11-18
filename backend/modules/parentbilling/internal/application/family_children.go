package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// FamilyChildrenStore persists the numbers of the families of a Träger and
// their trail in its Träger transaction (#5918).
type FamilyChildrenStore interface {
	FamilyChildCounts(ctx context.Context, organizationID int64) ([]parentbilling.FamilyChildCount, error)
	FamilyChildCount(ctx context.Context, organizationID int64, family string) (parentbilling.FamilyChildCount, bool, error)
	// StateFamilyChildren and ConfirmFamilyChildren report a contract that
	// is no contract of the Träger as ErrFamilyChildrenNotFound.
	// A statement made before the family's newest one changes nothing:
	// applied is false.
	StateFamilyChildren(ctx context.Context, organizationID, accountID int64, family string, contractID int64, children int,
		statedAt *time.Time) (id int64, applied bool, err error)
	ConfirmFamilyChildren(ctx context.Context, organizationID, accountID int64, family string, input parentbilling.FamilyChildrenInput) (int64, error)
	DeleteFamilyChildren(ctx context.Context, organizationID int64, families []string) ([]parentbilling.FamilyChildTarget, error)
	InsertFamilyChildEvents(ctx context.Context, organizationID int64, event parentbilling.FamilyChildEvent, targets []parentbilling.FamilyChildTarget) error
	// ConfirmImportedFamilyChildren stores the numbers a file names as
	// confirmed, each family once, and records each in its trail (#7356).
	ConfirmImportedFamilyChildren(ctx context.Context, organizationID, accountID int64, numbers []parentbilling.ImportedFamilyChildren) error
	ListContributionRules(ctx context.Context, organizationID int64, service string) ([]parentbilling.ContributionRule, error)
	// LockCareBilling holds the monthly billing of the Träger until the
	// transaction ends, so a release counts a family before or after a
	// change, never in between.
	LockCareBilling(ctx context.Context, organizationID int64) error
}

// FamilyNumbers serves the Abrechnung's check of the numbers and the
// parents' statement.
type FamilyNumbers struct {
	store     FamilyChildrenStore
	contracts parentbilling.CareContracts
	today     func() calendar.Date
}

var (
	_ parentbilling.FamilyChildrenOffice          = (*FamilyNumbers)(nil)
	_ parentbilling.ParentFamilyChildrenStatement = (*FamilyNumbers)(nil)
	_ parentbilling.ContractFamilyChildren        = (*FamilyNumbers)(nil)
	_ parentbilling.ContractImportFamilyChildren  = (*FamilyNumbers)(nil)
)

// NewFamilyChildren builds the numbers of the families.
func NewFamilyChildren(store FamilyChildrenStore, contracts parentbilling.CareContracts, today func() calendar.Date) *FamilyNumbers {
	if store == nil || contracts == nil || today == nil {
		panic("parent billing: the store, the care contracts and the clock are required")
	}
	return &FamilyNumbers{store: store, contracts: contracts, today: today}
}

// NewParentFamilyChildren builds the parents' statement alone; it reads no
// contract, because the parents portal checked the reader's contract, and
// no clock: only the office's list reads the day, and it refuses to run
// without the contracts.
func NewParentFamilyChildren(store FamilyChildrenStore) *FamilyNumbers {
	if store == nil {
		panic("parent billing: the store is required")
	}
	return &FamilyNumbers{store: store}
}

// errOfficeNotConfigured reports the parents' build asked for the office.
var errOfficeNotConfigured = errors.New("parent billing: the family children office needs the care contracts")

// familyKey is the key of a family, the same as the rule chain uses (#4689).
func familyKey(email string) string { return parentbilling.FamilyKey(email) }

// FamilyChildren lists every family with a contract in force in the window
// of the evidence page, its children with a contract and its number, and
// records the read of every number it shows.
func (f *FamilyNumbers) FamilyChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer) (parentbilling.FamilyChildrenSet, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	if f.contracts == nil {
		return parentbilling.FamilyChildrenSet{}, errOfficeNotConfigured
	}
	today := f.today()
	versions, err := f.contracts.VersionsInForce(ctx, reviewer.OrganizationID, today.AddDays(-evidenceLookBack), today.AddDays(evidenceLookAhead))
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: read the contract versions: %w", err)
	}
	counts, err := f.store.FamilyChildCounts(ctx, reviewer.OrganizationID)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	// The recipients of the contracts in force and of the contracts a number
	// hangs on: a family that stated its number on a contract not yet in
	// force still needs the check of the Abrechnung.
	contracts := evidenceContracts(versions)
	ids := make([]int64, 0, len(contracts))
	for _, contract := range contracts {
		ids = append(ids, contract.ContractID)
	}
	recipients, err := f.contracts.Recipients(ctx, reviewer.OrganizationID, familyRecipientContracts(ids, counts))
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	families := groupFamilies(versions, recipients, counts, today)
	if err := f.recordFamilyReads(ctx, reviewer, counts); err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	counting, err := f.rulesCountingFamily(ctx, reviewer.OrganizationID)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	return parentbilling.FamilyChildrenSet{Families: families, Rules: counting}, nil
}

// rulesCountingFamily lists the care sibling rules of the Träger that count
// the family's number.
func (f *FamilyNumbers) rulesCountingFamily(ctx context.Context, organizationID int64) ([]parentbilling.ContributionRule, error) {
	rules, err := f.store.ListContributionRules(ctx, organizationID, parentbilling.ServiceCare)
	if err != nil {
		return nil, fmt.Errorf("parent billing: list care rules: %w", err)
	}
	counting := []parentbilling.ContributionRule{}
	for _, rule := range rules {
		if rule.Kind == parentbilling.RuleSibling && rule.CountsFamilyChildren {
			counting = append(counting, rule)
		}
	}
	return counting, nil
}

// groupFamilies groups the contracts by their family: the address of their
// invoice's recipient, and for a contract without one the contract itself
// (#7356, ADR 0232 point 7). Each family shows the number that belongs to
// it today (numbersByFamily).
func groupFamilies(versions []parentbilling.CareContractVersion, recipients map[int64]parentbilling.CareRecipient,
	counts []parentbilling.FamilyChildCount, today calendar.Date,
) []parentbilling.FamilyChildren {
	grouped := familyGroups{recipients: recipients, byKey: map[string]*parentbilling.FamilyChildren{}}
	grouped.addContracts(versions)
	grouped.addNumbers(counts, today)
	families := make([]parentbilling.FamilyChildren, 0, len(grouped.order))
	for _, key := range grouped.order {
		found := grouped.byKey[key]
		if found.Status == "" {
			found.Status = familyChildrenStatus(found.Count, today)
		}
		if found.Differing {
			found.Status = parentbilling.FamilyChildrenDiffering
		}
		families = append(families, *found)
	}
	slices.SortFunc(families, func(a, b parentbilling.FamilyChildren) int {
		return firstNonZero(compareOrdered(familySortName(a), familySortName(b)),
			compareOrdered(a.RecipientFirstName, b.RecipientFirstName), compareOrdered(a.RecipientEmail, b.RecipientEmail),
			compareOrdered(a.ContractID, b.ContractID))
	})
	return families
}

// familyGroups collects the families of the list by their key, in the
// order they come up.
type familyGroups struct {
	recipients map[int64]parentbilling.CareRecipient
	byKey      map[string]*parentbilling.FamilyChildren
	order      []string
}

// family answers the family of a key; a new one is named by the contract
// and shows the recipient of its invoice.
func (g *familyGroups) family(key string, contractID int64) *parentbilling.FamilyChildren {
	if found, ok := g.byKey[key]; ok {
		return found
	}
	recipient := g.recipients[contractID]
	found := &parentbilling.FamilyChildren{ContractID: contractID, RecipientFirstName: recipient.FirstName,
		RecipientLastName: recipient.LastName, RecipientEmail: strings.TrimSpace(recipient.Email),
		Children: []parentbilling.FamilyContractChild{}}
	g.byKey[key] = found
	g.order = append(g.order, key)
	return found
}

// addContracts gives every family its children with a contract, each child
// once.
func (g *familyGroups) addContracts(versions []parentbilling.CareContractVersion) {
	byContract, contractOrder := versionsByContract(versions)
	children := childKeys(byContract, contractOrder)
	seen := map[string]bool{}
	for _, contract := range evidenceContracts(versions) {
		key := parentbilling.ContractFamilyKey(g.recipients[contract.ContractID].Email, contract.ContractID)
		if seen[key+"|"+children[contract.ContractID]] {
			continue
		}
		seen[key+"|"+children[contract.ContractID]] = true
		found := g.family(key, contract.ContractID)
		found.Children = append(found.Children, parentbilling.FamilyContractChild{ContractID: contract.ContractID,
			SchoolName: contract.SchoolName, ChildFirstName: contract.ChildFirstName, ChildLastName: contract.ChildLastName})
	}
}

// addNumbers gives every family the number that belongs to it today. A
// number without a contract in force, for example stated on a sent
// contract, shows its family with the recipient of that contract and no
// child with a contract yet.
func (g *familyGroups) addNumbers(counts []parentbilling.FamilyChildCount, today calendar.Date) {
	numbers, order := numbersByFamily(counts, g.recipients)
	for _, key := range order {
		count, differing := numbers[key].countOn(today)
		if count == nil && !differing {
			continue
		}
		contractID := numbers[key].contractID()
		if count != nil {
			contractID = count.ContractID
		}
		found := g.family(key, contractID)
		if len(found.Children) == 0 && !parentbilling.IsContractFamily(key) {
			found.RecipientEmail = key
		}
		found.Count, found.Differing = count, differing
		found.Status = numbers[key].statusOn(count, today)
	}
}

// familySortName sorts a family by the last name of its invoice's
// recipient, and one without a recipient by its first child.
func familySortName(family parentbilling.FamilyChildren) string {
	if family.RecipientLastName != "" || len(family.Children) == 0 {
		return family.RecipientLastName
	}
	return family.Children[0].ChildLastName
}

// familyChildrenStatus is the state of a number today; the most urgent
// check wins.
func familyChildrenStatus(count *parentbilling.FamilyChildCount, today calendar.Date) string {
	switch {
	case count == nil:
		return parentbilling.FamilyChildrenMissing
	case count.ConfirmedChildren == nil || count.ValidFrom == nil:
		return parentbilling.FamilyChildrenStated
	case count.ValidUntil != nil && count.ValidUntil.Before(today):
		return parentbilling.FamilyChildrenExpired
	case count.StatedChildren != nil && count.StatedAt != nil && count.ConfirmedAt != nil &&
		count.StatedAt.After(*count.ConfirmedAt) && *count.StatedChildren != *count.ConfirmedChildren:
		return parentbilling.FamilyChildrenChanged
	case count.ValidFrom.After(today):
		return laterConfirmationStatus(count, today)
	case count.ValidUntil != nil && !count.ValidUntil.After(today.AddDays(parentbilling.FamilyChildrenExpiryNotice)):
		return parentbilling.FamilyChildrenExpiring
	}
	return parentbilling.FamilyChildrenConfirmed
}

// laterConfirmationStatus is the state of a family whose newest
// confirmation starts after today: the earlier ones in force decide. Has the
// current one ended, the family has a gap now; does a chain of
// confirmations from today leave a first day without one within the notice,
// the family needs a check before it.
func laterConfirmationStatus(count *parentbilling.FamilyChildCount, today calendar.Date) string {
	current, started := count.InForceOn(today)
	switch {
	case !started || current.ValidUntil == nil:
		return parentbilling.FamilyChildrenUpcoming
	case current.ValidUntil.Before(today):
		return parentbilling.FamilyChildrenExpired
	}
	if gap, ok := firstGap(count, today); ok && !gap.After(today.AddDays(parentbilling.FamilyChildrenExpiryNotice+1)) {
		return parentbilling.FamilyChildrenExpiring
	}
	return parentbilling.FamilyChildrenUpcoming
}

// firstGap is the first day from day on without a confirmation in force,
// following one confirmation to the next; none when the chain reaches one
// without an end.
func firstGap(count *parentbilling.FamilyChildCount, day calendar.Date) (calendar.Date, bool) {
	for range len(count.Confirmations) + 2 {
		confirmation, started := count.InForceOn(day)
		if !started || (confirmation.ValidUntil != nil && confirmation.ValidUntil.Before(day)) {
			return day, true
		}
		if confirmation.ValidUntil == nil {
			return "", false
		}
		day = confirmation.ValidUntil.AddDays(1)
	}
	return day, true
}

// recordFamilyReads records every source shown in the family list, including
// a statement combined with another contract's confirmation.
func (f *FamilyNumbers) recordFamilyReads(ctx context.Context, reviewer parentbilling.HolidayReviewer, counts []parentbilling.FamilyChildCount) error {
	var targets []parentbilling.FamilyChildTarget
	for _, count := range counts {
		targets = append(targets, parentbilling.FamilyChildTarget{ContractID: count.ContractID, CountID: &count.ID})
	}
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := f.store.InsertFamilyChildEvents(ctx, reviewer.OrganizationID, event, targets); err != nil {
		return fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	return nil
}

// ConfirmFamilyChildren confirms or changes the number of the family of the
// input's contract under the lock of the monthly billing.
func (f *FamilyNumbers) ConfirmFamilyChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer, input parentbilling.FamilyChildrenInput) (parentbilling.FamilyChildrenSet, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	if f.contracts == nil {
		return parentbilling.FamilyChildrenSet{}, errOfficeNotConfigured
	}
	if err := validFamilyChildrenInput(input); err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	family, err := f.familyOfContract(ctx, reviewer.OrganizationID, input.ContractID)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	if err := f.store.LockCareBilling(ctx, reviewer.OrganizationID); err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: hold the monthly billing: %w", err)
	}
	id, err := f.store.ConfirmFamilyChildren(ctx, reviewer.OrganizationID, reviewer.AccountID, family, input)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventConfirm, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID, Children: &input.Children, ValidFrom: &input.ValidFrom, ValidUntil: input.ValidUntil}
	target := parentbilling.FamilyChildTarget{ContractID: input.ContractID, CountID: &id}
	if err := f.store.InsertFamilyChildEvents(ctx, reviewer.OrganizationID, event, []parentbilling.FamilyChildTarget{target}); err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: record family child count change: %w", err)
	}
	return f.FamilyChildren(ctx, reviewer)
}

// RemoveFamilyChildren removes the number of the family of a contract; the
// sibling rule counts its children with a contract again.
func (f *FamilyNumbers) RemoveFamilyChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer, contractID int64) (parentbilling.FamilyChildrenSet, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	if f.contracts == nil {
		return parentbilling.FamilyChildrenSet{}, errOfficeNotConfigured
	}
	family, err := f.familyOfContract(ctx, reviewer.OrganizationID, contractID)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	if err := f.store.LockCareBilling(ctx, reviewer.OrganizationID); err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: hold the monthly billing: %w", err)
	}
	removed, err := f.removeFamilyNumbers(ctx, reviewer.OrganizationID, family, contractID)
	if err != nil {
		return parentbilling.FamilyChildrenSet{}, err
	}
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventDelete, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := f.store.InsertFamilyChildEvents(ctx, reviewer.OrganizationID, event, removed); err != nil {
		return parentbilling.FamilyChildrenSet{}, fmt.Errorf("parent billing: record family child count removal: %w", err)
	}
	return f.FamilyChildren(ctx, reviewer)
}

// removeFamilyNumbers removes every number of the family of a contract: its
// own and those its contracts brought along when the family got its mail
// address (#7356). Else a number the office removed would give way to an
// older one. It answers the contracts the removed numbers hung on.
func (f *FamilyNumbers) removeFamilyNumbers(ctx context.Context, organizationID int64, family string, contractID int64) ([]parentbilling.FamilyChildTarget, error) {
	counts, err := f.store.FamilyChildCounts(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	recipients, err := f.contracts.Recipients(ctx, organizationID, familyRecipientContracts([]int64{contractID}, counts))
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	numbers, _ := numbersByFamily(counts, recipients)
	found, ok := numbers[family]
	if !ok {
		return nil, parentbilling.ErrFamilyChildrenNotFound
	}
	all := found.all()
	keys := make([]string, len(all))
	for i, count := range all {
		keys[i] = count.FamilyEmail
	}
	return f.store.DeleteFamilyChildren(ctx, organizationID, keys)
}

// familyOfContract is the family of a contract of the Träger: the address
// of its invoice's recipient, else the contract itself (#7356).
func (f *FamilyNumbers) familyOfContract(ctx context.Context, organizationID, contractID int64) (string, error) {
	if contractID <= 0 {
		return "", parentbilling.ErrFamilyChildrenNotFound
	}
	recipients, err := f.contracts.Recipients(ctx, organizationID, []int64{contractID})
	if err != nil {
		return "", fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	recipient, ok := recipients[contractID]
	if !ok {
		return "", parentbilling.ErrFamilyChildrenNotFound
	}
	return parentbilling.ContractFamilyKey(recipient.Email, contractID), nil
}

func validFamilyChildrenInput(input parentbilling.FamilyChildrenInput) error {
	errs := validation.Errors{}
	if err := validChildren(input.Children); err != nil {
		errs["children"] = err
	}
	if input.ValidFrom == "" {
		errs["valid_from"] = errors.New("is required")
	}
	if input.ValidUntil != nil && input.ValidFrom != "" && input.ValidUntil.Before(input.ValidFrom) {
		errs["valid_until"] = errors.New("must not be before valid_from")
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

func validChildren(children int) error {
	if children < 1 || children > parentbilling.MaxFamilyChildren {
		return errors.New("must be a whole number between 1 and 20")
	}
	return nil
}

// ParentFamilyChildren reads the number of the reader's family and records
// the read on the reader's contract.
func (f *FamilyNumbers) ParentFamilyChildren(ctx context.Context, organizationID int64, reader parentbilling.ParentFamilyReader) (parentbilling.ParentFamilyChildren, error) {
	if reader.AccountID <= 0 {
		return parentbilling.ParentFamilyChildren{}, parentbilling.ErrFamilyChildrenNotFound
	}
	return f.ContractFamilyChildren(ctx, organizationID, portalFamily(reader))
}

// StateFamilyChildren stores the number the parents state for their family
// on their contract. It counts once the Abrechnung confirmed it.
func (f *FamilyNumbers) StateFamilyChildren(ctx context.Context, organizationID int64, reader parentbilling.ParentFamilyReader, children int) (parentbilling.ParentFamilyChildren, error) {
	if reader.AccountID <= 0 {
		return parentbilling.ParentFamilyChildren{}, parentbilling.ErrFamilyChildrenNotFound
	}
	return f.StateContractFamilyChildren(ctx, organizationID, portalFamily(reader), children, nil)
}

func portalFamily(reader parentbilling.ParentFamilyReader) parentbilling.ContractFamily {
	return parentbilling.ContractFamily{ContractID: reader.ContractID, Email: reader.Email, AccountID: reader.AccountID,
		Channel: parentbilling.FamilyChannelPortal}
}

// ContractFamilyChildren reads the number of a contract's family and
// records the read with its channel on the contract (#6335).
func (f *FamilyNumbers) ContractFamilyChildren(ctx context.Context, organizationID int64, contract parentbilling.ContractFamily) (parentbilling.ParentFamilyChildren, error) {
	family, err := parentFamily(organizationID, contract)
	if err != nil {
		return parentbilling.ParentFamilyChildren{}, err
	}
	count, found, err := f.store.FamilyChildCount(ctx, organizationID, family)
	if err != nil {
		return parentbilling.ParentFamilyChildren{}, err
	}
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorParent,
		Channel: contract.Channel, AccountID: contract.AccountID}
	target := parentbilling.FamilyChildTarget{ContractID: contract.ContractID}
	if found {
		target.CountID = &count.ID
	}
	if err := f.store.InsertFamilyChildEvents(ctx, organizationID, event, []parentbilling.FamilyChildTarget{target}); err != nil {
		return parentbilling.ParentFamilyChildren{}, fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	if !found {
		return parentbilling.ParentFamilyChildren{}, nil
	}
	return parentView(count), nil
}

// StateContractFamilyChildren stores the number the parents state for the
// family of a contract. A statement made before the family's newest one
// (the registration's, taken over later) leaves the newer one and records
// nothing (#6335): an older number never silently replaces a newer one.
func (f *FamilyNumbers) StateContractFamilyChildren(ctx context.Context, organizationID int64, contract parentbilling.ContractFamily, children int,
	statedAt *time.Time) (parentbilling.ParentFamilyChildren, error) {
	family, err := parentFamily(organizationID, contract)
	if err != nil {
		return parentbilling.ParentFamilyChildren{}, err
	}
	if err := validChildren(children); err != nil {
		return parentbilling.ParentFamilyChildren{}, validation.Errors{"children": err}
	}
	if err := f.store.LockCareBilling(ctx, organizationID); err != nil {
		return parentbilling.ParentFamilyChildren{}, fmt.Errorf("parent billing: hold the monthly billing: %w", err)
	}
	id, applied, err := f.store.StateFamilyChildren(ctx, organizationID, contract.AccountID, family, contract.ContractID, children, statedAt)
	if err != nil {
		return parentbilling.ParentFamilyChildren{}, err
	}
	if applied {
		event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventState, Actor: parentbilling.FamilyChildActorParent,
			Channel: contract.Channel, AccountID: contract.AccountID, Children: &children}
		target := parentbilling.FamilyChildTarget{ContractID: contract.ContractID, CountID: &id}
		if err := f.store.InsertFamilyChildEvents(ctx, organizationID, event, []parentbilling.FamilyChildTarget{target}); err != nil {
			return parentbilling.ParentFamilyChildren{}, fmt.Errorf("parent billing: record family child count statement: %w", err)
		}
	}
	count, _, err := f.store.FamilyChildCount(ctx, organizationID, family)
	if err != nil {
		return parentbilling.ParentFamilyChildren{}, err
	}
	return parentView(count), nil
}

// CountsFamilyChildrenAt tells whether a care sibling rule of the Träger
// counts the family's children for a contract at the school (#6335): it
// counts them, applies to the school and has not ended by day. A rule that
// starts later still asks, since the contract may fall into it.
func (f *FamilyNumbers) CountsFamilyChildrenAt(ctx context.Context, organizationID, schoolID int64, day calendar.Date) (bool, error) {
	if organizationID <= 0 || schoolID <= 0 {
		return false, nil
	}
	rules, err := f.rulesCountingFamily(ctx, organizationID)
	if err != nil {
		return false, err
	}
	return countsFamilyAt(rules, schoolID, day), nil
}

func countsFamilyAt(rules []parentbilling.ContributionRule, schoolID int64, day calendar.Date) bool {
	return slices.ContainsFunc(rules, func(rule parentbilling.ContributionRule) bool {
		return rule.Service == parentbilling.ServiceCare && rule.Kind == parentbilling.RuleSibling && rule.CountsFamilyChildren &&
			(rule.ValidUntil == nil || !rule.ValidUntil.Before(day)) && slices.Contains(rule.SchoolIDs, schoolID)
	})
}

// parentFamily keys the family of a checked contract. The parents portal
// names its account; the link and the registration may have none.
func parentFamily(organizationID int64, contract parentbilling.ContractFamily) (string, error) {
	family := familyKey(contract.Email)
	if organizationID <= 0 || contract.ContractID <= 0 || contract.AccountID < 0 || family == "" {
		return "", parentbilling.ErrFamilyChildrenNotFound
	}
	switch contract.Channel {
	case parentbilling.FamilyChannelPortal:
		if contract.AccountID == 0 {
			return "", parentbilling.ErrFamilyChildrenNotFound
		}
	case parentbilling.FamilyChannelLink, parentbilling.FamilyChannelEnrollment:
	default:
		return "", parentbilling.ErrFamilyChildrenNotFound
	}
	return family, nil
}

func parentView(count parentbilling.FamilyChildCount) parentbilling.ParentFamilyChildren {
	return parentbilling.ParentFamilyChildren{ConfirmedAt: count.ConfirmedAt, StatedChildren: count.StatedChildren, StatedAt: count.StatedAt,
		ConfirmedChildren: count.ConfirmedChildren, ValidFrom: count.ValidFrom, ValidUntil: count.ValidUntil}
}
