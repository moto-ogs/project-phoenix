package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Who agreed to a changed version (#4816, ADR 0088 section 3, ADR 0325).
//
//   - The parents asked for the change themselves and the school or the
//     Träger-Büro approved exactly that: their request, sent with the
//     account of a party of the contract, counts as the signature. The
//     version holds from its effective date at once. A party is known by
//     its parents account or, where the contract knows none, by the address
//     of the account, as in the inbox.
//   - Any other change (the school or the Träger changed the bookings, the
//     approval booked something else than the parents asked for, or another
//     guardian than a party of the contract asked) makes a version that
//     waits as beantragt until a party signs it. The version in force holds
//     until then; the billing reads only versions in force.
//   - One version waits per contract. While it waits, the run plans the
//     same first change again: a plan that carries the same care leaves the
//     waiting version alone, another one overtakes it, and a change the
//     school took back ends the wait.
//   - A sent contract nobody signed yet follows the bookings too: its
//     version is overtaken by one with the care booked now, with a new PDF
//     and a new link. The old link and the old PDF sign nothing any more.

// signedRequest is the parents' request that counts as the signature of a
// version, with the party of the contract that sent it.
type signedRequest struct {
	request carecontract.ParentRequest
	party   ports.PartyAccount
}

func (r *signedRequest) requestID() any {
	if r == nil {
		return nil
	}
	return r.request.ID
}

// parentConsent answers the request that proves the parents' agreement to
// the change, or nil when the change needs a signature. Every day the
// change comes from on which a booking of care changed needs a request of a
// party that took effect on it and that the bookings of that day carry out
// exactly; the newest one signs. Days the version in force carries already
// (its own start and everything before it) ask for nothing: a change that
// holds from today groups them with the day it really happened on.
func parentConsent(read schoolRead, application carecontract.Application, contract AmendableContract, next change) *signedRequest {
	var carried calendar.Date
	if current, inForce := versionAt(contract.Versions, next.day); inForce && current.EffectiveFrom != next.day {
		carried = current.EffectiveFrom
	}
	var consent *signedRequest
	for _, origin := range next.origins {
		if !origin.After(carried) || !careChangesOn(read, application.Bookings, origin) {
			continue
		}
		found := requestOn(read, application, contract.Parties, origin)
		if found == nil {
			return nil
		}
		if consent == nil || found.request.SubmittedAt.After(consent.request.SubmittedAt) {
			consent = found
		}
	}
	return consent
}

// careChangesOn tells whether a booking of care starts or ends on day.
func careChangesOn(read schoolRead, bookings []carecontract.Booking, day calendar.Date) bool {
	return slices.ContainsFunc(bookings, func(booking carecontract.Booking) bool {
		_, care := read.offerings[booking.CareOfferingID]
		return care && (sameDay(booking.ValidFrom, day) || sameDay(booking.ValidUntil, day))
	})
}

// requestOn is the request of a party that took effect on day and whose
// modules and weekdays the bookings of that day carry.
func requestOn(read schoolRead, application carecontract.Application, parties []ports.PartyAccount, day calendar.Date) *signedRequest {
	for _, request := range application.ParentRequests {
		if request.EffectiveFrom != day {
			continue
		}
		index := slices.IndexFunc(parties, func(party ports.PartyAccount) bool { return party.Sent(request.AccountID, request.AccountEmail) })
		if index >= 0 && bookingsCarry(read, application.Bookings, request, day) {
			return &signedRequest{request: request, party: parties[index]}
		}
	}
	return nil
}

// bookingsCarry tells whether the care booked from day on is what the
// request asked for: every care module whose booking starts or ends on the
// day, and every care module the request names, is booked from then on with
// the weekdays of the request, or not at all when the request does not name
// it. So a request another approval overruled since (one of its modules is
// gone again) proves nothing.
func bookingsCarry(read schoolRead, bookings []carecontract.Booking, request carecontract.ParentRequest, day calendar.Date) bool {
	compared := map[int64]bool{}
	booked := map[int64][]string{}
	for _, booking := range bookings {
		offering, care := read.offerings[booking.CareOfferingID]
		if !care {
			continue
		}
		if sameDay(booking.ValidFrom, day) || sameDay(booking.ValidUntil, day) {
			compared[booking.CareOfferingID] = true
		}
		if runsOn(booking, day) {
			booked[booking.CareOfferingID] = append(booked[booking.CareOfferingID], effectiveBookingDays(booking, offering)...)
		}
	}
	for _, requested := range request.Offerings {
		if _, care := read.offerings[requested.CareOfferingID]; care {
			compared[requested.CareOfferingID] = true
		}
	}
	for offeringID := range compared {
		if !sameDays(booked[offeringID], requestedDays(read, request, offeringID)) {
			return false
		}
	}
	return len(compared) > 0
}

// runsOn tells whether the booking holds on day; its ValidUntil is the
// first day it no longer holds.
func runsOn(booking carecontract.Booking, day calendar.Date) bool {
	return (booking.ValidFrom == nil || !booking.ValidFrom.After(day)) && (booking.ValidUntil == nil || booking.ValidUntil.After(day))
}

// requestedDays are the weekdays the request asks for of one module, as a
// booking of them would hold; none when the request does not name it.
func requestedDays(read schoolRead, request carecontract.ParentRequest, offeringID int64) []string {
	days := []string{}
	for _, requested := range request.Offerings {
		if requested.CareOfferingID == offeringID {
			days = append(days, effectiveBookingDays(carecontract.Booking{CareOfferingID: offeringID, Days: requested.Days}, read.offerings[offeringID])...)
		}
	}
	return days
}

func sameDays(a, b []string) bool {
	left, right := slices.Clone(a), slices.Clone(b)
	slices.Sort(left)
	slices.Sort(right)
	return slices.Equal(slices.Compact(left), slices.Compact(right))
}

// waitingCarries tells whether the version that waits for a signature is
// the planned one: the same care from the same day, with the same end of
// the contract and of every module. A waiting version whose day has passed
// holds from the day of its signature, so the plan from today is still its
// change. A waiting version that promises care longer than booked now is
// never signed.
func waitingCarries(read schoolRead, bookings []carecontract.Booking, waiting *carecontract.Version, planned carecontract.Version, today calendar.Date) bool {
	if waiting == nil || !sameCare(waiting.Services, planned.Services) || !sameEnd(waiting.EndsOn, planned.EndsOn) {
		return false
	}
	day := waiting.EffectiveFrom
	if day.Before(today) {
		day = today
	}
	if planned.EffectiveFrom != day {
		return false
	}
	return promisesBooked(read, bookings, *waiting, day)
}

// promisesBooked tells whether every module of the version is booked from
// day exactly as long as the version promises it: to the module's last day,
// else to the version's end, else open ended.
func promisesBooked(read schoolRead, bookings []carecontract.Booking, version carecontract.Version, day calendar.Date) bool {
	for _, service := range version.Services {
		booked, ok := moduleBookedUntil(read, bookings, service, day)
		if !ok || !sameEnd(earlier(booked, version.EndsOn), earlier(service.LastDay, version.EndsOn)) {
			return false
		}
	}
	return true
}

// moduleBookedUntil is the last day the child books the module on the weekday
// without a gap from day on; nil while it is booked open ended, false when
// it is not booked on day. A booking that starts on the day another one
// ends continues it: the school's correction splits a booking without
// changing the care.
func moduleBookedUntil(read schoolRead, bookings []carecontract.Booking, service carecontract.Service, day calendar.Date) (*calendar.Date, bool) {
	offering, care := read.offerings[service.CareOfferingID.Int64()]
	if !care {
		return nil, false
	}
	cursor := day
	for advanced := true; advanced; {
		advanced = false
		for _, booking := range bookings {
			clipped, ok := bookingWithinPhase(booking, offering, calendar.Date("0001-01-01"))
			if booking.CareOfferingID != offering.ID || !ok || !runsOn(clipped, cursor) ||
				!slices.Contains(effectiveBookingDays(clipped, offering), service.Weekday) {
				continue
			}
			if clipped.ValidUntil == nil {
				return nil, true
			}
			cursor, advanced = *clipped.ValidUntil, true
			break
		}
	}
	if cursor == day {
		return nil, false
	}
	last := cursor.AddDays(-1)
	return &last, true
}

// earlier is the earlier of two last days; nil is open ended.
func earlier(a, b *calendar.Date) *calendar.Date {
	if a == nil || (b != nil && b.Before(*a)) {
		return b
	}
	return a
}

func sameEnd(a, b *calendar.Date) bool {
	return (a == nil) == (b == nil) && (a == nil || *a == *b)
}

// recordRequest stores the parents' request as the signature of the version
// record carries, with the checksums of the version and of its frozen PDF,
// like every signature (ADR 0088 section 3). The request was sent at
// SubmittedAt with the account of the party; no drawn signature exists.
func (c *Conclusions) recordRequest(ctx context.Context, organizationID int64, record ContractRecord, consent *signedRequest) error {
	if consent == nil {
		return nil
	}
	contractID, versionID := record.Summary.ID.Int64(), record.Version.ID.Int64()
	document, err := c.contracts.store.CurrentDocument(ctx, organizationID, contractID, versionID)
	if err != nil {
		return err
	}
	checksum, err := versionChecksum(c.contracts.links.Fingerprint, record.Version)
	if err != nil {
		return err
	}
	request, account := consent.request, consent.request.AccountID
	if err := c.contracts.store.InsertSignature(ctx, organizationID, NewSignature{
		ContractID: contractID, VersionID: versionID, DocumentID: &document.ID, Method: carecontract.SignatureRequest,
		Channel: carecontract.ChannelParentAccount, SignerName: consent.party.Name, SignerAccountID: &account,
		VersionSHA256: checksum, DocumentSHA256: document.SHA256, SignedOn: calendar.DateFromTime(request.SubmittedAt),
		SignedAt: request.SubmittedAt, ChangeRequestID: &request.ID,
	}); err != nil {
		return err
	}
	return trailContract(ctx, c.contracts.store, organizationID, account, record, ports.ActionSign, map[string]any{
		"via": carecontract.ChannelParentAccount, "method": carecontract.SignatureRequest, "change_request_id": request.ID,
		"document_sha256": document.SHA256, "version_sha256": checksum, "version_number": record.Version.Number,
	})
}

// followSent lets a sent contract nobody signed yet follow the approved
// bookings (#4816): when the child books other care than its version says,
// a new version with that care overtakes it and goes to the parents with a
// new PDF and a new link. The parents sign only that version; the contract
// is never concluded on the one before.
func (c *Conclusions) followSent(ctx context.Context, organizationID int64, read schoolRead, sent SentContract,
	today calendar.Date, run *carecontract.AmendmentRun) error {
	application, ok := findApplication(read.applications, sent.Key.RequestChildID)
	if !ok {
		return nil
	}
	version, changed := sentVersionNow(read, application, sent, today)
	if !changed {
		return nil
	}
	followed := false
	reason, err := c.amend(ctx, organizationID, sent.ID, func(txCtx context.Context) error {
		record, err := c.intake.store.Contract(txCtx, organizationID, sent.ID, true)
		if err != nil || record.Summary.Status != carecontract.StatusSent || record.Version.ID != sent.Version.ID ||
			!record.UpdatedAt.Equal(sent.UpdatedAt) {
			return err
		}
		_, followed, err = c.storeVersion(txCtx, organizationID, record, versionChange{version: version, purpose: carecontract.MailPurposeAmendment,
			step: VersionStep{Overtake: sent.Version.ID.Int64(), Status: carecontract.VersionRequested}})
		return err
	})
	switch {
	case reason != "":
		run.Skipped = append(run.Skipped, carecontract.AmendmentSkip{ContractID: sent.ID, Reason: reason})
	case err == nil && followed:
		run.Awaiting = append(run.Awaiting, carecontract.AmendedContract{ContractID: sent.ID, VersionNumber: version.Number, EffectiveFrom: version.EffectiveFrom})
	}
	return err
}

// sentVersionNow is the version a sent contract would have with the care
// the child books now, and whether that care differs from its version. The
// terms stay the sent ones; only the care, its dates and its price follow.
// A child that books no care any more changes nothing here: that is an end
// of the care, not a new version.
func sentVersionNow(read schoolRead, application carecontract.Application, sent SentContract, today calendar.Date) (carecontract.Version, bool) {
	booked := bookedCare(read, application, today)
	if len(booked.services) == 0 {
		return carecontract.Version{}, false
	}
	from := booked.effectiveFrom(application, today)
	ends := endsOn(sent.Version.Terms, from, booked.until)
	services := boundServices(booked.services, ends)
	// The sent version stays when it promises exactly the care booked now,
	// for exactly as long: a version that promises more is never concluded.
	if sameCare(services, sent.Version.Services) && sameEnd(ends, sent.Version.EndsOn) &&
		promisesBooked(read, application.Bookings, sent.Version, from) {
		return carecontract.Version{}, false
	}
	version := sent.Version
	version.ID, version.Number, version.Status, version.Source = 0, sent.NextNumber, carecontract.VersionRequested, carecontract.SourceBookingChange
	version.EffectiveFrom, version.EndsOn, version.Services = from, ends, services
	version.PhaseName, version.PriceCents = firstText(booked.phaseName, sent.Version.PhaseName), booked.price
	version.ValidUntil, version.AgreedFrom = nil, nil
	return version, true
}

// readParentRequests fills in the parents' own approved requests of the
// applications read, in the caller's tenant transaction (#4816). Only the
// run that follows the bookings needs them; a composition without the port
// knows none.
func (in *Intake) readParentRequests(ctx context.Context, read *schoolRead) error {
	if in.requests == nil || len(read.applications) == 0 {
		return nil
	}
	ids := make([]int64, len(read.applications))
	for i, application := range read.applications {
		ids[i] = application.RequestChildID
	}
	requests, err := in.requests.ApprovedParentRequests(ctx, ids)
	if err != nil {
		return err
	}
	missing := []int64{}
	for i := range read.applications {
		read.applications[i].ParentRequests = requests[read.applications[i].RequestChildID]
		for _, request := range read.applications[i].ParentRequests {
			for _, requested := range request.Offerings {
				if _, known := read.offerings[requested.CareOfferingID]; !known && !slices.Contains(missing, requested.CareOfferingID) {
					missing = append(missing, requested.CareOfferingID)
				}
			}
		}
	}
	return in.readRequestedOfferings(ctx, read, missing)
}

// readRequestedOfferings adds the care modules a request names that the
// child no longer books, in one read: a request for a module another
// approval took away again must not pass as carried out. A requested
// offering that is no care (the lunch, an AG) is not in the answer and stays
// out of the comparison.
func (in *Intake) readRequestedOfferings(ctx context.Context, read *schoolRead, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	offerings, err := in.offerings(ctx, ids)
	if err != nil {
		return err
	}
	for _, offering := range offerings {
		read.offerings[offering.ID] = offering
	}
	return nil
}
