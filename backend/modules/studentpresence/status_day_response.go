package studentpresence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type StudentStatusDayResponse struct {
	ID         ident.ID   `json:"id"`
	StudentID  ident.ID   `json:"student_id"`
	Date       string     `json:"date"`
	Status     string     `json:"status"`
	Label      string     `json:"label"`
	ReportedAt time.Time  `json:"reported_at"`
	ClearedAt  *time.Time `json:"cleared_at,omitempty"`
	Source     string     `json:"source"`
	// Note carries an optional free-text reason (e.g. a parent sick note).
	Note      *string   `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
