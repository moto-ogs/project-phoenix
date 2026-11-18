package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	settingsFacts "github.com/moto-ogs/project-phoenix/modules/settings"

	"github.com/go-chi/chi/v5"
	peopleRouteValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"

	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"

	schoolMembershipModule "github.com/moto-ogs/project-phoenix/modules/schoolmembership"

	classListHTTP "github.com/moto-ogs/project-phoenix/modules/schoolmembership/http/classlistentries"
	"github.com/moto-ogs/project-phoenix/observability"
)

// The class-list entries under /api/class-list-entries are served by the
// School Membership class-list adapter (#2668, #3355). Reads, the audited
// write flows, the student-match hint and the display order all go through
// the owner capability; this root only supplies rendering, auth and the JWT
// identity.

// newClassListEntriesResource binds the adapter to the shared renderer and
// the JWT identity.
func newClassListEntriesResource(entries schoolMembershipModule.ClassListEntries, logger *slog.Logger) *classListHTTP.Resource {
	return classListHTTP.NewResource(entries, classListHTTP.Runtime{
		Protected: func(router chi.Router, register func(chi.Router, classListHTTP.Middleware)) {
			ProtectedTenantRoutes(router, func(protected chi.Router, withTx apiCommon.Middleware) {
				register(protected, withTx)
			})
		},
		Permission:       apiCommon.RequiresPermission,
		Success:          apiCommon.Respond,
		Failure:          renderClassListEntryFailure,
		ObserveResponse:  observability.ObserveSchoolMembershipHTTPResponse,
		ParseIDParam:     apiCommon.ParseIDParam,
		CurrentAccountID: func(ctx context.Context) int64 { return int64(sessiontoken.ClaimsFromCtx(ctx).ID) },

		Log: logger,
	})
}

// renderClassListEntryFailure writes the shared error shape for a classified
// failure. It does not observe: the adapter records every response itself.
func renderClassListEntryFailure(w http.ResponseWriter, r *http.Request, kind classListHTTP.FailureKind, err error) {
	switch kind {
	case classListHTTP.FailureInvalidRequest:
		if code := classListEntryRefusalCode(err); code != "" {
			apiCommon.RenderError(w, r, apiCommon.ErrorInvalidRequestWithCode(err, code))
			return
		}
		apiCommon.RenderError(w, r, apiCommon.ErrorInvalidRequest(err))
	case classListHTTP.FailureNotFound:
		apiCommon.RenderError(w, r, apiCommon.ErrorNotFound(err))
	default:
		apiCommon.RenderError(w, r, apiCommon.ErrorInternalServer(err))
	}
}

// classListEntryRefusals names the registered code of each refusal the
// class-list screen words itself (#2517). The status stays the owner's
// classification; a rejected field without its own code keeps the class code.
var classListEntryRefusals = []struct {
	err  error
	code string
}{
	{schoolMembershipModule.ErrClassListEntryDuplicate, apiCommon.CodeStudentsClassListEntryDuplicate},
	{schoolMembershipModule.ErrClassListEntryStudentExists, apiCommon.CodeStudentsClassListEntryStudentExists},
	{schoolMembershipModule.ErrClassListEntryStudentNotFound, apiCommon.CodeStudentsClassListEntryStudentNotFound},
	{schoolMembershipModule.ErrClassListEntryAssignMismatch, apiCommon.CodeStudentsClassListEntryAssignMismatch},
	{schoolMembershipModule.ErrClassListEntriesReplaced, apiCommon.CodeStudentsClassListEntriesReplaced},
}

// classListEntriesWhileChildrenKept refuses a new class-list entry while the
// school keeps children without an OGS place as student records (#4803,
// ADR 0282): its switch converted the entries, and such a child is now
// created as a student. Every other command passes through.
type classListEntriesWhileChildrenKept struct {
	schoolMembershipModule.ClassListEntries
	settings interface {
		ResolveBool(context.Context, string) (bool, error)
	}
	lock interface {
		LockClassListConversionShared(context.Context) error
	}
}

// classListConversionLockOf binds the shared conversion lock of the
// settings service; a service without it is a composition error.
func classListConversionLockOf(settings any) settingsFacts.ClassListConversionLock {
	lock, ok := settings.(settingsFacts.ClassListConversionLock)
	if !ok {
		panic("class list: settings service has no class-list conversion lock")
	}
	return lock
}

func (c classListEntriesWhileChildrenKept) AddClassListEntry(ctx context.Context, in schoolMembershipModule.AddClassListEntry) (schoolMembershipModule.ClassListEntry, error) {
	// Held to commit: a concurrent switch-on waits for this entry or is seen.
	if err := c.lock.LockClassListConversionShared(ctx); err != nil {
		return schoolMembershipModule.ClassListEntry{}, err
	}
	kept, err := settingsFacts.ChildrenWithoutCarePlaceOn(func(key string) (bool, error) { return c.settings.ResolveBool(ctx, key) })
	if err != nil {
		return schoolMembershipModule.ClassListEntry{}, err
	}
	if kept {
		return schoolMembershipModule.ClassListEntry{}, schoolMembershipModule.ErrClassListEntriesReplaced
	}
	return c.ClassListEntries.AddClassListEntry(ctx, in)
}

// ReviseClassListEntry, RemoveClassListEntry and ResolveClassListEntry hold
// the same shared lock to commit, so a switch-on never converts an entry
// under its old name or deletes one a concurrent write still changes.
func (c classListEntriesWhileChildrenKept) ReviseClassListEntry(ctx context.Context, in schoolMembershipModule.ReviseClassListEntry) (schoolMembershipModule.ClassListEntry, error) {
	if err := c.lock.LockClassListConversionShared(ctx); err != nil {
		return schoolMembershipModule.ClassListEntry{}, err
	}
	return c.ClassListEntries.ReviseClassListEntry(ctx, in)
}

func (c classListEntriesWhileChildrenKept) RemoveClassListEntry(ctx context.Context, in schoolMembershipModule.RemoveClassListEntry) error {
	if err := c.lock.LockClassListConversionShared(ctx); err != nil {
		return err
	}
	return c.ClassListEntries.RemoveClassListEntry(ctx, in)
}

func (c classListEntriesWhileChildrenKept) ResolveClassListEntry(ctx context.Context, in schoolMembershipModule.ResolveClassListEntry) error {
	if err := c.lock.LockClassListConversionShared(ctx); err != nil {
		return err
	}
	return c.ClassListEntries.ResolveClassListEntry(ctx, in)
}

func classListEntryRefusalCode(err error) string {
	for _, refusal := range classListEntryRefusals {
		if errors.Is(err, refusal.err) {
			return refusal.code
		}
	}
	return ""
}

// classListEntryStudentsReader adapts the owner capability to the narrow
// reader api/students consumes: the "Klassenliste" export and the class
// dropdown need the entries in display order and nothing else, so the HTTP
// resource stays free of the owner's types.
type classListEntryStudentsReader struct {
	entries schoolMembershipModule.ClassListEntries
}

func (r classListEntryStudentsReader) ListClassListEntriesInDisplayOrder(ctx context.Context) ([]peopleRouteValues.StudentClassListEntry, error) {
	values, err := r.entries.ListClassListEntriesInDisplayOrder(ctx, schoolMembershipModule.ClassListEntryFilter{})
	if err != nil {
		return nil, err
	}
	result := make([]peopleRouteValues.StudentClassListEntry, 0, len(values))
	for _, value := range values {
		result = append(result, peopleRouteValues.StudentClassListEntry{
			ID: value.ID, FirstName: value.FirstName, LastName: value.LastName, SchoolClass: value.SchoolClass,
		})
	}
	return result, nil
}
