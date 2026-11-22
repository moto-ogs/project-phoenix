package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/rendering"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/application"
)

// NoticePorts are the ports the root binds for withdrawal and termination
// (#4682): the Träger's confirmation templates and Delivery's outbox.
type NoticePorts = application.NoticePorts

// NewNotices builds withdrawal and termination (#4682): the office operations open their own Träger unit, the parents' run in the parents portal's.
func NewNotices(contracts ContractPorts, notices NoticePorts, now func() time.Time) carecontract.Notices {
	store, clock := storeOn(now), application.Clock{Now: now}
	return application.NewNotices(store, store, notices, clock,
		application.NewContracts(store, rendering.NewRenderer(), contracts, clock, NewContractVersions()))
}

// NewParentNotices builds the declarations of the parents portal alone, in its Träger unit; it needs no letterhead or access log.
func NewParentNotices(notices NoticePorts, now func() time.Time) carecontract.Notices {
	store := storeOn(now)
	return application.NewNotices(store, store, notices, application.Clock{Now: now}, nil)
}

// NewNoticeMailRenderer renders a confirmation mail for Delivery's worker.
func NewNoticeMailRenderer() carecontract.NoticeMailRenderer {
	return application.RenderNoticeMail
}
