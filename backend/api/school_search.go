package api

import (
	"context"
	"strings"

	"github.com/go-chi/chi/v5"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleOwner "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
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
func mountSchoolSearch(tenant chi.Router, caller schoolSearchCaller, answers enrollmentOwner.StudentAnswers,
	notes peopleOwner.StudentNoteSearch, activities activitycontract.ActivityService,
) error {
	search, err := schoolSearchCompose.New(answers, schoolSearchNotes{notes: notes}, schoolSearchActivities{enrollments: activities})
	if err != nil {
		return err
	}
	tenant.Mount("/search", schoolSearchHTTP.NewResource(search, caller, schoolSearchNoteAudience{caller: caller}).Router(ProtectedTenantRoutes))
	return nil
}

// schoolSearchNotes binds the search's note port to People Directory's note
// search, translating the projection's values into the owner's.
type schoolSearchNotes struct{ notes peopleOwner.StudentNoteSearch }

func (n schoolSearchNotes) SearchNotes(ctx context.Context, search schoolsearchview.NoteSearch) ([]schoolsearchview.NoteHit, error) {
	hits, err := n.notes.SearchStudentNotes(ctx, peopleOwner.StudentNoteSearchRequest{
		Text: search.Text, ReaderAccountID: search.ReaderAccountID, Admin: search.Admin,
		LedActivityGroupIDs: search.LedActivityGroupIDs, LedEducationGroupIDs: search.LedEducationGroupIDs,
	})
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
// Timetable enrollment read the note routes use, reduced to the group IDs.
type schoolSearchActivities struct {
	enrollments activitycontract.ActivityService
}

func (a schoolSearchActivities) ActivityGroupIDs(ctx context.Context, studentIDs []int64, onDate calendar.Date) (map[int64][]int64, error) {
	byStudent, err := a.enrollments.GetActiveStudentEnrollmentsByStudentIDs(ctx, studentIDs, onDate)
	if err != nil {
		return nil, err
	}
	out := make(map[int64][]int64, len(byStudent))
	for studentID, groups := range byStudent {
		for _, group := range groups {
			if group != nil {
				out[studentID] = append(out[studentID], group.ID)
			}
		}
	}
	return out, nil
}

// schoolSearchCaller is the caller as the search route and the note audience
// read them; CallerRows serves both.
type schoolSearchCaller interface {
	HasCurrentStaff(ctx context.Context) (bool, error)
	MyGroupIDs(ctx context.Context) ([]int64, error)
	MyTeacherGroupIDs(ctx context.Context) ([]int64, error)
	MyActivityGroupIDs(ctx context.Context) ([]int64, error)
	MySchoolClasses(ctx context.Context) ([]string, error)
}

// schoolSearchNoteAudience binds the search's note audience to the note
// card's rule: the facts the note routes gather (own and substituted groups,
// led groups, supervised activities, classes) go to Security Runtime's
// ResolveStudentNoteAudience, once for the parts that hold for every child
// and per child for the care team.
type schoolSearchNoteAudience struct{ caller schoolSearchCaller }

func (a schoolSearchNoteAudience) NoteReader(ctx context.Context) (*schoolsearchview.NoteReader, error) {
	groupIDs, err := a.caller.MyGroupIDs(ctx)
	if err != nil {
		return nil, err
	}
	ledGroupIDs, err := a.caller.MyTeacherGroupIDs(ctx)
	if err != nil {
		return nil, err
	}
	activityIDs, err := a.caller.MyActivityGroupIDs(ctx)
	if err != nil {
		return nil, err
	}
	classes, err := a.caller.MySchoolClasses(ctx)
	if err != nil {
		return nil, err
	}
	reader := securitycontract.StudentNoteReader{GroupIDs: groupIDs, LedEducationGroupIDs: ledGroupIDs, ActivityGroupIDs: activityIDs}
	for _, class := range classes {
		reader.Classes = append(reader.Classes, noteClassKey(class))
	}
	granted := sessiontoken.PermissionsFromCtx(ctx)
	base := securityruntime.ResolveStudentNoteAudience(granted, reader, securitycontract.StudentNoteChild{})
	return &schoolsearchview.NoteReader{
		AccountID: int64(sessiontoken.ClaimsFromCtx(ctx).ID), Admin: base.Admin,
		LedActivityGroupIDs: base.LedActivityGroupIDs, LedEducationGroupIDs: base.LedEducationGroupIDs,
		HasChild: func(child schoolsearchview.NoteChild) bool {
			return securityruntime.ResolveStudentNoteAudience(granted, reader, securitycontract.StudentNoteChild{
				GroupID: child.GroupID, SchoolClass: noteClassKey(child.SchoolClass), ActivityGroupIDs: child.ActivityGroupIDs,
			}).CareTeam
		},
	}, nil
}

// noteClassKey normalizes a school class as the note routes do
// (lower-case, trimmed), so " 3A " and "3a" meet on both sides.
func noteClassKey(class string) string { return strings.ToLower(strings.TrimSpace(class)) }

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
			})
		}
		out = append(out, projectionStudentsHTTP.EnrollmentAnswerFilterResponse{
			Key: filter.Key, Label: filter.Label, Type: string(filter.Type), Options: options,
		})
	}
	return out, nil
}
