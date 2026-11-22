package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The persistence of the enrollment of the children of imported contracts
// (#7760, ADR 0308). Every statement runs in the Träger transaction and
// names the Träger in its own filter; none depends on the number of
// contracts.

// enrollmentContractsSQL reads the imported contracts of one school with the
// child of their newest version.
const enrollmentContractsSQL = `SELECT c.id AS contract_id, c.school_id, c.status, c.student_id, c.request_child_id, c.ends_on,
		n.child_first_name, n.child_last_name,
		(SELECT f.effective_from FROM care_contract.contract_versions AS f
			WHERE f.organization_id = c.organization_id AND f.contract_id = c.id AND f.version_number = 1) AS first_from,
		(SELECT MAX(m.version_number) + 1 FROM care_contract.contract_versions AS m
			WHERE m.organization_id = c.organization_id AND m.contract_id = c.id) AS next_number
	FROM care_contract.contracts AS c
	JOIN LATERAL (SELECT v.child_first_name, v.child_last_name FROM care_contract.contract_versions AS v
		WHERE v.organization_id = c.organization_id AND v.contract_id = c.id
		ORDER BY v.version_number DESC LIMIT 1) AS n ON true
	WHERE c.organization_id = ? AND c.school_id = ? AND c.import_origin IS NOT NULL
		AND (cardinality(?::bigint[]) = 0 OR c.id = ANY(?::bigint[]))
	ORDER BY c.id`

// lockedEnrollmentContractsSQL takes the row lock of each contract read.
const lockedEnrollmentContractsSQL = enrollmentContractsSQL + ` FOR UPDATE OF c`

// EnrollmentContracts reads the imported contracts of the school, all or
// only ids, with their effective versions by effective date, in two
// statements. forUpdate takes the row lock of each contract.
func (Store) EnrollmentContracts(ctx context.Context, organizationID, schoolID int64, ids []int64, forUpdate bool) ([]carecontract.EnrollmentContract, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var heads []struct {
		ContractID     int64          `bun:"contract_id"`
		SchoolID       int64          `bun:"school_id"`
		Status         string         `bun:"status"`
		StudentID      *int64         `bun:"student_id"`
		RequestChildID *int64         `bun:"request_child_id"`
		EndsOn         *calendar.Date `bun:"ends_on,type:date"`
		FirstName      string         `bun:"child_first_name"`
		LastName       string         `bun:"child_last_name"`
		FirstFrom      calendar.Date  `bun:"first_from,type:date"`
		NextNumber     int            `bun:"next_number"`
	}
	read := db.NewRaw(enrollmentContractsSQL, organizationID, schoolID, pgdialect.Array(nonNilIDs(ids)), pgdialect.Array(nonNilIDs(ids)))
	if forUpdate {
		read = db.NewRaw(lockedEnrollmentContractsSQL, organizationID, schoolID, pgdialect.Array(nonNilIDs(ids)), pgdialect.Array(nonNilIDs(ids)))
	}
	if err := read.Scan(ctx, &heads); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the imported contracts: %w", err)
	}
	if len(heads) == 0 {
		return []carecontract.EnrollmentContract{}, nil
	}
	contractIDs := make([]int64, len(heads))
	for i, head := range heads {
		contractIDs[i] = head.ContractID
	}
	timelines, err := effectiveTimelines(ctx, db, organizationID, contractIDs)
	if err != nil {
		return nil, err
	}
	contracts := make([]carecontract.EnrollmentContract, len(heads))
	for i, head := range heads {
		contracts[i] = carecontract.EnrollmentContract{
			ID: head.ContractID, SchoolID: head.SchoolID, Status: head.Status, StudentID: head.StudentID,
			RequestChildID: head.RequestChildID, EndsOn: head.EndsOn, FirstFrom: head.FirstFrom, NextNumber: head.NextNumber,
			ChildFirstName: head.FirstName, ChildLastName: head.LastName, Versions: timelines[head.ContractID],
		}
	}
	return contracts, nil
}

// bindContractApplicationsSQL binds every named imported contract that has
// no application child yet and still has the child record named, in one
// statement. A contract bound or linked otherwise since the caller read it,
// or one from an application, is left out, and so is one whose application
// child has a contract at the school already or is named for an earlier
// contract of the same call: the caller sees fewer contracts than it gave.
// It writes request_child_id only; the trigger of the table stamps
// updated_at.
const bindContractApplicationsSQL = `WITH input AS (
	SELECT * FROM jsonb_to_recordset(?::jsonb) AS i(contract_id bigint, student_id bigint, request_child_id bigint)
)
UPDATE care_contract.contracts AS c SET request_child_id = i.request_child_id
FROM input AS i
WHERE c.organization_id = ? AND c.id = i.contract_id AND c.import_origin IS NOT NULL AND c.request_child_id IS NULL
	AND c.student_id = i.student_id
	AND NOT EXISTS (SELECT 1 FROM care_contract.contracts AS o
		WHERE o.organization_id = c.organization_id AND o.school_id = c.school_id AND o.request_child_id = i.request_child_id)
	AND NOT EXISTS (SELECT 1 FROM input AS d WHERE d.request_child_id = i.request_child_id AND d.contract_id < i.contract_id)
RETURNING c.id`

// contractedApplicationsSQL tells whether an application child of the input
// has another contract at the school of its contract.
const contractedApplicationsSQL = `WITH input AS (
	SELECT * FROM jsonb_to_recordset(?::jsonb) AS i(contract_id bigint, student_id bigint, request_child_id bigint)
)
SELECT EXISTS (SELECT 1 FROM input AS i
	JOIN care_contract.contracts AS c ON c.organization_id = ? AND c.id = i.contract_id
	JOIN care_contract.contracts AS o ON o.organization_id = c.organization_id AND o.school_id = c.school_id
		AND o.request_child_id = i.request_child_id AND o.id <> c.id)`

// BindContractApplications binds each imported contract without an
// application child to the one named and answers the contracts it bound. An
// application child has one contract at a school (uq_contracts_application):
// when a contract stays unbound because its application child has another
// contract, the answer is ErrContractExists, as for a second draft.
func (Store) BindContractApplications(ctx context.Context, organizationID int64, bindings []ports.ApplicationBinding) ([]int64, error) {
	if len(bindings) == 0 {
		return []int64{}, nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	type record struct {
		ContractID     int64 `json:"contract_id"`
		StudentID      int64 `json:"student_id"`
		RequestChildID int64 `json:"request_child_id"`
	}
	records := make([]record, len(bindings))
	for i, binding := range bindings {
		records[i] = record(binding)
	}
	input, err := json.Marshal(records)
	if err != nil {
		return nil, fmt.Errorf("care contract postgres: encode the bindings: %w", err)
	}
	bound := []int64{}
	if err := db.NewRaw(bindContractApplicationsSQL, string(input), organizationID).Scan(ctx, &bound); err != nil &&
		!errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("care contract postgres: bind the contracts: %w", err)
	}
	if len(bound) == len(bindings) {
		return bound, nil
	}
	var contracted bool
	if err := db.NewRaw(contractedApplicationsSQL, string(input), organizationID).Scan(ctx, &contracted); err != nil {
		return nil, fmt.Errorf("care contract postgres: read the contracts of the application children: %w", err)
	}
	if contracted {
		return nil, carecontract.ErrContractExists
	}
	return bound, nil
}
