package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// The contract keeps the party's name and address as signed. Invoices go to
// the address of the party's parents account today, so a parent who changes
// it in the app needs no new contract (#8215). Identity & Access owns that
// address; it is read in one statement for every party shown.

// accountEmails reads the current address of every party's account. A
// composition without the port reads none.
func accountEmails(ctx context.Context, accounts carecontract.AccountEmails, organizationID int64, parties []carecontract.Party) (map[int64]string, error) {
	if accounts == nil {
		return nil, nil
	}
	seen := map[int64]bool{}
	var ids []int64
	for _, party := range parties {
		if party.AccountID > 0 && !seen[party.AccountID] {
			seen[party.AccountID] = true
			ids = append(ids, party.AccountID)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	emails, err := accounts.TraegerAccountEmails(ctx, organizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("care contract: read the parents account addresses: %w", err)
	}
	return emails, nil
}

// withAccountEmail sets the party's account address from emails.
func withAccountEmail(party carecontract.Party, emails map[int64]string) carecontract.Party {
	if party.AccountID > 0 {
		party.AccountEmail = strings.TrimSpace(emails[party.AccountID])
	}
	return party
}

// fillAccountEmails sets the account address of every party in place.
func fillAccountEmails(ctx context.Context, accounts carecontract.AccountEmails, organizationID int64, parties []carecontract.Party) error {
	emails, err := accountEmails(ctx, accounts, organizationID, parties)
	if err != nil {
		return err
	}
	for i := range parties {
		parties[i] = withAccountEmail(parties[i], emails)
	}
	return nil
}
