package api

import (
	"context"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/roots/owners"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleOwner "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	studentsAPI "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolsearchview"
	schoolSearchCompose "github.com/moto-ogs/project-phoenix/modules/schoolsearchview/compose"
	schoolSearchHTTP "github.com/moto-ogs/project-phoenix/modules/schoolsearchview/http"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	securitycontract "github.com/moto-ogs/project-phoenix/modules/securityruntime/ports"
	"github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// newStudentAnswers builds Enrollment's read of the registration answers once
// per server; the search and the child list's filter share it.
func newStudentAnswers() enrollmentOwner.StudentAnswers { return enrollmentCompose.NewStudentAnswers() }

// mountSchoolSearch serves the school search at /api/search (ADR 0231,
// #6954) over Enrollment's registration answers, People Directory's note
// search and the activity enrollments the note audience reads (ADR 0234),
// and the caller's staff record and assignments.
func mountSchoolSearch(tenant chi.Router, caller *owners.CallerRows, answers enrollmentOwner.StudentAnswers,
	notes peopleOwner.StudentNoteSearch, activities activitycontract.ActivityService,
) error {
	search, err := schoolSearchCompose.New(answers, schoolSearchNotes{notes: notes}, schoolSearchActivities{enrollments: studentActiveEnrollments{enrollments: activities}})
	if err != nil {
		return err
	}
	tenant.Mount("/search", schoolSearchHTTP.NewResource(search, caller, schoolSearchNoteAudience{caller: caller}).Router(ProtectedTenantRoutes))
	return nil
}

// schoolSearchNotes binds the search's note port to People Directory's note
// search, with the note card's own filter for a reader in every child's care
// team (studentsAPI.ModuleNoteAudience).
type schoolSearchNotes struct{ notes peopleOwner.StudentNoteSearch }

func (n schoolSearchNotes) SearchNotes(ctx context.Context, search schoolsearchview.NoteSearch) ([]schoolsearchview.NoteHit, error) {
	audience := studentsAPI.ModuleNoteAudience(securitycontract.StudentNoteAudience{
		Admin: search.Admin, CareTeam: true,
		LedActivityGroupIDs: search.LedActivityGroupIDs, LedEducationGroupIDs: search.LedEducationGroupIDs,
	}, search.ReaderAccountID)
	hits, err := n.notes.SearchStudentNotes(ctx, peopleOwner.StudentNoteSearchRequest{Text: search.Text, Audience: audience})
	if err != nil {
		return nil, err
	}
	out := make([]schoolsearchview.NoteHit, 0, len(hits))
	for _, hit := range hits {
		out = append(out, schoolsearchview.NoteHit{StudentID: hit.StudentID, Body: hit.Body, CareTeamOnly: hit.CareTeamOnly})
	}
	return out, nil
}

// schoolSearchActivities serves the search's activity port from the
// enrollment read the note card uses, reduced to the group IDs.
type schoolSearchActivities struct{ enrollments studentActiveEnrollments }

func (a schoolSearchActivities) ActivityGroupIDs(ctx context.Context, studentIDs []int64, onDate calendar.Date) (map[int64][]int64, error) {
	byStudent, err := a.enrollments.ActiveEnrollmentGroups(ctx, studentIDs, onDate)
	if err != nil {
		return nil, err
	}
	out := make(map[int64][]int64, len(byStudent))
	for studentID, groups := range byStudent {
		for _, group := range groups {
			out[studentID] = append(out[studentID], group.ID)
		}
	}
	return out, nil
}

// schoolSearchNoteAudience binds the search's note audience to the note
// card's rule: the card's own fact gathering (studentsAPI.ResolveNoteReader)
// goes to Security Runtime's ResolveStudentNoteAudience, once for the parts
// that hold for every child and per child for the care team.
type schoolSearchNoteAudience struct{ caller studentsAPI.CallerContext }

func (a schoolSearchNoteAudience) NoteReader(ctx context.Context) (*schoolsearchview.NoteReader, error) {
	reader, err := studentsAPI.ResolveNoteReader(ctx, a.caller)
	if err != nil {
		return nil, err
	}
	granted := sessiontoken.PermissionsFromCtx(ctx)
	base := securityruntime.ResolveStudentNoteAudience(granted, reader, securitycontract.StudentNoteChild{})
	return &schoolsearchview.NoteReader{
		AccountID: int64(sessiontoken.ClaimsFromCtx(ctx).ID), Admin: base.Admin,
		LedActivityGroupIDs: base.LedActivityGroupIDs, LedEducationGroupIDs: base.LedEducationGroupIDs,
		HasChild: func(child schoolsearchview.NoteChild) bool {
			return securityruntime.ResolveStudentNoteAudience(granted, reader,
				studentsAPI.NoteChild(child.GroupID, child.SchoolClass, child.ActivityGroupIDs)).CareTeam
		},
	}, nil
}

// studentEnrollmentAnswerFilters binds the child list's registration answer
// filter (#6954) to Enrollment. StudentsWithAnswer is Enrollment's own.
type studentEnrollmentAnswerFilters struct{ enrollmentOwner.StudentAnswers }

func newStudentEnrollmentAnswerFilters(answers enrollmentOwner.StudentAnswers) studentEnrollmentAnswerFilters {
	return studentEnrollmentAnswerFilters{StudentAnswers: answers}
}

// AnswerFilters translates Enrollment's filter questions into the list's
// response shape; the list counts the children it shows.
func (f studentEnrollmentAnswerFilters) AnswerFilters(ctx context.Context) ([]projectionStudentsHTTP.EnrollmentAnswerFilterResponse, error) {
	filters, err := f.StudentAnswerFilters(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]projectionStudentsHTTP.EnrollmentAnswerFilterResponse, 0, len(filters))
	for _, filter := range filters {
		options := make([]projectionStudentsHTTP.EnrollmentAnswerOptionResponse, 0, len(filter.Options))
		for _, option := range filter.Options {
			options = append(options, projectionStudentsHTTP.EnrollmentAnswerOptionResponse{
				Value: option.Value, Label: option.Label, StudentIDs: option.StudentIDs,
				Given: option.Value == enrollmentOwner.AnswerGivenValue,
			})
		}
		out = append(out, projectionStudentsHTTP.EnrollmentAnswerFilterResponse{
			Key: filter.Key, Label: filter.Label, Type: string(filter.Type), Options: options,
		})
	}
	return out, nil
}
