package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The school's read of the contracts of its application children (#4788)
// shares BookedCare's tenant transaction and policy: migration 1.15.785
// admits only the school's contracts past the draft, and the statement names
// the school and the status once more.
var _ carecontract.ApplicationContracts = BookedCare{}

type applicationContractRow struct {
	ContractID       int64      `bun:"contract_id"`
	RequestChildID   int64      `bun:"request_child_id"`
	Status           string     `bun:"status"`
	SentAt           *time.Time `bun:"sent_at"`
	ConcludedAt      *time.Time `bun:"concluded_at"`
	ConclusionMethod *string    `bun:"conclusion_method"`
	// DateUnknown and TakenOver: a contract of an import concluded on a day
	// the office does not know (#7767).
	DateUnknown   bool           `bun:"conclusion_date_unknown"`
	TakenOver     bool           `bun:"taken_over"`
	EndsOn        *calendar.Date `bun:"ends_on,type:date"`
	EffectiveFrom *calendar.Date `bun:"effective_from,type:date"`
	Services      string         `bun:"services"`
}

// applicationContractsSQL reads each contract with its newest version that
// holds on a day, in one statement for all children.
const applicationContractsSQL = `SELECT c.id AS contract_id, c.request_child_id, c.status, c.sent_at,
		c.concluded_at, c.conclusion_method, c.conclusion_date_unknown, c.import_origin IS NOT NULL AS taken_over,
		c.ends_on, v.effective_from,
		CASE WHEN v.id IS NULL OR c.status = ? THEN '[]' ELSE ` + servicesSQL + ` END AS services
	FROM care_contract.contracts AS c
	LEFT JOIN LATERAL (
		SELECT cv.id, cv.organization_id, cv.effective_from
		FROM care_contract.contract_versions AS cv
		WHERE cv.contract_id = c.id AND cv.organization_id = c.organization_id AND cv.status NOT IN (?, ?)
		ORDER BY cv.version_number DESC
		LIMIT 1) AS v ON true
	WHERE c.school_id = ? AND c.request_child_id = ANY(?) AND c.status <> ?
	ORDER BY c.request_child_id, c.id`

// ApplicationContracts lists the contracts of the children; a child without
// one is missing.
func (BookedCare) ApplicationContracts(ctx context.Context, requestChildIDs []int64) ([]carecontract.ApplicationContract, error) {
	if len(requestChildIDs) == 0 {
		return []carecontract.ApplicationContract{}, nil
	}
	db, school, err := schoolDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []applicationContractRow
	if err := db.NewRaw(applicationContractsSQL, carecontract.StatusWithdrawn, carecontract.VersionRejected, carecontract.VersionReplaced, school,
		pgdialect.Array(requestChildIDs), carecontract.StatusDraft).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care contract postgres: read application contracts: %w", err)
	}
	result := make([]carecontract.ApplicationContract, 0, len(rows))
	for _, row := range rows {
		services := []carecontract.Service{}
		if err := json.Unmarshal([]byte(row.Services), &services); err != nil {
			return nil, fmt.Errorf("care contract postgres: read application contract services: %w", err)
		}
		contract := carecontract.ApplicationContract{
			RequestChildID: row.RequestChildID, ContractID: row.ContractID, Status: row.Status, SentAt: row.SentAt,
			EndsOn: row.EndsOn, EffectiveFrom: row.EffectiveFrom, Services: services,
		}
		if row.ConcludedAt != nil && row.ConclusionMethod != nil {
			contract.Concluded = &carecontract.Concluded{Method: *row.ConclusionMethod, At: *row.ConcludedAt,
				DateUnknown: row.DateUnknown, TakenOver: row.TakenOver}
		}
		result = append(result, contract)
	}
	return result, nil
}
