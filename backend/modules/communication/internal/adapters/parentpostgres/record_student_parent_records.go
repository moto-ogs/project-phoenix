package parentpostgres

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/internal/domain"
)

// AnnouncementStudentParentRecords reads the rows of one child's record
// (#4814) in five statements whatever the number of letters: the child's
// declaration history, the letters and declarations that reached the child,
// the settings and current version of those declarations, and the guardians
// who may declare for the child.
func (r *announcementRepository) AnnouncementStudentParentRecords(ctx context.Context, studentID int64) (*communication.PortalStudentParentRecords, error) {
	history, tenantID, err := r.store.ListDeclarationSubmissionsForStudent(ctx, studentID)
	if err != nil {
		return nil, err
	}
	submissions := declarationSubmissionModels(history)
	announcements, err := r.StudentAnnouncements(ctx, tenantID, studentID, submissions)
	if err != nil {
		return nil, err
	}
	declarationIDs := make([]int64, 0, len(announcements))
	for _, a := range announcements {
		if domain.AnnouncementIsDeclaration(a.DeliveryMode) {
			declarationIDs = append(declarationIDs, a.AnnouncementID)
		}
	}
	out := &communication.PortalStudentParentRecords{
		Announcements: announcements, Submissions: submissions,
		Settings: map[int64]communication.PortalAnnouncementDeclarationSettings{},
		Versions: map[int64]*communication.PortalDeclarationVersion{},
	}
	if len(declarationIDs) == 0 {
		return out, nil
	}
	if out.Settings, err = r.DeclarationSettings(ctx, declarationIDs); err != nil {
		return nil, err
	}
	if out.Versions, err = r.LatestDeclarationVersions(ctx, declarationIDs); err != nil {
		return nil, err
	}
	if out.Signers, err = r.DeclarationSigners(ctx, tenantID, []int64{studentID}); err != nil {
		return nil, err
	}
	return out, nil
}
