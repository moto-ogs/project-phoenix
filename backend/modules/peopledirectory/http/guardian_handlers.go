package users

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

var validPhoneTypes = map[string]bool{"mobile": true, "home": true, "work": true, "other": true}

// minGuardianPickerQueryLength is the server-side floor for picker searches
// so a non-admin cannot enumerate the guardian pool one character at a
// time. A shorter query returns an empty page, not a 400. It counts the
// characters left after accents are folded away, as the name search matches
// them, so accent marks alone do not clear it (#4949).
const minGuardianPickerQueryLength = 3

// pickerQueryLength counts the characters of a picker query that the name
// search can match: accents are folded away and every combining mark,
// enclosing ones included, and all white space are left out, as unaccent
// drops them in the database (#4949).
func pickerQueryLength(search string) int {
	length := 0
	for _, r := range collation.FoldForSearch(search) {
		if !unicode.IsMark(r) && !unicode.IsSpace(r) {
			length++
		}
	}
	return length
}

// maxGuardianPickerResults is the hard ceiling of one picker search: the
// picker is a type-to-narrow lookup, never real pages, so there is no OFFSET
// and the requested page_size is clamped.
const maxGuardianPickerResults = 50

func (rs *GuardianResource) searchGuardiansForPicker(w http.ResponseWriter, r *http.Request) {
	page, pageSize := rs.runtime.ParsePagination(r)
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	if pickerQueryLength(search) < minGuardianPickerQueryLength {
		rs.runtime.SuccessPaginated(w, r, http.StatusOK, []*GuardianPickerResponse{}, Pagination{Page: page, PageSize: pageSize, Total: 0}, "Guardians retrieved successfully")
		rs.runtime.ObserveResponse(http.StatusOK, "none")
		return
	}
	limit := min(pageSize, maxGuardianPickerResults)
	matches, err := rs.directory.SearchGuardians(r.Context(), search, limit)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	responses := make([]*GuardianPickerResponse, 0, len(matches))
	for _, match := range matches {
		responses = append(responses, &GuardianPickerResponse{
			ID: ident.ID(match.Guardian.ID), FirstName: match.Guardian.FirstName, LastName: match.Guardian.LastName,
			Email: match.Guardian.Email, LinkedChildrenCount: match.LinkedChildrenCount,
		})
	}
	// The envelope reports the clamped limit, the size that was applied.
	rs.runtime.SuccessPaginated(w, r, http.StatusOK, responses, Pagination{Page: page, PageSize: limit, Total: len(responses)}, "Guardians retrieved successfully")
	rs.runtime.ObserveResponse(http.StatusOK, "none")
}

func (rs *GuardianResource) getGuardian(w http.ResponseWriter, r *http.Request) {
	id, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	guardian, err := rs.directory.FindGuardian(r.Context(), id)
	if err != nil {
		rs.guardianLookupFailure(w, r, err)
		return
	}
	rs.succeed(w, r, http.StatusOK, newGuardianResponse(guardian), "Guardian retrieved successfully")
}

// guardianLookupFailure renders a missing guardian as the historical 404
// message and everything else through the module classification.
func (rs *GuardianResource) guardianLookupFailure(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, peopledirectory.ErrGuardianNotFound) {
		rs.failMessage(w, r, FailureNotFound, msgGuardianNotFound)
		return
	}
	rs.moduleFailure(w, r, err)
}

func (rs *GuardianResource) createGuardian(w http.ResponseWriter, r *http.Request) {
	// Admins create freely; everyone else must be verified staff (#2329).
	if !rs.runtime.IsAdmin(r) && !rs.runtime.IsVerifiedStaff(r.Context()) {
		rs.failMessage(w, r, FailureForbidden, "only staff members can create guardian profiles")
		return
	}
	req := &GuardianCreateRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	guardian, err := rs.directory.CreateGuardian(r.Context(), peopledirectory.GuardianInput{
		FirstName: req.FirstName, LastName: req.LastName, Email: req.Email,
		AddressStreet: req.AddressStreet, AddressCity: req.AddressCity, AddressPostalCode: req.AddressPostalCode,
		PreferredContactMethod: req.PreferredContactMethod, LanguagePreference: req.LanguagePreference, Notes: req.Notes,
	})
	if err != nil {
		// A duplicate e-mail (or other bad input) is a 400 carrying the German
		// message; the tenant transaction has already rolled back.
		rs.moduleFailure(w, r, err)
		return
	}
	rs.succeed(w, r, http.StatusCreated, newGuardianResponse(guardian), "Guardian created successfully")
}

// refuseUnversionedEdit answers the single-field edit routes the staff form
// used before it saved a guardian as one entry (ADR 0311). They carry no read
// state, so a tab opened before the release is refused and shows the stored
// state; the routes go after one release (ADR 0270, #7953).
func (rs *GuardianResource) refuseUnversionedEdit(w http.ResponseWriter, r *http.Request) {
	rs.fail(w, r, FailureConflict, readstate.ErrChanged)
}

// guardianFullDeleteWarning describes what a full delete WOULD do, so it
// reads correctly both as the preview hint and as the admin 409 body.
func guardianFullDeleteWarning(names []string) string {
	switch len(names) {
	case 0:
		return "Die Person ist mit keinem Kind verknüpft und wird mit dem Profil vollständig gelöscht."
	case 1:
		return "Die Person ist nur mit diesem Kind verknüpft und wird mit dem Profil vollständig gelöscht."
	default:
		return fmt.Sprintf("Die Person ist mit %d Kindern verknüpft und wird bei allen entfernt: %s.", len(names), strings.Join(names, ", "))
	}
}

func linkIDs(ids []int64) []ident.ID {
	out := make([]ident.ID, len(ids))
	for i, id := range ids {
		out[i] = ident.ID(id)
	}
	return out
}

// guardianDeletePreview is read-only and admin-only: a full delete reaches
// across siblings the caller may not supervise (#819).
func (rs *GuardianResource) guardianDeletePreview(w http.ResponseWriter, r *http.Request) {
	id, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	if !rs.runtime.IsAdmin(r) {
		rs.failMessage(w, r, FailureForbidden, "only administrators can preview a full guardian delete")
		return
	}
	impact, err := rs.directory.GuardianDeleteImpact(r.Context(), id)
	if err != nil {
		if !impact.GuardianFound {
			rs.guardianLookupFailure(w, r, err)
		} else {
			rs.moduleFailure(w, r, err)
		}
		return
	}
	rs.succeed(w, r, http.StatusOK, &GuardianDeletePreview{
		LinkedCount:     len(impact.StudentNames),
		AffectedNames:   impact.StudentNames,
		AffectedLinkIDs: linkIDs(impact.LinkIDs),
		Warning:         guardianFullDeleteWarning(impact.StudentNames),
	}, "Guardian delete preview retrieved successfully")
}

func parseExpectedGuardianLinkIDs(r *http.Request) ([]int64, error) {
	raw := strings.TrimSpace(strings.Join(r.URL.Query()["expected_link_ids"], ","))
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	ids := make([]int64, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			return nil, errors.New("expected_link_ids must contain only numeric IDs")
		}
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return nil, errors.New("expected_link_ids must contain only positive numeric IDs")
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// deleteGuardian removes a guardian. "force" requests the deliberate full
// delete (guardian plus every link); without it a linked guardian is refused
// with a 409 listing the affected children. The single-student unlink lives
// at DELETE /students/{id}/guardians/{gid}.
func (rs *GuardianResource) deleteGuardian(w http.ResponseWriter, r *http.Request) {
	id, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyGuardian(r, id); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	force := r.URL.Query().Get("force") == "true"
	isAdmin := rs.runtime.IsAdmin(r)
	hasLinks, err := rs.directory.EvaluateGuardianDelete(r.Context(), id, force, isAdmin)
	if err != nil {
		rs.renderGuardianDeleteError(w, r, err, isAdmin)
		return
	}
	expectedLinkIDs, err := parseExpectedGuardianLinkIDs(r)
	if err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	if err := rs.directory.DeleteGuardian(r.Context(), peopledirectory.GuardianDelete{
		GuardianID: id, ActorAccountID: accountID, WithLinks: hasLinks, ExpectedLinkIDs: expectedLinkIDs,
	}); err != nil {
		rs.renderGuardianDeleteError(w, r, err, isAdmin)
		return
	}
	rs.succeed(w, r, http.StatusOK, nil, "Guardian deleted successfully")
}

// renderGuardianDeleteError keeps the two distinct German conflict messages:
// the admin warning lists the affected children, the non-admin one does not.
func (rs *GuardianResource) renderGuardianDeleteError(w http.ResponseWriter, r *http.Request, err error, isAdmin bool) {
	var stillLinked *peopledirectory.GuardianStillLinkedError
	switch {
	case errors.As(err, &stillLinked):
		message := msgGuardianStillLinked
		if isAdmin {
			message = guardianFullDeleteWarning(stillLinked.StudentNames)
		}
		rs.failMessage(w, r, FailureConflict, message)
	case errors.Is(err, peopledirectory.ErrGuardianForceDeleteRequiresAdmin):
		rs.fail(w, r, FailureForbidden, err)
	case errors.Is(err, peopledirectory.ErrGuardianLinkConflict):
		// A link added between the check and the delete trips the RESTRICT
		// constraint; surface it as the same 409 rather than a 500.
		rs.runtime.MarkRollback(r.Context())
		rs.failMessage(w, r, FailureConflict, msgGuardianStillLinked)
	case errors.Is(err, peopledirectory.ErrGuardianNotFound):
		rs.fail(w, r, FailureNotFound, err)
	default:
		// Nothing of a delete that failed otherwise stays: a business
		// rejection such as a stale preview (ADR 0311) answers 409, which
		// the request transaction would commit.
		rs.runtime.MarkRollback(r.Context())
		rs.fail(w, r, FailureInternal, err)
	}
}

// sendInvitation is the staff-initiated per-guardian invitation. The raw
// token is exposed to the local seeder only.
func (rs *GuardianResource) sendInvitation(w http.ResponseWriter, r *http.Request) {
	guardianID, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	invitation, err := rs.runtime.SendInvitation(r.Context(), guardianID, accountID)
	if err != nil {
		rs.fail(w, r, FailureInternal, err)
		return
	}
	response := GuardianInvitationResponse{
		ID:                ident.ID(invitation.ID),
		GuardianProfileID: ident.ID(invitation.GuardianProfileID),
		ExpiresAt:         invitation.ExpiresAt,
		EmailSent:         invitation.EmailSent,
	}
	if rs.runtime.ExposeInvitationToken(r) {
		response.Token = invitation.Token
	}
	rs.succeed(w, r, http.StatusCreated, response, "Invitation sent successfully")
}

// --- relationship handlers ---

// getStudentGuardians lists a child's guardians; everyone with users:read
// may view them for emergencies. The payer mark needs the financial
// permission.
func (rs *GuardianResource) getStudentGuardians(w http.ResponseWriter, r *http.Request) {
	canSeePayment := rs.runtime.HasPermission(r, permissions.GuardiansFinancial)
	studentID, ok := rs.parseStudentID(w, r)
	if !ok {
		return
	}
	if _, active := rs.activeStudent(r.Context(), studentID); !active {
		rs.failMessage(w, r, FailureNotFound, msgStudentNotFound)
		return
	}
	rows, err := rs.directory.ListStudentGuardians(r.Context(), studentID)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	responses := make([]*GuardianWithRelationship, 0, len(rows))
	for _, row := range rows {
		responses = append(responses, newGuardianWithRelationship(row, canSeePayment))
	}
	rs.succeed(w, r, http.StatusOK, responses, "Student guardians retrieved successfully")
}

// newGuardianWithRelationship is one row of a child's guardian list with the
// version a save of the staff form sends back.
func newGuardianWithRelationship(row peopledirectory.GuardianWithLink, canSeePayment bool) *GuardianWithRelationship {
	return &GuardianWithRelationship{
		Guardian:           newGuardianResponse(row.Guardian),
		RelationshipID:     ident.ID(row.Link.ID),
		RelationshipType:   row.Link.RelationshipType,
		GuardianRole:       row.Link.GuardianRole,
		IsPrimary:          row.Link.IsPrimary,
		IsEmergencyContact: row.Link.IsEmergencyContact,
		CanPickup:          row.Link.CanPickup,
		PickupNotes:        row.Link.PickupNotes,
		PickupWeekdays:     row.Link.PickupWeekdays,
		EmergencyPriority:  row.Link.EmergencyPriority,
		IsPayer:            canSeePayment && row.Link.IsPayer,
		AccountStatus: guardianAccountStatus(
			row.Guardian.HasAccount,
			row.Link.HasPermission(peopledirectory.GuardianPermissionPortalAccess),
			row.InvitationPending,
			row.InvitationLinkEnded,
		),
		Version: peopledirectory.GuardianEntryVersion(row),
	}
}

// updateStudentGuardian saves the staff form of a child's guardian in one
// unit of work: profile, this child's link and the phone list, refused when
// the form read an older state (ADR 0311). The answer is the stored row with
// its new version.
func (rs *GuardianResource) updateStudentGuardian(w http.ResponseWriter, r *http.Request) {
	studentID, ok := rs.parseStudentID(w, r)
	if !ok {
		return
	}
	guardianID, ok := rs.parseIDParam(w, r, "guardianId", msgInvalidGuardianID)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	if canModify, err := rs.canModifyGuardian(r, guardianID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	req := &GuardianEntryRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	if err := rs.directory.UpdateGuardianEntry(r.Context(), req.edit(studentID, guardianID)); err != nil {
		// A refusal after the profile write must not keep it.
		rs.runtime.MarkRollback(r.Context())
		rs.moduleFailure(w, r, err)
		return
	}
	rs.respondStudentGuardian(w, r, studentID, guardianID)
}

// respondStudentGuardian answers the saved row as the list reads it.
func (rs *GuardianResource) respondStudentGuardian(w http.ResponseWriter, r *http.Request, studentID, guardianID int64) {
	rows, err := rs.directory.ListStudentGuardians(r.Context(), studentID)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	for _, row := range rows {
		if row.Guardian.ID == guardianID {
			canSeePayment := rs.runtime.HasPermission(r, permissions.GuardiansFinancial)
			rs.succeed(w, r, http.StatusOK, newGuardianWithRelationship(row, canSeePayment), "Guardian saved successfully")
			return
		}
	}
	rs.failMessage(w, r, FailureNotFound, msgRelationshipNotFound)
}

func (rs *GuardianResource) linkGuardianToStudent(w http.ResponseWriter, r *http.Request) {
	studentID, ok := rs.parseStudentID(w, r)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	req := &StudentGuardianLinkRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	link, err := rs.directory.LinkGuardianToStudent(r.Context(), peopledirectory.LinkGuardian{
		StudentID: studentID, GuardianProfileID: req.GuardianProfileID.Int64(),
		RelationshipType: req.RelationshipType, GuardianRole: req.GuardianRole,
		IsPrimary: req.IsPrimary, IsEmergencyContact: req.IsEmergencyContact, CanPickup: req.CanPickup,
		PickupNotes: req.PickupNotes, EmergencyPriority: req.EmergencyPriority,
	})
	if err != nil {
		// The legacy handler answered every link failure as a 500; a missing
		// guardian or student keeps that status so the screens stay unchanged.
		rs.fail(w, r, FailureInternal, err)
		return
	}
	rs.succeed(w, r, http.StatusCreated, newGuardianLinkResponse(link), "Guardian linked to student successfully")
}

// createStudentGuardians atomically creates or links one or more guardians
// for an existing student (#819). Existing-profile links need users:update;
// a batch that creates a profile additionally needs users:create.
func (rs *GuardianResource) createStudentGuardians(w http.ResponseWriter, r *http.Request) {
	studentID, ok := rs.parseStudentID(w, r)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	req := &CreateStudentGuardiansRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	if batchCreatesGuardian(req.Guardians) && !rs.runtime.HasPermission(r, permissions.UsersCreate) {
		rs.failMessage(w, r, FailureForbidden, "forbidden")
		return
	}
	if err := rs.directory.AddGuardiansToStudent(r.Context(), studentID, req.Guardians); err != nil {
		// Validation runs before any write, so bad input means nothing was
		// persisted; everything else rolled the transaction back.
		if errors.Is(err, peopledirectory.ErrInvalidGuardian) {
			rs.fail(w, r, FailureInvalidRequest, err)
			return
		}
		rs.fail(w, r, FailureInternal, err)
		return
	}
	rs.succeed(w, r, http.StatusCreated, nil, "Guardians added successfully")
}

func batchCreatesGuardian(guardians []peopledirectory.NewStudentGuardian) bool {
	for _, guardian := range guardians {
		if guardian.CreatesProfile() {
			return true
		}
	}
	return false
}

func (rs *GuardianResource) removeGuardianFromStudent(w http.ResponseWriter, r *http.Request) {
	studentID, ok := rs.parseStudentID(w, r)
	if !ok {
		return
	}
	guardianID, ok := rs.parseIDParam(w, r, "guardianId", msgInvalidGuardianID)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyStudent(r, studentID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	accountID, ok := rs.actingAccountID(w, r)
	if !ok {
		return
	}
	// Unlinking the child's payer clears the payer mark, which belongs to
	// guardians:financial (#2608); the owner refuses it for everyone else.
	if err := rs.directory.RemoveGuardianFromStudent(r.Context(), peopledirectory.RemoveGuardian{
		StudentID: studentID, GuardianProfileID: guardianID, ActorAccountID: accountID,
		MayClearPayer: rs.runtime.HasPermission(r, permissions.GuardiansFinancial),
	}); err != nil {
		if errors.Is(err, peopledirectory.ErrPayerRemovalRequiresFinancial) {
			rs.fail(w, r, FailureForbidden, err)
			return
		}
		rs.fail(w, r, FailureInternal, err)
		return
	}
	rs.succeed(w, r, http.StatusOK, nil, "Guardian removed from student successfully")
}

// --- phone number handlers ---

func (rs *GuardianResource) listGuardianPhoneNumbers(w http.ResponseWriter, r *http.Request) {
	guardianID, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	phones, err := rs.directory.ListGuardianPhones(r.Context(), guardianID)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	responses := make([]*PhoneNumberResponse, 0, len(phones))
	for _, phone := range phones {
		responses = append(responses, newPhoneNumberResponse(phone))
	}
	rs.succeed(w, r, http.StatusOK, responses, "Phone numbers retrieved successfully")
}

func (rs *GuardianResource) addPhoneNumber(w http.ResponseWriter, r *http.Request) {
	guardianID, ok := rs.parseGuardianID(w, r)
	if !ok {
		return
	}
	if canModify, err := rs.canModifyGuardian(r, guardianID); !canModify {
		rs.fail(w, r, FailureForbidden, err)
		return
	}
	req := &PhoneNumberCreateRequest{}
	if err := render.Bind(r, req); err != nil {
		rs.fail(w, r, FailureInvalidRequest, err)
		return
	}
	phone, err := rs.directory.AddGuardianPhone(r.Context(), guardianID, peopledirectory.GuardianPhoneInput{
		PhoneNumber: req.PhoneNumber, PhoneType: req.PhoneType, Label: req.Label, IsPrimary: req.IsPrimary,
	})
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	rs.succeed(w, r, http.StatusCreated, newPhoneNumberResponse(phone), "Phone number added successfully")
}
