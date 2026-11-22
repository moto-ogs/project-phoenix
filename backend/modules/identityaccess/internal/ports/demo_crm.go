package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

type DemoCRMQueue interface {
	QueueDemoCRM(context.Context, domain.DemoAccess, time.Time, bool) error
}

type DemoCRMJobs interface {
	ClaimDemoCRM(context.Context, time.Time) (domain.DemoCRMJob, bool, error)
	DemoCRMAuthorized(context.Context, domain.DemoCRMJob, time.Time) (bool, error)
	FinishDemoCRM(context.Context, domain.DemoCRMJob, time.Time, bool) error
}

type DemoCRMProvider interface {
	Sync(context.Context, domain.DemoCRMContact) error
}
