package api

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	careplanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/grouplive"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/observability"
)

// observeCarePlan records the excused-absence workflow as Care Plan
// operations.
func observeCarePlan(observation careplanCompose.Observation) {
	observability.ObserveCarePlanOperation(observation.Operation, observation.Duration, observation.Stats.Queries, observation.Stats.Rows, observation.Stats.Conflicts, observation.Stats.StatementDuration, careplan.ErrorCode(observation.Err), observation.Err)
}

// newEnrollmentFormSchemas builds the form schema administration where the
// root mounts it, over the collection settings (#4012), on the root clock now.
func newEnrollmentFormSchemas(settings owners.EnrollmentSettingsReads, logger *slog.Logger, now func() time.Time) enrollmentOwner.FormSchemaAdministration {
	return enrollmentCompose.NewFormSchemas(owners.NewEnrollmentBookings(now), owners.EnrollmentCollectionSettings{Settings: settings}, logger.With("service", "enrollment-form-schema"))
}

// newEnrollmentCaptcha builds the captcha verifier of the public enrollment
// form where the root mounts it, over the platform's Turnstile keys.
func newEnrollmentCaptcha(settings owners.EnrollmentSettingsReads, keys TurnstileKeys, logger *slog.Logger) enrollmentOwner.CaptchaVerifier {
	return enrollmentCompose.NewCaptcha(owners.EnrollmentCaptchaSettings{
		Settings: settings, SiteKey: keys.SiteKey, SecretKey: keys.SecretKey,
	}, "", logger.With("service", "enrollment-captcha"))
}

// newEnrollmentPhaseExpiry builds the phase expiry warnings over the People
// Directory's enrolled students and Care Plan's offerings, on the root clock
// now.
func newEnrollmentPhaseExpiry(students peopledirectory.StudentQuery, carePlan careplan.Query, now func() time.Time) enrollmentOwner.PhaseExpiryWarnings {
	bookings := owners.NewEnrollmentBookings(now)
	return enrollmentCompose.NewPhaseExpiryWarnings(enrollmentCompose.NewPhaseExpirySnapshots(
		bookings, phaseExpiryStudents{query: students}, phaseExpiryCarePlanDirectory{query: carePlan}, bookings,
	))
}

// requiredLink trims a configured base URL and refuses an empty one, and in
// production one without https.
func requiredLink(name, raw string, production bool) (string, error) {
	value := strings.TrimRight(raw, "/")
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	if production && !strings.HasPrefix(value, "https://") {
		return "", fmt.Errorf("%s must use https:// in production (received %q)", name, raw)
	}
	return value, nil
}

// GroupRoster is the live group roster's People port: the participation
// candidates of a group with their names.
type GroupRoster interface {
	GroupMembers(ctx context.Context, groupID int64) ([]grouplive.RosterStudent, error)
	GroupMemberIDs(ctx context.Context, groupIDs []int64) (map[int64][]int64, error)
}
