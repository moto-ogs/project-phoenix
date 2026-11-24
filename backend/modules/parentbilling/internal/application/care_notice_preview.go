package application

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// noticePreview is the preview of a calculated notice run: the drafts, the
// contracts whose notice still holds, the contracts a monthly invoice bills
// in a month of the period, the bookings the months leave out and the legal
// remedy the notices would print.
type noticePreview struct {
	notices    []parentbilling.CareNotice
	unchanged  int
	billed     int
	unpriced   []parentbilling.CareUnpriced
	duplicates []parentbilling.CareDuplicate
	// joined are the children the months join by their name across
	// schools (ADR 0158, Nachtrag Schulwechsel).
	joined []parentbilling.CareJoinedChild
	// billedChildren are the children a month holds back because an issued
	// invoice of another of their contracts already bills it (#7892).
	billedChildren     []parentbilling.CareBilledChild
	legalRemedyMissing bool
	issuedOn           calendar.Date
	fingerprint        string
}

func (p noticePreview) total() int64 {
	var total int64
	for _, notice := range p.notices {
		total += notice.TotalCents
	}
	return total
}

// noticeInput is what every month of a notice run is computed from; it is
// read once for the span and clipped per month.
type noticeInput struct {
	rule     string
	months   []calendar.Date
	previous map[int64]parentbilling.CareNotice
	// noticed names per month the contracts of the run's schools whose
	// effective notice the run assesses again.
	noticed map[calendar.Date]map[int64]bool
	month   careMonthInput
}

// preview computes the notices of a calculated run with the rule of the
// Träger now.
func (n *CareFeeNotices) preview(ctx context.Context, organizationID int64, run parentbilling.CareNoticeRun) (noticePreview, error) {
	in, err := n.noticeInput(ctx, organizationID, run)
	if err != nil {
		return noticePreview{}, err
	}
	issuedOn := n.billing.today()
	if run.NoticeDate != nil {
		issuedOn = *run.NoticeDate
	}
	preview := noticePreview{issuedOn: issuedOn, unpriced: []parentbilling.CareUnpriced{}, duplicates: []parentbilling.CareDuplicate{},
		joined: []parentbilling.CareJoinedChild{}, billedChildren: []parentbilling.CareBilledChild{}}
	drafts, err := n.noticeDrafts(ctx, organizationID, run, in, &preview)
	if err != nil {
		return noticePreview{}, err
	}
	// The issuer of the school issues the notice and collects it with the
	// family's mandate for its creditor identifier (#8040, ADR 0322).
	issuers, err := schoolIssuers(ctx, n.billing.kinds.templates, organizationID)
	if err != nil {
		return noticePreview{}, err
	}
	for _, invoices := range drafts {
		for i := range invoices {
			invoices[i].Issuer = parentbilling.IssuerOf(issuers, invoices[i].SchoolID.Int64())
		}
	}
	preview.notices, preview.unchanged = assessNotices(noticeAssessment{from: run.PeriodFrom, months: in.months,
		drafts: drafts, previous: in.previous, issuedOn: issuedOn})
	if err := n.withPayments(ctx, organizationID, preview.notices, issuedOn, issuers); err != nil {
		return noticePreview{}, err
	}
	legalRemedy, legalKey, missing, err := n.legalRemedyOf(ctx, organizationID)
	if err != nil {
		return noticePreview{}, err
	}
	for i := range preview.notices {
		preview.notices[i].LegalRemedy = legalRemedy
	}
	preview.legalRemedyMissing = missing
	preview.fingerprint = noticeFingerprint(run, in.rule, preview, legalKey)
	return preview, nil
}

// noticeDrafts computes every month of the run like the monthly run and
// keeps the drafts of its schools. A contract of an effective notice of the
// run's schools is computed again; every other issued month stays billed.
// From the run's first month on it also collects the contracts a monthly
// invoice bills, the bookings without a price and the duplicates.
func (n *CareFeeNotices) noticeDrafts(ctx context.Context, organizationID int64, run parentbilling.CareNoticeRun, in noticeInput,
	preview *noticePreview,
) (map[calendar.Date][]parentbilling.CareInvoice, error) {
	months, err := n.noticeMonths(ctx, organizationID, in)
	if err != nil {
		return nil, err
	}
	drafts := map[calendar.Date][]parentbilling.CareInvoice{}
	billed := map[int64]bool{}
	schools := ident.Int64s(run.SchoolIDs)
	for _, monthIn := range months {
		month := monthIn.month
		review, final, err := computeNoticeMonth(monthIn, monthIn.invoiced, in.noticed[month], schools)
		if err != nil {
			return nil, err
		}
		drafts[month] = retainFailedAssessments(final, review.careMonth, in.previous, in.month.recipients, month)
		if !month.Before(run.PeriodFrom) {
			addBilledByInvoice(billed, monthIn.invoiced, schools)
		}
		preview.unpriced = appendNew(preview.unpriced, review.unpriced)
		preview.duplicates = appendNew(preview.duplicates, review.duplicates)
		preview.joined = appendNew(preview.joined, review.joined)
		preview.billedChildren = mergeBilledChildren(preview.billedChildren, review.billedChildren)
	}
	preview.billed = len(billed)
	return drafts, nil
}

// noticeMonths reads all issued child identities missing from the monthly
// versions in one batch for the whole notice run.
func (n *CareFeeNotices) noticeMonths(ctx context.Context, organizationID int64, in noticeInput) ([]careMonthInput, error) {
	months := make([]careMonthInput, 0, len(in.months))
	missing := map[int64]bool{}
	for _, month := range in.months {
		monthIn := in.month
		monthIn.month = month
		monthIn.versions = clipVersions(in.month.versions, month, monthEnd(month))
		invoiced, err := n.billing.store.InvoicedContracts(ctx, organizationID, month)
		if err != nil {
			return nil, err
		}
		monthIn.invoiced = invoiced
		for _, id := range missingCareChildren(monthIn.versions, invoiced) {
			missing[id] = true
		}
		months = append(months, monthIn)
	}
	children, err := n.billing.issuedCareChildren(ctx, organizationID, slices.Collect(maps.Keys(missing)))
	if err != nil {
		return nil, err
	}
	for i := range months {
		months[i].issuedChildren = children
	}
	return months, nil
}

// computeNoticeMonth computes a month for the notices: every contract of an
// effective notice of the run's schools is computed again. A noticed
// contract the month cannot price or holds, for a duplicate or for an issued
// invoice that already bills its child (#7892), keeps its
// assessment; the month is then computed once more with that assessment as
// issued, so the rule chain (siblings, caps) counts it like any issued month.
// review is the first computation, which names the bookings without a price
// and the duplicates; final is the one the drafts come from.
func computeNoticeMonth(in careMonthInput, invoiced map[int64]parentbilling.CareInvoice, noticed map[int64]bool,
	schoolIDs []int64,
) (reviewedMonth, careMonth, error) {
	issued := make(map[int64]parentbilling.CareInvoice, len(invoiced))
	in.assessed = map[int64]parentbilling.CareInvoice{}
	for contractID, invoice := range invoiced {
		if noticed[contractID] {
			in.assessed[contractID] = invoice
		} else {
			issued[contractID] = invoice
		}
	}
	in.invoiced = issued
	in.frozenFamilies = invoiceFamilies(invoiced)
	// Both computations decide a school change alike: a notice computed
	// again keeps its frozen family and counts as not issued in both, also
	// when the second one takes its assessment back (#7874, #7892).
	in.recomputed = recomputedNotices(invoiced, noticed)
	computed, err := buildCareMonth(in)
	if err != nil {
		return reviewedMonth{}, careMonth{}, err
	}
	review := narrowMonth(computed, schoolIDs, nil)
	kept := false
	for contractID := range heldOrUnpriced(&computed) {
		if invoice, ok := invoiced[contractID]; ok && noticed[contractID] {
			issued[contractID], kept = invoice, true
		}
	}
	if !kept {
		return review, review.careMonth, nil
	}
	// A child held for an issued invoice stays held as a whole (S4): taking
	// one contract's assessment back must not free the others.
	in.keepHeld = heldForInvoice(computed.billedChildren)
	again, err := buildCareMonth(in)
	if err != nil {
		return reviewedMonth{}, careMonth{}, err
	}
	return review, narrowMonth(again, schoolIDs, nil).careMonth, nil
}

// recomputedNotices are the issued notice months a preview computes again.
func recomputedNotices(invoiced map[int64]parentbilling.CareInvoice, noticed map[int64]bool) map[int64]bool {
	recomputed := map[int64]bool{}
	for contractID := range invoiced {
		if noticed[contractID] {
			recomputed[contractID] = true
		}
	}
	return recomputed
}

// heldForInvoice names the contracts of the children held for an issued
// invoice.
func heldForInvoice(children []parentbilling.CareBilledChild) map[int64]bool {
	held := map[int64]bool{}
	for _, child := range children {
		for _, contract := range child.Contracts {
			held[contract.ContractID.Int64()] = true
		}
	}
	return held
}

// retainFailedAssessments keeps the effective assessment of months the
// computation could not price or held for duplicate contracts. An absent
// draft is a withdrawal only when the computation succeeded.
func retainFailedAssessments(final, review careMonth, previous map[int64]parentbilling.CareNotice,
	recipients map[int64]parentbilling.CareRecipient, month calendar.Date,
) []parentbilling.CareInvoice {
	drafts := final.invoices
	for contractID := range heldOrUnpriced(&review) {
		notice, ok := previous[contractID]
		if !ok {
			continue
		}
		months, _ := previousByMonth(notice, true)
		if invoice, assessed := months[month]; assessed {
			// Keep the assessment, not an outdated contract party.
			invoice.Recipient = recipients[contractID]
			invoice.FamilyEmail = invoice.Recipient.FamilyOf(contractID)
			drafts = append(drafts, invoice)
		}
	}
	slices.SortFunc(drafts, func(a, b parentbilling.CareInvoice) int { return compareOrdered(a.ContractID, b.ContractID) })
	return drafts
}

// addBilledByInvoice names the contracts of the schools a monthly invoice
// bills; a month of a notice carries the notice number.
func addBilledByInvoice(billed map[int64]bool, invoiced map[int64]parentbilling.CareInvoice, schoolIDs []int64) {
	for contractID, invoice := range invoiced {
		if invoice.Number == "" && slices.Contains(schoolIDs, invoice.SchoolID.Int64()) {
			billed[contractID] = true
		}
	}
}

// noticeInput reads the month rule, the effective notices of the year and
// everything the months are computed from, once for the whole span: from
// the first month of the run, or the first month an effective notice of its
// schools assessed, to December.
func (n *CareFeeNotices) noticeInput(ctx context.Context, organizationID int64, run parentbilling.CareNoticeRun) (noticeInput, error) {
	in := noticeInput{previous: map[int64]parentbilling.CareNotice{}, noticed: map[calendar.Date]map[int64]bool{}}
	var err error
	if in.rule, err = n.billing.settings.CareMonthRule(ctx, organizationID); err != nil {
		return in, fmt.Errorf("parent billing: read the month rule: %w", err)
	}
	if in.rule != parentbilling.MonthRuleVersionOnFirst && in.rule != parentbilling.MonthRuleProRata {
		return in, fmt.Errorf("parent billing: unknown month rule %q", in.rule)
	}
	effective, err := n.store.EffectiveCareNotices(ctx, organizationID, run.Year)
	if err != nil {
		return in, err
	}
	start := in.collectPrevious(effective, run)
	for month := start; !month.After(run.PeriodUntil); month = monthEnd(month).AddDays(1) {
		in.months = append(in.months, month)
	}
	in.month, err = n.billing.spanInput(ctx, organizationID, start, run.PeriodUntil, in.rule)
	return in, err
}

// collectPrevious keeps the effective notices of the run's schools, names
// per month the contracts they assess and answers the first month to
// compute: the run's first month or an earlier month of such a notice.
func (in *noticeInput) collectPrevious(effective []parentbilling.CareNotice, run parentbilling.CareNoticeRun) calendar.Date {
	start := run.PeriodFrom
	for _, notice := range effective {
		if !slices.Contains(run.SchoolIDs, notice.SchoolID) {
			continue
		}
		in.previous[notice.ContractID.Int64()] = notice
		for _, installment := range notice.Installments {
			if in.noticed[installment.Month] == nil {
				in.noticed[installment.Month] = map[int64]bool{}
			}
			in.noticed[installment.Month][notice.ContractID.Int64()] = true
			if installment.Month.Before(start) {
				start = installment.Month
			}
		}
	}
	return start
}

// spanInput reads what careMonthInput reads for one month for a span of
// months; the issued invoices are read per month.
func (c *CareBilling) spanInput(ctx context.Context, organizationID int64, from, until calendar.Date, rule string) (careMonthInput, error) {
	in := careMonthInput{rule: rule}
	var err error
	if in.versions, err = c.contracts.VersionsInForce(ctx, organizationID, from, until); err != nil {
		return in, fmt.Errorf("parent billing: read the contract versions: %w", err)
	}
	contracts := versionContracts(in.versions)
	if in.tariffs, in.lists, err = c.store.CarePriceLists(ctx, organizationID); err != nil {
		return in, err
	}
	if in.familyCounts, err = c.store.FamilyChildCounts(ctx, organizationID); err != nil {
		return in, err
	}
	if in.recipients, err = c.contracts.Recipients(ctx, organizationID, familyRecipientContracts(contracts, in.familyCounts)); err != nil {
		return in, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	if in.rules, err = c.store.ListContributionRules(ctx, organizationID, parentbilling.ServiceCare); err != nil {
		return in, fmt.Errorf("parent billing: read the care rules: %w", err)
	}
	if in.evidences, err = c.store.CareEvidences(ctx, organizationID, contracts); err != nil {
		return in, err
	}
	if in.costShares, err = c.store.CareCostShares(ctx, organizationID, contracts); err != nil {
		return in, err
	}
	return in, nil
}

// clipVersions keeps the versions in force within a month, clipped to it,
// as the contract owner answers them for that month.
func clipVersions(versions []parentbilling.CareContractVersion, from, until calendar.Date) []parentbilling.CareContractVersion {
	clipped := []parentbilling.CareContractVersion{}
	for _, version := range versions {
		if version.Until.Before(from) || version.From.After(until) {
			continue
		}
		if version.From.Before(from) {
			version.From = from
		}
		if version.Until.After(until) {
			version.Until = until
		}
		clipped = append(clipped, version)
	}
	return clipped
}

// appendNew adds the entries the list does not hold yet.
func appendNew[T any](list, entries []T) []T {
	for _, entry := range entries {
		key, _ := json.Marshal(entry)
		if !slices.ContainsFunc(list, func(have T) bool {
			other, _ := json.Marshal(have)
			return string(other) == string(key)
		}) {
			list = append(list, entry)
		}
	}
	return list
}

// withPayments resolves recipient and payment method of every notice like
// those of a monthly invoice (#4689): the family's deviation, else the terms
// of the monthly care.
func (n *CareFeeNotices) withPayments(ctx context.Context, organizationID int64, notices []parentbilling.CareNotice, issuedOn calendar.Date,
	issuers map[int64]parentbilling.BillingIssuer,
) error {
	// A notice names no debtor number: the payer's terms are enough.
	payments, err := readInvoicePayments(ctx, n.billing.store, organizationID, 0, 0, parentbilling.DebtorNumberScopePayer, false)
	if err != nil {
		return err
	}
	payments.withIssuers(issuers)
	for i := range notices {
		family := notices[i].FamilyEmail
		if family == "" {
			family = notices[i].Recipient.FamilyOf(notices[i].ContractID.Int64())
		}
		invoice := parentbilling.CareInvoice{Recipient: notices[i].Recipient, Service: parentbilling.ServiceCare,
			FamilyEmail: family, Issuer: notices[i].Issuer}
		payments.careInvoice(&invoice, issuedOn)
		notices[i].Recipient = invoice.Recipient
		if invoice.Payment != nil {
			notices[i].PaymentMethod = invoice.Payment.Method
		}
	}
	return nil
}

// noticeFingerprint names the reviewed state of a notice run: its schools,
// period, notice date and month rule; every notice with recipient, payment
// method, lines, installments, the months it bills with the cents the rule
// chain allocated and the notice it amends; the contracts whose notice
// still holds and those a monthly invoice bills; the bookings without a
// price, the duplicates, the children joined by their name and those an
// issued invoice already bills; and the legal remedy. A change of any of them
// since the review makes the release refuse.
func noticeFingerprint(run parentbilling.CareNoticeRun, rule string, preview noticePreview, legalRemedy string) string {
	notices := make([]any, len(preview.notices))
	for i, notice := range preview.notices {
		notices[i] = struct {
			Notice    parentbilling.CareNotice `json:"notice"`
			StudentID *int64                   `json:"student_id"`
			Months    []fingerprintInvoice     `json:"months"`
		}{notice, notice.StudentID, fingerprintInvoices(notice.Months)}
	}
	return readstate.Fingerprint(struct {
		Run         int64                         `json:"run"`
		Schools     []int64                       `json:"schools"`
		From        calendar.Date                 `json:"from"`
		NoticeDate  calendar.Date                 `json:"notice_date"`
		Rule        string                        `json:"rule"`
		Notices     []any                         `json:"notices"`
		Unchanged   int                           `json:"unchanged"`
		Billed      int                           `json:"billed"`
		Unpriced    []parentbilling.CareUnpriced  `json:"unpriced"`
		Duplicates  []parentbilling.CareDuplicate `json:"duplicates"`
		LegalRemedy string                        `json:"legal_remedy"`
		// Joined stays out while empty, so a run without a joined child
		// keeps the fingerprint it had before #7874.
		Joined []parentbilling.CareJoinedChild `json:"joined,omitempty"`
		// BilledChildren likewise, for the fingerprint before #7892.
		BilledChildren []parentbilling.CareBilledChild `json:"billed_children,omitempty"`
	}{run.ID.Int64(), ident.Int64s(run.SchoolIDs), run.PeriodFrom, preview.issuedOn, rule, notices, preview.unchanged, preview.billed,
		preview.unpriced, preview.duplicates, legalRemedy, preview.joined, preview.billedChildren})
}

// mergeBilledChildren adds the held children of a month to those of the
// months before. A child held in several months stands once per reason, with
// the contracts and documents of every month: the preview counts children,
// not months. Entries that share a contract are one child; an entry that
// joins two rows merges them into the first, so the order stays stable.
func mergeBilledChildren(list, entries []parentbilling.CareBilledChild) []parentbilling.CareBilledChild {
	for _, entry := range entries {
		merged := make([]parentbilling.CareBilledChild, 0, len(list)+1)
		at := -1
		for _, have := range list {
			switch {
			case have.Reason != entry.Reason || !shareContract(have.Contracts, entry.Contracts):
				merged = append(merged, have)
			case at < 0:
				at = len(merged)
				merged = append(merged, have)
			default:
				merged[at].Contracts = appendNew(merged[at].Contracts, have.Contracts)
				merged[at].Invoices = appendNew(merged[at].Invoices, have.Invoices)
			}
		}
		if at < 0 {
			entry.Contracts, entry.Invoices = slices.Clone(entry.Contracts), slices.Clone(entry.Invoices)
			merged = append(merged, entry)
		} else {
			merged[at].Contracts = appendNew(merged[at].Contracts, entry.Contracts)
			merged[at].Invoices = appendNew(merged[at].Invoices, entry.Invoices)
		}
		list = merged
	}
	return list
}

// shareContract tells whether two entries name a contract in common.
func shareContract(a, b []parentbilling.CareDuplicateContract) bool {
	return slices.ContainsFunc(a, func(contract parentbilling.CareDuplicateContract) bool {
		return slices.ContainsFunc(b, func(other parentbilling.CareDuplicateContract) bool { return other.ContractID == contract.ContractID })
	})
}
