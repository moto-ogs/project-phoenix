package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// ListSchoolRequiredDetails reports for every undeleted school whether
// replies from parents reach it (#7174). Schools created before the contact
// address became required (#2872) often have none, and the setup checklist
// never shows them; the operator list marks them instead. Statement count is
// flat in the number of schools: one school read and one settings batch read.
func (p *Provisioning) ListSchoolRequiredDetails(ctx context.Context) ([]organizationtenancy.SchoolRequiredDetails, error) {
	return adminValue(ctx, p, func(adminCtx context.Context) ([]organizationtenancy.SchoolRequiredDetails, error) {
		schools, err := p.organizations.ListNonDeletedSchools(adminCtx)
		if err != nil {
			return nil, err
		}
		result := make([]organizationtenancy.SchoolRequiredDetails, 0, len(schools))
		if len(schools) == 0 {
			return result, nil
		}
		ids := make([]int64, 0, len(schools))
		for _, school := range schools {
			ids = append(ids, school.ID.Int64())
		}
		replyTo, err := p.settings.ReplyToAddresses(adminCtx, ids)
		if err != nil {
			return nil, fmt.Errorf("read reply addresses of schools: %w", err)
		}
		for _, school := range schools {
			result = append(result, organizationtenancy.SchoolRequiredDetails{
				SchoolID: school.ID,
				// The mail identity's order (#1936): the reply setting first,
				// then the contact address.
				ReplyAddressMissing: !organizationtenancy.UsableReplyAddress(replyTo[school.ID.Int64()]) &&
					!organizationtenancy.UsableReplyAddress(school.Email),
			})
		}
		return result, nil
	})
}
