package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
)

// The persistence of the link of imported contracts to child records
// (#7760). Both statements run in the Träger transaction and name the Träger
// in their own filter. They write student_id only, the one column of a
// contract besides status and sent_at the request role may update; the
// trigger of the table stamps updated_at.

// linkContractChildrenSQL links every named imported contract that has no
// child record yet, in one statement. A contract linked since the caller read
// it, or one from an application, is left out, so the caller sees fewer
// contracts than it gave.
const linkContractChildrenSQL = `WITH input AS (
	SELECT * FROM jsonb_to_recordset(?::jsonb) AS i(contract_id bigint, student_id bigint)
)
UPDATE care_contract.contracts AS c SET student_id = i.student_id
FROM input AS i
WHERE c.organization_id = ? AND c.id = i.contract_id AND c.import_origin IS NOT NULL AND c.student_id IS NULL
RETURNING c.id`

// LockChildLinks takes the lock of the Träger's links for the rest of the
// transaction: a second run, or a creation of a contract, waits and then
// reads what the first one linked.
func (Store) LockChildLinks(ctx context.Context, organizationID int64) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.NewRaw(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`,
		fmt.Sprintf("care_contract.child_links:%d", organizationID)).Exec(ctx); err != nil {
		return fmt.Errorf("care contract postgres: lock the links: %w", err)
	}
	return nil
}

// LinkContractChildren links each imported contract without a child record
// to the one named and answers the contracts it linked.
func (Store) LinkContractChildren(ctx context.Context, organizationID int64, links []ports.ChildLink) ([]int64, error) {
	if len(links) == 0 {
		return []int64{}, nil
	}
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	type record struct {
		ContractID int64 `json:"contract_id"`
		StudentID  int64 `json:"student_id"`
	}
	records := make([]record, len(links))
	for i, link := range links {
		records[i] = record{ContractID: link.ContractID, StudentID: link.StudentID}
	}
	input, err := json.Marshal(records)
	if err != nil {
		return nil, fmt.Errorf("care contract postgres: encode the links: %w", err)
	}
	linked := []int64{}
	if err := db.NewRaw(linkContractChildrenSQL, string(input), organizationID).Scan(ctx, &linked); err != nil &&
		!errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("care contract postgres: link the contracts: %w", err)
	}
	return linked, nil
}

// UnlinkContractChild takes the child record studentID off an imported
// contract and answers the school and whether it had it. Under the row lock
// a contract without a child record stays as it is, and one linked to
// another child record is ErrChildLinkChanged: nothing is written then.
// ErrContractNotFound for a contract the Träger does not have,
// ErrChildLinkNotImported for one from an application.
func (Store) UnlinkContractChild(ctx context.Context, organizationID, contractID, studentID int64) (int64, bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, false, err
	}
	var row struct {
		SchoolID  int64  `bun:"school_id"`
		Imported  bool   `bun:"imported"`
		StudentID *int64 `bun:"student_id"`
	}
	err = db.NewRaw(`SELECT school_id, import_origin IS NOT NULL AS imported, student_id
		FROM care_contract.contracts WHERE organization_id = ? AND id = ? FOR UPDATE`, organizationID, contractID).Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, carecontract.ErrContractNotFound
	}
	if err != nil {
		return 0, false, fmt.Errorf("care contract postgres: lock the contract: %w", err)
	}
	switch {
	case !row.Imported:
		return 0, false, carecontract.ErrChildLinkNotImported
	case row.StudentID == nil:
		return row.SchoolID, false, nil
	case *row.StudentID != studentID:
		return 0, false, carecontract.ErrChildLinkChanged
	}
	if _, err := db.ExecContext(ctx, `UPDATE care_contract.contracts SET student_id = NULL WHERE organization_id = ? AND id = ?`,
		organizationID, contractID); err != nil {
		return 0, false, fmt.Errorf("care contract postgres: unlink the contract: %w", err)
	}
	return row.SchoolID, true, nil
}
