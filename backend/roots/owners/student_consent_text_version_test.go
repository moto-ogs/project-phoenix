package owners

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
)

type recordingConsentTrail struct {
	entries []*auditModels.StudentConsentChange
}

func (r *recordingConsentTrail) Create(_ context.Context, entry *auditModels.StudentConsentChange) error {
	r.entries = append(r.entries, entry)
	return nil
}

func (r *recordingConsentTrail) CreateAll(_ context.Context, entries []*auditModels.StudentConsentChange) error {
	r.entries = append(r.entries, entries...)
	return nil
}

// TestStudentConsentTrailRecordsTheTextVersion pins #8039 at the writer
// every portal and enrollment consent change passes: a photo grant in the
// parent or tenant portal names moto's wording, a withdrawal, another
// consent and an enrollment-sourced grant name none.
func TestStudentConsentTrailRecordsTheTextVersion(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, time.November, 24, 9, 0, 0, 0, time.UTC)
	granted := peopleModule.StudentConsentSnapshot{StudentID: 7, PhotoConsentGivenAt: &at, AGBAcceptedAt: &at}
	none := peopleModule.StudentConsentSnapshot{StudentID: 7}

	record := func(t *testing.T, before, after peopleModule.StudentConsentSnapshot, source string) []string {
		t.Helper()
		trail := &recordingConsentTrail{}
		recorder := studentConsentTrail{trail: trail}
		require.NoError(t, recorder.RecordStudentConsentTransitions(context.Background(), before, after, source, nil, at))
		return consentVersions(trail.entries)
	}

	require.Equal(t, []string{"agb:granted:NULL", "photo:granted:photo-1"},
		record(t, none, granted, auditModels.StudentConsentSourceParentPortal))
	require.Equal(t, []string{"agb:granted:NULL", "photo:granted:photo-1"},
		record(t, none, granted, auditModels.StudentConsentSourceTenantPortal))
	require.Equal(t, []string{"agb:withdrawn:NULL", "photo:withdrawn:NULL"},
		record(t, granted, none, auditModels.StudentConsentSourceParentPortal))

	trail := &recordingConsentTrail{}
	enrollment := enrollmentStudentConsents{auditor: studentConsentTrail{trail: trail}}
	before := &enrollmentCompose.Student{}
	before.ID = 7
	after := &enrollmentCompose.Student{PhotoConsentGivenAt: &at}
	after.ID = 7
	require.NoError(t, enrollment.RecordEnrollmentConsentTransitions(context.Background(), before, after, nil, at))
	require.Equal(t, []string{"photo:granted:NULL"}, consentVersions(trail.entries),
		"enrollment shows the school's own legal block, not moto's wording")
	require.Equal(t, auditModels.StudentConsentSourceEnrollment, trail.entries[0].Source)
}

func consentVersions(entries []*auditModels.StudentConsentChange) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		version := "NULL"
		if entry.TextVersion != nil {
			version = *entry.TextVersion
		}
		out = append(out, entry.ConsentKey+":"+entry.Action+":"+version)
	}
	return out
}
