package identityaccess

import "context"

// RequestRateLimits enforces the installation's quotas before a school is known.
type RequestRateLimits interface {
	Admit(ctx context.Context, key string, requestsPerMinute, burst int, reserve bool) (settle func(spend bool) error, err error)
}
