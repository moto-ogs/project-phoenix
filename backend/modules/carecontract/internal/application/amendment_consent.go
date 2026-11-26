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
// the planned one: the same care from the same day. A waiting version whose
// day has passed holds from the day of its signature, so the plan from
// today is still its change. The contract's end counts: a waiting version
// that promises care longer than booked now is never signed. As on the
// timeline (sameCare), the day a single module is booked until does not
// count: a module booked longer since is the next change, from the day
// after the version's promise ends.
func waitingCarries(waiting *carecontract.Version, planned carecontract.Version, today calendar.Date) bool {
	if waiting == nil || !sameCare(waiting.Services, planned.Services) || !sameEnd(waiting.EndsOn, planned.EndsOn) {
		return false
	}
	return waiting.EffectiveFrom == planned.EffectiveFrom ||
		(waiting.EffectiveFrom.Before(today) && planned.EffectiveFrom == today)
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
	if sameCare(services, sent.Version.Services) {
		return carecontract.Version{}, false
	}
	version := sent.Version
	version.ID, version.Number, version.Status, version.Source = 0, sent.NextNumber, carecontract.VersionRequested, carecontract.SourceBookingChange
	version.EffectiveFrom, version.EndsOn, version.Services = from, ends, services
	version.PhaseName, version.PriceCents = firstText(booked.phaseName, sent.Version.PhaseName), booked.price
	version.ValidUntil, version.AgreedFrom = nil, nil
	return version, true
}
