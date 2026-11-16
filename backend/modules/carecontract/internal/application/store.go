// Package application holds the use cases of the Betreuungsvertrag (ADR
// 0088, ADR 0153, #4678).
package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
)

type (
	Store             = ports.Store
	TemplateRow       = ports.TemplateRow
	ContractKey       = ports.ContractKey
	NewContract       = ports.NewContract
	NewParty          = ports.NewParty
	ContractRecord    = ports.ContractRecord
	StoredMailing     = ports.StoredMailing
	Event             = ports.Event
	AmendableContract = ports.AmendableContract
	SentDocument      = ports.SentDocument
	VersionStep       = ports.VersionStep
)

const (
	ActionRead     = ports.ActionRead
	ActionCreate   = ports.ActionCreate
	ActionSend     = ports.ActionSend
	ActionDiscard  = ports.ActionDiscard
	ActionTemplate = ports.ActionTemplate
	ActionConclude = ports.ActionConclude
)

type LetterRenderer interface {
	RenderContract(letter Letter, filenameBase string) (carecontract.File, error)
}

// Clock is the instant clock the composition binds from the root (ADR 0239);
// every constructor that takes one refuses a Clock without Now (ADR 0275).
type Clock struct {
	Now func() time.Time
}

func (c Clock) now() time.Time { return c.Now() }

// requireClock panics on a Clock without Now: a missing root clock is a
// wiring error, not the real clock.
func requireClock(clock Clock, service string) {
	if clock.Now == nil {
		panic("care contract " + service + ": the clock is required")
	}
}
