package grouplive

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func (s *service) NavigationContext(ctx context.Context) (NavigationContext, error) {
	result := NavigationContext{OwnGroupIDs: []ident.ID{}, OwnRoomNames: []string{}}
	if err := s.validateGroupDependencies(); err != nil {
		return result, err
	}
	caller, err := s.deps.Access.Caller(ctx)
	if err != nil {
		return result, fmt.Errorf("resolve caller access: %w", err)
	}
	all, personalIDs, err := s.loadVisibleGroups(ctx, caller, s.deps.Groups.SupervisedGroupsWithRooms)
	if err != nil {
		return result, err
	}
	visible, err := s.withoutAwaitingHolidayGroups(ctx, all, 0)
	if err != nil {
		return result, err
	}
	// Both views reuse the same room names; personal groups are intentionally
	// taken before the holiday filter.
	roomNames := make(map[int64]string, len(all))
	seenRooms := make(map[string]bool)
	for _, group := range all {
		roomNames[group.ID] = group.RoomName
		if personalIDs[group.ID] {
			result.OwnGroupIDs = append(result.OwnGroupIDs, ident.ID(group.ID))
			if name := group.RoomName; name != "" && !seenRooms[name] {
				seenRooms[name] = true
				result.OwnRoomNames = append(result.OwnRoomNames, name)
			}
		}
	}
	if len(visible) == 0 {
		result.Groups = []NavigationGroup{}
		return result, nil
	}
	substituted, err := s.deps.Groups.SubstitutedGroupIDs(ctx)
	if err != nil {
		return result, fmt.Errorf("load substitution metadata: %w", err)
	}
	result.Groups = navigationGroups(visible, personalIDs, substituted, roomNames)
	return result, s.attachLeaders(ctx, result.Groups)
}

// attachLeaders names each group's Gruppenleitung with one bulk lookup.
func (s *service) attachLeaders(ctx context.Context, groups []NavigationGroup) error {
	ids := make([]int64, 0, len(groups))
	for _, group := range groups {
		ids = append(ids, group.ID.Int64())
	}
	leaders, err := s.deps.Groups.GroupLeaderNames(ctx, ids)
	if err != nil {
		return fmt.Errorf("load group leaders: %w", err)
	}
	for i := range groups {
		names := slices.Clone(leaders[groups[i].ID.Int64()])
		if len(names) == 0 {
			continue
		}
		slices.SortStableFunc(names, collation.CompareGerman)
		groups[i].Leaders = names
	}
	return nil
}

// sortGroups orders groups by German dictionary order. Equal names keep
// their directory order.
func sortGroups(groups []GroupRecord) {
	slices.SortStableFunc(groups, func(a, b GroupRecord) int { return collation.CompareGerman(a.Name, b.Name) })
}

func (s *service) resolveGroups(ctx context.Context, caller Caller, requestedGroupID int64) ([]NavigationGroup, *GroupRecord, error) {
	visibleGroups, personalIDs, err := s.loadVisibleGroups(ctx, caller, s.deps.Groups.SupervisedGroups)
	if err != nil {
		return nil, nil, err
	}
	visibleGroups, err = s.withoutAwaitingHolidayGroups(ctx, visibleGroups, requestedGroupID)
	if err != nil {
		return nil, nil, err
	}

	if len(visibleGroups) == 0 {
		if requestedGroupID > 0 {
			return nil, nil, ErrForbiddenGroup
		}
		return nil, nil, nil
	}

	selected := selectGroup(visibleGroups, personalIDs, requestedGroupID)
	if selected == nil {
		return nil, nil, ErrForbiddenGroup
	}

	substituted, err := s.deps.Groups.SubstitutedGroupIDs(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("load substitution metadata: %w", err)
	}
	groups, err := s.mapGroups(ctx, visibleGroups, personalIDs, substituted)
	if err != nil {
		return nil, nil, err
	}
	return groups, selected, nil
}

// loadVisibleGroups loads the groups the caller sees and marks its own. A
// caller who sees every group needs only the IDs of its own groups, which
// the identity chain already holds, and no second read of their rows.
func (s *service) loadVisibleGroups(ctx context.Context, caller Caller, loadPersonal func(context.Context) ([]GroupRecord, error)) ([]GroupRecord, map[int64]bool, error) {
	if caller.OperationalOverview && caller.CanReadGroups {
		personalIDs, err := s.deps.Groups.SupervisedGroupIDs(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("load supervised groups: %w", err)
		}
		groups, err := s.deps.Groups.TenantGroups(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("load tenant groups: %w", err)
		}
		sortGroups(groups)
		return groups, personalIDs, nil
	}
	myGroups, err := loadPersonal(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("load supervised groups: %w", err)
	}
	sortGroups(myGroups)
	personalIDs := make(map[int64]bool, len(myGroups))
	for _, group := range myGroups {
		personalIDs[group.ID] = true
	}
	return myGroups, personalIDs, nil
}

// selectGroup picks the requested group from the directory order, or the
// first personal group (falling back to the first visible one) when no group
// was requested. The directory delivers groups in German dictionary order.
func selectGroup(groups []GroupRecord, personalIDs map[int64]bool, requestedGroupID int64) *GroupRecord {
	if requestedGroupID <= 0 {
		for i := range groups {
			if personalIDs[groups[i].ID] {
				return &groups[i]
			}
		}
		return &groups[0]
	}
	for i := range groups {
		if groups[i].ID == requestedGroupID {
			return &groups[i]
		}
	}
	return nil
}

func (s *service) mapGroups(ctx context.Context, groups []GroupRecord, personalIDs, substituted map[int64]bool) ([]NavigationGroup, error) {
	roomNames, err := s.groupRoomNames(ctx, groups)
	if err != nil {
		return nil, fmt.Errorf("load group rooms: %w", err)
	}
	return navigationGroups(groups, personalIDs, substituted, roomNames), nil
}

func (s *service) groupRoomNames(ctx context.Context, groups []GroupRecord) (map[int64]string, error) {
	// One bulk lookup resolves every room name; a per-group lookup loop would
	// run on every aggregate refresh including SSE revalidations.
	roomGroupIDs := make([]int64, 0, len(groups))
	for _, group := range groups {
		if group.RoomID != nil {
			roomGroupIDs = append(roomGroupIDs, group.ID)
		}
	}
	if len(roomGroupIDs) > 0 {
		return s.deps.Groups.GroupRoomNames(ctx, roomGroupIDs)
	}
	return nil, nil
}

func navigationGroups(groups []GroupRecord, personalIDs, substituted map[int64]bool, roomNames map[int64]string) []NavigationGroup {
	result := make([]NavigationGroup, 0, len(groups))
	for _, group := range groups {
		result = append(result, NavigationGroup{
			ID: ident.ID(group.ID), Name: group.Name, RoomID: (*ident.ID)(group.RoomID), RoomName: roomNames[group.ID],
			ViaSubstitution: substituted[group.ID], IsPersonal: personalIDs[group.ID],
		})
	}
	return result
}
