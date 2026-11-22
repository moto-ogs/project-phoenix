package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// ContractRetention serves carecontract.ContractRetention in the
// administrative transaction of the hourly job (ADR 0184).
type ContractRetention struct{}

// NewContractRetention builds the retention adapter.
func NewContractRetention() *ContractRetention { return &ContractRetention{} }

func retentionDB(ctx context.Context) (bun.IDB, error) {
	if !tenant.IsAdminTx(ctx) {
		return nil, errors.New("care contract postgres: the contract retention requires the administrative transaction")
	}
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("care contract postgres: transaction is required")
	}
	tx, ok := transaction.(bun.Tx)
	if !ok {
		return nil, fmt.Errorf("care contract postgres: unsupported transaction %T", transaction)
	}
	return tx, nil
}

// endedContractStatuses are the states of a contract that ended.
const endedContractStatuses = `('gekuendigt', 'widerrufen', 'beendet')`

// contractEndDay is the last day of a contract: a terminated one ends on
// its last day, a withdrawn one on the day the withdrawal was received; an
// ended contract without such a day has none.
const contractEndDay = `CASE c.status
				WHEN 'gekuendigt' THEN c.ends_on
				WHEN 'widerrufen' THEN (SELECT max(n.received_on) FROM care_contract.contract_notices n
					WHERE n.organization_id = c.organization_id AND n.contract_id = c.id AND n.kind = 'widerruf')
			END`

// RetentionFacts lists the contracts past their draft with the day they
// were concluded and, once ended, their last day. A contract from an import
// whose day of conclusion no proof names (#7767) has none: a period that
// counts from the conclusion never starts for it.
func (ContractRetention) RetentionFacts(ctx context.Context, organizationID int64) ([]carecontract.RetentionFact, error) {
	db, err := retentionDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		OrganizationID int64          `bun:"organization_id"`
		ID             int64          `bun:"id"`
		ConcludedOn    *calendar.Date `bun:"concluded_on,type:date"`
		Ended          bool           `bun:"ended"`
		EndsOn         *calendar.Date `bun:"ends_on,type:date"`
	}
	if err := db.NewRaw(`SELECT c.organization_id, c.id,
			CASE WHEN NOT c.conclusion_date_unknown THEN (c.concluded_at AT TIME ZONE 'Europe/Berlin')::date END AS concluded_on,
			c.status IN `+endedContractStatuses+` AS ended, `+contractEndDay+` AS ends_on
		FROM care_contract.contracts c WHERE c.status <> 'entwurf' AND (?0 = 0 OR c.organization_id = ?0)
		ORDER BY c.organization_id, c.id`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: list contract retention facts: %w", err)
	}
	facts := make([]carecontract.RetentionFact, len(rows))
	for i, row := range rows {
		facts[i] = carecontract.RetentionFact{OrganizationID: row.OrganizationID, ContractID: row.ID,
			ConcludedOn: row.ConcludedOn, Ended: row.Ended, EndedOn: row.EndsOn}
	}
	return facts, nil
}

// DeleteEndedContracts deletes the ended contracts among contractIDs whose
// event, as it stands, lies on or before lastEventOn; the foreign keys
// cascade to everything of the contract. Its trail has no foreign key and
// goes in the same statement.
func (ContractRetention) DeleteEndedContracts(ctx context.Context, organizationID int64, contractIDs []int64, today calendar.Date,
	event string, lastEventOn calendar.Date,
) ([]int64, error) {
	if organizationID <= 0 || len(contractIDs) == 0 {
		return nil, nil
	}
	if event != carecontract.RetentionEventEnded && event != carecontract.RetentionEventConcluded {
		return nil, fmt.Errorf("care contract postgres: unknown retention event %q", event)
	}
	db, err := retentionDB(ctx)
	if err != nil {
		return nil, err
	}
	var deleted []int64
	err = db.NewRaw(`WITH removed AS (
			DELETE FROM care_contract.contracts c WHERE `+deletableContract+`
			RETURNING c.id),
		trail AS (
			DELETE FROM care_contract.contract_events e USING removed
			WHERE e.organization_id = ?0 AND e.contract_id = removed.id)
		SELECT id FROM removed ORDER BY id`, organizationID, pgdialect.Array(contractIDs), today, lastEventOn, event).Scan(ctx, &deleted)
	if err != nil {
		return nil, fmt.Errorf("care contract postgres: delete ended contracts: %w", err)
	}
	return deleted, nil
}

// deletableContract is the condition under which the retention deletes a
// contract c among ?1 of the Träger ?0 on the day ?2 under a Weisung
// counting from the event ?4 that may lie on or before ?3.
const deletableContract = `c.organization_id = ?0 AND c.id = ANY(?1) AND c.status IN ` + endedContractStatuses + `
				AND (c.status <> 'gekuendigt' OR c.ends_on <= ?2::date)
				AND CASE ?4 WHEN 'contract_concluded' THEN
					CASE WHEN NOT c.conclusion_date_unknown THEN (c.concluded_at AT TIME ZONE 'Europe/Berlin')::date END
					ELSE ` + contractEndDay + ` END <= ?3::date`

// DeletableContracts answers which of the given contracts
// DeleteEndedContracts would delete as they stand, by the same condition.
func (ContractRetention) DeletableContracts(ctx context.Context, organizationID int64, contractIDs []int64, today calendar.Date,
	event string, lastEventOn calendar.Date,
) ([]int64, error) {
	if organizationID <= 0 || len(contractIDs) == 0 {
		return nil, nil
	}
	if event != carecontract.RetentionEventEnded && event != carecontract.RetentionEventConcluded {
		return nil, fmt.Errorf("care contract postgres: unknown retention event %q", event)
	}
	db, err := retentionDB(ctx)
	if err != nil {
		return nil, err
	}
	var deletable []int64
	if err := db.NewRaw(`SELECT c.id FROM care_contract.contracts c WHERE `+deletableContract+` ORDER BY c.id`,
		organizationID, pgdialect.Array(contractIDs), today, lastEventOn, event).Scan(ctx, &deletable); err != nil {
		return nil, fmt.Errorf("care contract postgres: list deletable contracts: %w", err)
	}
	return deletable, nil
}

// RecipientEmails answers the address of the first party with one per
// given contract past its draft, in the order BillingRecipients reads the
// parties.
func (ContractRetention) RecipientEmails(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]string, error) {
	emails := map[int64]string{}
	if organizationID <= 0 || len(contractIDs) == 0 {
		return emails, nil
	}
	db, err := retentionDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ContractID int64  `bun:"contract_id"`
		Email      string `bun:"email"`
	}
	if err := db.NewRaw(`SELECT DISTINCT ON (c.id) c.id AS contract_id, p.email
		FROM care_contract.contracts c
		JOIN care_contract.contract_parties p ON p.organization_id = c.organization_id AND p.contract_id = c.id
		WHERE c.organization_id = ? AND c.id = ANY(?) AND c.status <> 'entwurf' AND p.email <> ''
		ORDER BY c.id, p.id`, organizationID, pgdialect.Array(contractIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the recipient addresses of retained contracts: %w", err)
	}
	for _, row := range rows {
		emails[row.ContractID] = row.Email
	}
	return emails, nil
}
