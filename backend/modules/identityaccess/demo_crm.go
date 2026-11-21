package identityaccess

import "context"

type DemoCRMJobs interface {
	RunOnce(context.Context, int, int) (int, error)
}
