package care

import (
	"context"
	"errors"
	"maps"
	"math"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type FamilyStart struct {
	Day                 calendar.Date
	DayRemainingSeconds int
	Cards               []FamilyStartCard
}

type FamilyStartCard struct {
	Child *ChildSummary
	// Missing fields signal a read failure, not disabled features or non-attendance.
	Features *ChildFeatureFlags
	Today    *TodayStatus
}

// familySchool is the authorized children of one school in one family read.
type familySchool struct {
	tenantID int64
	children []schoolChild
}

// FamilyStart reads the start cards of the account's children. Each child is
// checked against its own relationship; the reads of one school then run as
// set reads for all of its children: one settings snapshot, one tenant
// transaction for the open requests and one for the day. The statement count
// grows with the schools, not with the children of a school. A failure keeps
// its field and its school: the other schools' cards stay complete.
func (s *Service) FamilyStart(ctx context.Context, accountID int64, studentID *int64) (*FamilyStart, error) {
	children, err := s.familyStartChildren(ctx, accountID, studentID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	day := calendar.DateFromTime(now)
	result := &FamilyStart{
		Day:                 day,
		DayRemainingSeconds: int(math.Ceil(day.AddDays(1).BerlinMidnight().Sub(now).Seconds())),
	}
	features := make(map[int64]ChildFeatureFlags, len(children))
	today := make(map[int64]*TodayStatus, len(children))
	for _, school := range familySchools(children, day) {
		s.readFamilySchool(ctx, accountID, school, now, features, today)
	}
	for _, summary := range children {
		if !childHasPermission(summary, GuardianPermissionPortalAccess) {
			continue
		}
		card := FamilyStartCard{Child: summary, Today: today[summary.StudentID]}
		if flags, ok := features[summary.StudentID]; ok {
			card.Features = &flags
		}
		result.Cards = append(result.Cards, card)
	}
	return result, nil
}

// readFamilySchool fills the features and the day of one school's children.
// A failed field is missing for this school only.
func (s *Service) readFamilySchool(ctx context.Context, accountID int64, school familySchool, now time.Time, features map[int64]ChildFeatureFlags, today map[int64]*TodayStatus) {
	if settings, err := s.resolveChildFeatureSettings(ctx, school.tenantID, now); err != nil {
		s.Logger.Warn("parent_family_features_unavailable",
			"school_id", school.tenantID,
			"error", err.Error(),
		)
	} else {
		maps.Copy(features, s.featuresForSchool(ctx, accountID, school.tenantID, school.children, settings))
	}
	// A failed day still yields the days that needed no read.
	statuses, _ := s.todayForSchool(ctx, school.tenantID, school.children, now)
	maps.Copy(today, statuses)
}

// familySchools groups the children the account may see by school, in the
// order of the child list. A child without parent_portal.access is no card.
func familySchools(children []*ChildSummary, day calendar.Date) []familySchool {
	var schools []familySchool
	index := map[int64]int{}
	for _, summary := range children {
		if !childHasPermission(summary, GuardianPermissionPortalAccess) {
			continue
		}
		child := summary.resolved(day)
		at, ok := index[child.TenantID]
		if !ok {
			at = len(schools)
			index[child.TenantID] = at
			schools = append(schools, familySchool{tenantID: child.TenantID})
		}
		schools[at].children = append(schools[at].children, schoolChild{id: summary.StudentID, child: child})
	}
	return schools
}

// An event can narrow the account's visible children, never widen them.
// An absent card is an authoritative removal; a failed lookup is an error.
func (s *Service) familyStartChildren(ctx context.Context, accountID int64, studentID *int64) ([]*ChildSummary, error) {
	if studentID == nil {
		return s.ListChildrenForAccount(ctx, accountID)
	}
	child, err := s.ResolvePermittedChild(ctx, accountID, *studentID, GuardianPermissionPortalAccess)
	if errors.Is(err, ErrChildNotLinked) || errors.Is(err, ErrGuardianPermissionDenied) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []*ChildSummary{child.summary}, nil
}
