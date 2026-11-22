package careplanhttp

import (
	context "context"
	errors "errors"
	fmt "fmt"
	http "net/http"
	time "time"

	chi "github.com/go-chi/chi/v5"
	render "github.com/go-chi/render"
	common "github.com/moto-ogs/project-phoenix/api/common"
	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	sessiontoken "github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	securityruntime "github.com/moto-ogs/project-phoenix/modules/securityruntime"
	realtime "github.com/moto-ogs/project-phoenix/realtime"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	tenant "github.com/moto-ogs/project-phoenix/tenant"
)

// getStudentArrivalSchedules handles GET /students/{id}/arrival-schedules
func (rs *Resource) getStudentArrivalSchedules(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalReadAccess(w, r)
	if student == nil {
		return
	}

	rawDate := r.URL.Query().Get("date")
	date := rs.todayDate()
	if rawDate != "" {
		parsed, err := calendar.ParseDate(rawDate)
		if err != nil {
			renderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("invalid date: %w", err)))
			return
		}
		date = parsed
	}
	var (
		data *careplan.StudentArrivalData
		err  error
	)
	toRaw := r.URL.Query().Get("to")
	if toRaw == "" && rawDate == "" {
		data, err = rs.ArrivalScheduleService.GetStudentArrivalData(r.Context(), student.ID)
	} else if toRaw == "" {
		data, err = rs.ArrivalScheduleService.GetStudentArrivalDataForDate(r.Context(), student.ID, date)
	} else {
		to, parseErr := calendar.ParseDate(toRaw)
		if parseErr != nil {
			renderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("invalid to date: %w", parseErr)))
			return
		}
		if to.Before(date) {
			renderError(w, r, common.ErrorInvalidRequest(errors.New("to date must not be before date")))
			return
		}
		if date.DaysUntil(to) >= maxArrivalScheduleDateRangeDays {
			renderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("arrival schedule date range must span at most %d days", maxArrivalScheduleDateRangeDays)))
			return
		}
		data, err = rs.ArrivalScheduleService.GetStudentArrivalDataForDateRange(r.Context(), student.ID, date, to)
	}
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	response := buildArrivalDataResponse(data)
	common.Respond(w, r, http.StatusOK, response, "Arrival schedules retrieved successfully")
}

// buildArrivalDataResponse converts service arrival data to API response
func buildArrivalDataResponse(data *careplan.StudentArrivalData) ArrivalDataResponse {
	response := ArrivalDataResponse{
		Schedules:  make([]ArrivalScheduleResponse, 0, len(data.Schedules)),
		Exceptions: make([]StudentArrivalExceptionResponse, 0, len(data.Exceptions)),
		Notes:      make([]ArrivalNoteResponse, 0, len(data.Notes)),
	}

	for _, s := range data.Schedules {
		response.Schedules = append(response.Schedules, mapArrivalScheduleToResponse(s))
	}
	for _, e := range data.Exceptions {
		response.Exceptions = append(response.Exceptions, mapArrivalExceptionToResponse(e))
	}
	for _, n := range data.Notes {
		response.Notes = append(response.Notes, mapArrivalNoteToResponse(n))
	}

	return response
}

// broadcastArrivalScheduleChanged tells every open staff tab that a child's
// arrival plan changed.
//
// MUST be called from a tenant.RegisterAfterCommit hook, never inline. Handler
// writes run in a WithTenantTx that merely reuses the still-open
// TenantTxMiddleware transaction, so at handler return nothing is committed
// yet: a client woken inline refetches the PREVIOUS plan, and because this is
// the only invalidation the arrival caches get, nothing corrects it afterwards.
// A write that a later 5xx rolls back would leave every tab showing data that
// never existed. RegisterAfterCommit runs the callback immediately when no
// transaction is registered, so the hook is safe on every path.
//
// studentID is for the log line only — the event carries no student id (it is
// a tenant-wide staff broadcast; see the pickup sibling for the GDPR reasoning).
func (rs *Resource) broadcastArrivalScheduleChanged(tenantID, studentID int64) {
	if rs.Broadcaster == nil {
		return
	}

	source := "manual"
	data := realtime.EventData{Source: &source}
	event := realtime.NewEvent(
		realtime.EventArrivalScheduleChanged,
		"",
		data,
	)
	if err := rs.Broadcaster.BroadcastToTenant(tenantID, event); err != nil && rs.Logger != nil {
		rs.Logger.Warn(
			"failed to broadcast arrival schedule change",
			"student_id", studentID,
			"error", err.Error(),
		)
	}
}

// updateStudentArrivalSchedules handles PUT /students/{id}/arrival-schedules
func (rs *Resource) updateStudentArrivalSchedules(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "update arrival schedules")
	if student == nil {
		return
	}

	req := &BulkArrivalScheduleRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	staffID, err := rs.getStaffIDFromJWT(r)
	if err != nil {
		renderScheduleAuthorError(w, r, err)
		return
	}

	schedules := toArrivalScheduleModels(r.Context(), req.Schedules, student.ID, staffID)

	tenantID := tenant.FromContext(r.Context())
	if err := withinTenant(r.Context(), tenantID, func(ctx context.Context) error {
		return rs.ArrivalScheduleService.UpsertBulkStudentArrivalSchedules(ctx, student.ID, schedules)
	}); err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	data, err := rs.ArrivalScheduleService.GetStudentArrivalData(r.Context(), student.ID)
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// Both wakes defer to the OUTER request tx's commit — the handler
	// WithTenantTx is a nested reuse of the TenantTxMiddleware tx and has NOT
	// committed on return, so a woken client must not refetch yet (#1725 review).
	// This binds the STAFF broadcast as much as the guardian wake: a client that
	// refetches pre-commit reads the previous plan and nothing invalidates it a
	// second time, and a later 5xx rolls the write back after every open tab has
	// already refreshed to it. The guardian fan-out is separate because the
	// tenant-wide arrival_schedule_changed never reaches the parent SSE stream.
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
		rs.wakeChildGuardians(tenantID, student.ID)
	})
	response := buildArrivalDataResponse(data)
	common.Respond(w, r, http.StatusOK, response, "Arrival schedules updated successfully")
}

// createStudentArrivalException handles POST /students/{id}/arrival-exceptions
func (rs *Resource) createStudentArrivalException(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "create arrival exceptions")
	if student == nil {
		return
	}

	req := &StudentArrivalExceptionRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	staffID, err := rs.getStaffIDFromJWT(r)
	if err != nil {
		renderScheduleAuthorError(w, r, err)
		return
	}

	exceptionDate, _ := calendar.ParseDate(req.ExceptionDate)
	var arrivalTime *time.Time
	if req.ExpectedArrival != nil && *req.ExpectedArrival != "" {
		parsed, _ := parseTimeOnly(*req.ExpectedArrival)
		arrivalTime = &parsed
	}

	tenantID := tenant.FromContext(r.Context())
	exception, err := rs.ArrivalScheduleService.CreateOrReclaimException(
		r.Context(), student.ID, exceptionDate, arrivalTime, req.Reason, staffID,
		rs.exceptionTakeoverStaffID(r),
	)
	if err != nil {
		renderExceptionWriteError(w, r, err)
		return
	}

	// Deferred to the outer request tx's commit — the service write runs in a
	// nested tx that has NOT committed on return, so neither the staff broadcast
	// nor the guardian wake may fire yet (#1725 review; see the schedules
	// handler above for why pre-commit staff invalidation strands stale data).
	// The guardian wake is what makes the "Heute" tile reflect a staff arrival
	// override (a no-show arrival_absent resolves the tile as absent).
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
		rs.wakeChildGuardians(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusCreated, mapArrivalExceptionToResponse(exception), "Arrival exception created successfully")
}

// updateStudentArrivalException handles PUT /students/{id}/arrival-exceptions/{exceptionId}
func (rs *Resource) updateStudentArrivalException(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "update arrival exceptions")
	if student == nil {
		return
	}

	exceptionID, ok := parseEntityID(w, r, "exceptionId", "exception")
	if !ok {
		return
	}

	existingException := rs.verifyArrivalExceptionOwnership(w, r, exceptionID, student.ID)
	if existingException == nil {
		return
	}

	req := &StudentArrivalExceptionRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	// existingException was the ownership pre-check; the locked re-read inside the
	// service is authoritative for the source/author decision.
	exceptionDate, _ := calendar.ParseDate(req.ExceptionDate)
	var arrivalTime *time.Time
	if req.ExpectedArrival != nil && *req.ExpectedArrival != "" {
		parsed, _ := parseTimeOnly(*req.ExpectedArrival)
		arrivalTime = &parsed
	}

	tenantID := tenant.FromContext(r.Context())
	exception, err := rs.ArrivalScheduleService.UpdateException(
		r.Context(), exceptionID, student.ID, exceptionDate, req.Reason, arrivalTime, req.ClearExpectedArrival,
		rs.exceptionTakeoverStaffID(r),
	)
	if err != nil {
		renderExceptionWriteError(w, r, err)
		return
	}

	// Deferred to the outer request tx's commit so neither the staff broadcast
	// nor the guardian wake can make a client refetch the pre-edit override (the
	// service write runs in a nested tx, not committed on return) (#1725 review).
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
		rs.wakeChildGuardians(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusOK, mapArrivalExceptionToResponse(exception), "Arrival exception updated successfully")
}

// deleteStudentArrivalException handles DELETE /students/{id}/arrival-exceptions/{exceptionId}
func (rs *Resource) deleteStudentArrivalException(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "delete arrival exceptions")
	if student == nil {
		return
	}

	exceptionID, ok := parseEntityID(w, r, "exceptionId", "exception")
	if !ok {
		return
	}

	existingException := rs.verifyArrivalExceptionOwnership(w, r, exceptionID, student.ID)
	if existingException == nil {
		return
	}

	tenantID := tenant.FromContext(r.Context())
	if err := rs.ArrivalScheduleService.DeleteStudentArrivalException(r.Context(), exceptionID, student.ID); err != nil {
		renderExceptionWriteError(w, r, err)
		return
	}

	// Deferred to the outer request tx's commit so neither the staff broadcast
	// nor the guardian wake can make a client refetch an override the delete has
	// not committed yet. The native delete joins the request transaction
	// (#1725 review).
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
		rs.wakeChildGuardians(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusOK, nil, "Arrival exception deleted successfully")
}

// createStudentArrivalNote handles POST /students/{id}/arrival-notes
func (rs *Resource) createStudentArrivalNote(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "create arrival notes")
	if student == nil {
		return
	}

	req := &ArrivalNoteRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	staffID, err := rs.getStaffIDFromJWT(r)
	if err != nil {
		renderScheduleAuthorError(w, r, err)
		return
	}

	noteDate, _ := calendar.ParseDate(req.NoteDate)
	note := &careplan.ArrivalNote{
		StudentID: student.ID,
		NoteDate:  careplan.Date(noteDate),
		Content:   req.Content,
		CreatedBy: staffID, EnteredByTraeger: careplan.EnteredByTraeger(r.Context(), staffID),
	}

	tenantID := tenant.FromContext(r.Context())
	if err := withinTenant(r.Context(), tenantID, func(ctx context.Context) error {
		return rs.ArrivalScheduleService.CreateStudentArrivalNote(ctx, note)
	}); err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// After commit, not inline: the handler WithTenantTx above only reuses the
	// still-open TenantTxMiddleware tx, so a client woken here would read the
	// note-less day and never be invalidated again (#1725 review).
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusCreated, mapArrivalNoteToResponse(note), "Arrival note created successfully")
}

// updateStudentArrivalNote handles PUT /students/{id}/arrival-notes/{noteId}
func (rs *Resource) updateStudentArrivalNote(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "update arrival notes")
	if student == nil {
		return
	}

	noteID, ok := parseEntityID(w, r, "noteId", "note")
	if !ok {
		return
	}

	existingNote := rs.verifyArrivalNoteOwnership(w, r, noteID, student.ID)
	if existingNote == nil {
		return
	}

	req := &ArrivalNoteRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	noteDate, _ := calendar.ParseDate(req.NoteDate)
	note := &careplan.ArrivalNote{
		StudentID: student.ID,
		NoteDate:  careplan.Date(noteDate),
		Content:   req.Content,
		CreatedBy: existingNote.CreatedBy, EnteredByTraeger: existingNote.EnteredByTraeger,
	}
	note.ID = noteID
	note.CreatedAt = existingNote.CreatedAt
	note.SetTenantID(existingNote.TenantID)

	tenantID := tenant.FromContext(r.Context())
	if err := withinTenant(r.Context(), tenantID, func(ctx context.Context) error {
		return rs.ArrivalScheduleService.UpdateStudentArrivalNote(ctx, note)
	}); err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// After commit — same nested-tx reason as the create path above.
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusOK, mapArrivalNoteToResponse(note), "Arrival note updated successfully")
}

// deleteStudentArrivalNote handles DELETE /students/{id}/arrival-notes/{noteId}
func (rs *Resource) deleteStudentArrivalNote(w http.ResponseWriter, r *http.Request) {
	student := rs.requireArrivalWriteAccess(w, r, "delete arrival notes")
	if student == nil {
		return
	}

	noteID, ok := parseEntityID(w, r, "noteId", "note")
	if !ok {
		return
	}

	existingNote := rs.verifyArrivalNoteOwnership(w, r, noteID, student.ID)
	if existingNote == nil {
		return
	}

	tenantID := tenant.FromContext(r.Context())
	if err := withinTenant(r.Context(), tenantID, func(ctx context.Context) error {
		return rs.ArrivalScheduleService.DeleteStudentArrivalNote(ctx, noteID)
	}); err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// After commit — same nested-tx reason as the create path above.
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, student.ID)
	})
	common.Respond(w, r, http.StatusOK, nil, "Arrival note deleted successfully")
}

// bulkUpsertArrivalSchedules handles POST /students/arrival-schedules/bulk
func (rs *Resource) bulkUpsertArrivalSchedules(w http.ResponseWriter, r *http.Request) {
	req := &BulkUpsertArrivalScheduleRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	staffID, err := rs.getStaffIDFromJWT(r)
	if err != nil {
		renderScheduleAuthorError(w, r, err)
		return
	}

	tenantID := tenant.FromContext(r.Context())
	result, err := rs.ArrivalScheduleService.BulkUpsertArrivalSchedules(
		r.Context(),
		careplan.ArrivalScheduleBulkFilter{
			SchoolClass: req.SchoolClass,
			GroupID:     req.GroupID.Int64(),
			StudentIDs:  ident.Int64s(req.StudentIDs),
			Authorize: func(ctx context.Context, student careplan.ScheduleStudent) (bool, error) {
				return securityruntime.CanUpdateStudent(ctx, sessiontoken.PermissionsFromCtx(r.Context()), student, rs.UserContextService)
			},
		},
		req.Schedules,
		staffID,
	)
	if err != nil {
		if errors.Is(err, careplan.ErrBulkStudentUnauthorized) {
			renderError(w, r, common.ErrorForbidden(err))
			return
		}
		if errors.Is(err, careplan.ErrBulkStudentNotFound) {
			renderError(w, r, common.ErrorNotFound(err))
			return
		}
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}

	// Deferred to the OUTER request tx's commit: BulkUpsertArrivalSchedules runs
	// inside the TenantTxMiddleware tx, which is still open here, so waking now
	// would let a client refetch before the writes are visible (#1725 review) —
	// true for the staff broadcast and the guardian wake alike, and worst here
	// where one rollback would strand a whole class of stale plans. The guardian
	// fan-out is separate (tenant-wide events never reach the parent SSE stream,
	// #1725) and bounded to the one class.
	affected := result.AffectedStudentIDs
	tenant.RegisterAfterCommit(r.Context(), func() {
		rs.broadcastArrivalScheduleChanged(tenantID, 0)
		for _, studentID := range affected {
			rs.wakeChildGuardians(tenantID, studentID)
		}
	})
	common.Respond(w, r, http.StatusOK, result, "Bulk arrival schedules upserted successfully")
}

type ArrivalScheduleStatusResponse struct {
	StudentIDs []ident.ID `json:"student_ids"`
}

// getBulkArrivalScheduleStatus returns the selected children that have their
// own weekly arrival rows. The class editor uses it for its overwrite hint in
// one request instead of reading every child separately.
func (rs *Resource) getBulkArrivalScheduleStatus(w http.ResponseWriter, r *http.Request) {
	req := &BulkEffectiveTimeRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	authorizedIDs, err := rs.filterAuthorizedStudentIDs(r, ident.Int64s(req.StudentIDs))
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}
	if len(authorizedIDs) == 0 {
		common.Respond(w, r, http.StatusOK, ArrivalScheduleStatusResponse{StudentIDs: []ident.ID{}}, "Bulk arrival schedule status retrieved successfully")
		return
	}

	hasSchedules, err := rs.ArrivalScheduleService.GetStudentsWithStoredArrivalSchedules(r.Context(), authorizedIDs)
	if err != nil {
		renderError(w, r, common.ErrorInternalServer(err))
		return
	}
	studentIDs := make([]int64, 0, len(hasSchedules))
	for _, studentID := range authorizedIDs {
		if hasSchedules[studentID] {
			studentIDs = append(studentIDs, studentID)
		}
	}
	common.Respond(w, r, http.StatusOK, ArrivalScheduleStatusResponse{StudentIDs: ident.IDs(studentIDs)}, "Bulk arrival schedule status retrieved successfully")
}

// ClassArrivalTimesResponse is the current Unterrichtsschluss of one class.
type ClassArrivalTimesResponse struct {
	SchoolClass string            `json:"school_class"`
	Times       map[string]string `json:"times"`
	UpdatedAt   *string           `json:"updated_at,omitempty"`
}

// getClassArrivalTimes handles GET /students/class-arrival-times/{schoolClass}.
// The bulk screen reads it so it opens with what the class already carries
// instead of empty fields (#2414).
func (rs *Resource) getClassArrivalTimes(w http.ResponseWriter, r *http.Request) {
	schoolClass := chi.URLParam(r, "schoolClass")
	times, err := rs.ArrivalScheduleService.GetClassArrivalTimes(r.Context(), schoolClass)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	resp := ClassArrivalTimesResponse{SchoolClass: times.SchoolClass, Times: times.Times}
	if times.UpdatedAt != nil {
		formatted := times.UpdatedAt.Format(time.RFC3339)
		resp.UpdatedAt = &formatted
	}
	common.Respond(w, r, http.StatusOK, resp, "Class arrival times retrieved successfully")
}
