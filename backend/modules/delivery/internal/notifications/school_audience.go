package notifications

import (
	"context"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
)

var _ contract.SchoolAudience = (*router)(nil)

// SchoolAudience names the accounts a notice to the whole school reaches
// (#7144), in the caller's tenant transaction of the school. The staff
// accounts read the entry in the OGS portal or in moto schule; the guardians
// read it through the children they hold parent_portal.access for, which
// the feed checks again on every read.
func (r *router) SchoolAudience(ctx context.Context, tenantID int64) (contract.SchoolAudienceMembers, error) {
	if r.feedReader == nil || r.store == nil {
		return contract.SchoolAudienceMembers{}, errors.New("notification feed is not configured")
	}
	if tenantID <= 0 {
		return contract.SchoolAudienceMembers{}, errors.New("school audience: the school is required")
	}
	members, err := r.store.SchoolAudience(ctx, tenantID)
	if err != nil {
		return contract.SchoolAudienceMembers{}, err
	}
	var audience contract.SchoolAudienceMembers
	for _, member := range members {
		if member.Staff {
			audience.StaffAccountIDs = append(audience.StaffAccountIDs, member.AccountID)
		}
		if member.School {
			audience.SchoolAccountIDs = append(audience.SchoolAccountIDs, member.AccountID)
		}
		if len(member.StudentIDs) > 0 {
			audience.GuardianAccountIDs = append(audience.GuardianAccountIDs, member.AccountID)
			audience.StudentIDs = append(audience.StudentIDs, member.StudentIDs...)
		}
	}
	slices.Sort(audience.StudentIDs)
	audience.StudentIDs = slices.Compact(audience.StudentIDs)
	return audience, nil
}
