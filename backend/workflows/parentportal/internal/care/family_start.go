package care

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type FamilyStart struct {
	Day   calendar.Date
	Cards []FamilyStartCard
}

type FamilyStartCard struct {
	Child *ChildSummary
	// Missing fields signal a read failure, not disabled features or non-attendance.
	Features *ChildFeatureFlags
	Today    *TodayStatus
}

// schoolFact lives only for this sequential read of a single school. Keep a
// failed result too: a sibling must not retry the same failed school query.
type schoolFact[T any] struct {
	loaded bool
	value  T
	err    error
}

func (f *schoolFact[T]) read(load func() (T, error)) (T, error) {
	if !f.loaded {
		f.value, f.err = load()
		f.loaded = true
	}
	return f.value, f.err
}

func (s *Service) FamilyStart(ctx context.Context, accountID int64, studentID *int64) (*FamilyStart, error) {
	children, err := s.familyStartChildren(ctx, accountID, studentID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	result := &FamilyStart{Day: calendar.DateFromTime(now)}
	type schoolReads struct {
		features schoolFact[childFeatureSettings]
		day      schoolDayReads
	}
	schools := map[int64]*schoolReads{}
	for _, summary := range children {
		if !childHasPermission(summary, GuardianPermissionPortalAccess) {
			continue
		}
		child := summary.resolved(result.Day)
		school := schools[child.TenantID]
		if school == nil {
			school = &schoolReads{}
			schools[child.TenantID] = school
		}
		card := FamilyStartCard{Child: summary}
		settings, err := school.features.read(func() (childFeatureSettings, error) {
			settings, err := s.resolveChildFeatureSettings(ctx, child.TenantID, now)
			if err != nil {
				s.Logger.Warn("parent_family_features_unavailable",
					"school_id", child.TenantID,
					"error", err.Error(),
				)
			}
			return settings, err
		})
		if err == nil {
			flags := s.featuresForChild(ctx, accountID, summary.StudentID, child, settings)
			card.Features = &flags
		}
		card.Today, _ = s.todayForChild(ctx, summary.StudentID, child, now, &school.day)
		result.Cards = append(result.Cards, card)
	}
	return result, nil
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
