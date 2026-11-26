package compose_test

import (
	"context"
	"fmt"
	"hash/fnv"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// askedByParents is a school whose every booking change the parents asked
// for themselves and the school approved (#4816): one approved request per
// day a booking starts or ends on, for exactly the care booked from that
// day, sent with the account of a party of the contract.
type askedByParents struct {
	bookings carecontract.SchoolBookings
	account  int64
}

// requestSubmittedAt is when the parents sent their requests.
var requestSubmittedAt = time.Date(2026, 10, 1, 9, 30, 0, 0, time.UTC)

func (a askedByParents) ApprovedParentRequests(ctx context.Context, requestChildIDs []int64) (map[int64][]carecontract.ParentRequest, error) {
	bookings, err := a.bookings.Bookings(ctx, requestChildIDs)
	if err != nil {
		return nil, err
	}
	requests := map[int64][]carecontract.ParentRequest{}
	for child, booked := range bookings {
		days := []calendar.Date{}
		for _, booking := range booked {
			for _, day := range []*calendar.Date{booking.ValidFrom, booking.ValidUntil} {
				if day != nil && !slices.Contains(days, *day) {
					days = append(days, *day)
				}
			}
		}
		for _, day := range days {
			request := carecontract.ParentRequest{AccountID: a.account, SubmittedAt: requestSubmittedAt, EffectiveFrom: day}
			for _, booking := range booked {
				if (booking.ValidFrom == nil || !booking.ValidFrom.After(day)) && (booking.ValidUntil == nil || booking.ValidUntil.After(day)) {
					request.Offerings = append(request.Offerings, carecontract.RequestedOffering{CareOfferingID: booking.CareOfferingID, Days: booking.Days})
				}
			}
			// A request signs once: other care on the same day is another
			// request of the parents, with a number of its own.
			number := fnv.New32a()
			_, _ = fmt.Fprint(number, day, request.Offerings)
			request.ID = int64(number.Sum32())
			requests[child] = append(requests[child], request)
		}
	}
	return requests, nil
}

// contractParty gives the contract a party with a parents account and
// answers that account: only a request of a party counts as a signature.
func contractParty(t *testing.T, ctx context.Context, organization, contract int64) int64 {
	t.Helper()
	return contractPartyAt(t, ctx, organization, contract, fmt.Sprintf("erika-%d@test.local", contract))
}

// contractPartyAt is contractParty with the party's mail address; an empty
// one is a family without mail, whose changed version is frozen but not sent.
func contractPartyAt(t *testing.T, ctx context.Context, organization, contract int64, email string) int64 {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	account := testpkg.CreateTestAccountWithPassword(t, db, fmt.Sprintf("partei-%d@test.local", testpkg.UniqueTestTenantID(t)), testpkg.NewTestPassword())
	_, err := db.ExecContext(ctx, `INSERT INTO care_contract.contract_parties (organization_id, contract_id, first_name, last_name, email, account_id)
		VALUES (?, ?, 'Erika', 'Muster', ?, ?)`, organization, contract, email, account.ID)
	require.NoError(t, err)
	return account.ID
}
