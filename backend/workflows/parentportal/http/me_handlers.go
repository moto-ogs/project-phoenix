package parent

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// ParentProfileResponse carries the explicit parents-portal locale choice.
// PortalLocale is null when the guardian has never picked one, so the frontend
// keeps the anonymous cookie/Accept-Language locale instead of snapping to the
// default.
type ParentProfileResponse struct {
	FirstName    string  `json:"first_name"`
	LastName     string  `json:"last_name"`
	PortalLocale *string `json:"portal_locale"`
}

type UpdateParentProfileRequest struct {
	PortalLocale string `json:"portal_locale"`
}

func profileResponse(profile *parentService.Profile) ParentProfileResponse {
	if profile == nil || !profile.Explicit {
		response := ParentProfileResponse{PortalLocale: nil}
		if profile != nil {
			response.FirstName = profile.FirstName
			response.LastName = profile.LastName
		}
		return response
	}
	locale := profile.Locale
	return ParentProfileResponse{
		FirstName:    profile.FirstName,
		LastName:     profile.LastName,
		PortalLocale: &locale,
	}
}

func (rs *Resource) getMyProfile(w http.ResponseWriter, r *http.Request) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(sessiontoken.ErrTokenUnauthorized))
		return
	}

	profile, err := rs.ParentService.GetProfile(r.Context(), int64(claims.ID))
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, profileResponse(profile), "Profile retrieved")
}

func (rs *Resource) updateMyProfile(w http.ResponseWriter, r *http.Request) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(sessiontoken.ErrTokenUnauthorized))
		return
	}

	// The body is a single short locale code; cap it so a malicious or buggy
	// client can't stream an unbounded payload into the decoder.
	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	req := UpdateParentProfileRequest{}
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if req.PortalLocale == "" {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("portal_locale is required")))
		return
	}
	// Reject unknown locales instead of letting the service silently coerce them
	// to the default — a bad value should fail loudly, not persist as 'de'.
	if rs.SupportedLocale == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("locale validation is not configured")))
		return
	}
	if !rs.SupportedLocale(req.PortalLocale) {
		common.RenderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("unsupported portal_locale %q", req.PortalLocale)))
		return
	}

	profile, err := rs.ParentService.UpdatePortalLocale(r.Context(), int64(claims.ID), req.PortalLocale)
	if err != nil {
		// A composition without account-locale persistence still requires a
		// guardian profile. Surface its absence as a state conflict; the
		// service already logged the account_id.
		if errors.Is(err, parentService.ErrGuardianProfileNotFound) {
			common.RenderError(w, r, common.ErrorConflict(err))
			return
		}
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, profileResponse(profile), "Profile updated")
}

// ChildResponse is the wire shape for one row in the /me/children
// list. Mirrors the workflow child projection but stringifies int64 IDs
// per the project's frontend convention (Rule 4 in CLAUDE.md).
type ChildResponse struct {
	StudentID     string         `json:"student_id"`
	TenantID      string         `json:"tenant_id"`
	FirstName     string         `json:"first_name"`
	LastName      string         `json:"last_name"`
	SchoolClass   string         `json:"school_class,omitempty"`
	Status        string         `json:"status"`
	EnrolledFrom  *careplan.Date `json:"enrolled_from,omitempty"`
	EnrolledUntil *careplan.Date `json:"enrolled_until,omitempty"`
	SchoolName    string         `json:"school_name"`
	SchoolSlug    string         `json:"school_slug"`
	// CareEnded says the school has ended this child's care (#2487). Derived
	// on the server so the portal never has to do date arithmetic to decide
	// whether to show a card as read-only. The exit REASON is deliberately not
	// part of this response: it is a staff-internal note behind users:delete.
	CareEnded bool `json:"care_ended"`
	// WithoutCarePlace says the child belongs to its class but has no OGS
	// place (#4803, ADR 0282): the portal shows no OGS function for it.
	WithoutCarePlace bool `json:"without_care_place,omitempty"`
}

func toChildResponse(c *parentService.ChildSummary, today timezone.Date) ChildResponse {
	return ChildResponse{
		StudentID:        strconv.FormatInt(c.StudentID, 10),
		TenantID:         strconv.FormatInt(c.TenantID, 10),
		FirstName:        c.FirstName,
		LastName:         c.LastName,
		SchoolClass:      c.SchoolClass,
		Status:           c.Status,
		EnrolledFrom:     parentResponseDatePointer(c.EnrolledFrom),
		EnrolledUntil:    parentResponseDatePointer(c.EnrolledUntil),
		SchoolName:       c.SchoolName,
		SchoolSlug:       c.SchoolSlug,
		CareEnded:        c.CareEnded(today),
		WithoutCarePlace: c.WithoutCarePlace,
	}
}

// The workflow uses calendar.Date. The established wire contract renders an
// unset non-null date as "", not calendar.Date's null representation.
func parentResponseDate(day timezone.Date) careplan.Date { return careplan.Date(day.String()) }

func parentResponseDatePointer(day *timezone.Date) *careplan.Date {
	if day == nil {
		return nil
	}
	value := parentResponseDate(*day)
	return &value
}

// listMyChildren returns every student linked to the calling parent's
// account, across every active tenant mapping. Auth: parent-scope JWT
// (enforced by ParentScopeMiddleware on the route group). The handler
// reads claims.ID for the account id — never trusts a query param or
// body field for it.
func (rs *Resource) listMyChildren(w http.ResponseWriter, r *http.Request) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(sessiontoken.ErrTokenUnauthorized))
		return
	}

	children, err := rs.ParentService.ListChildrenForAccount(r.Context(), int64(claims.ID))
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	today := timezone.DateFromTime(rs.Now())
	out := make([]ChildResponse, 0, len(children))
	for _, c := range children {
		out = append(out, toChildResponse(c, today))
	}

	common.Respond(w, r, http.StatusOK, out, "Children retrieved")
}

// EnrollablePhaseResponse is the wire shape for /me/enrollable-schools.
// Mirrors the workflow enrollable-phase projection; identifiers travel as
// strings (ident.ID).
type EnrollablePhaseResponse struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	SchoolSlug string   `json:"school_slug"`
	// SchoolSubdomain is the identifier the picker must put in enrollment
	// links: both /auth/tenant/resolve and /api/parent/enrollments/{tenantSlug}/*
	// resolve tenants by subdomain (#1663).
	SchoolSubdomain string   `json:"school_subdomain"`
	PhaseID         ident.ID `json:"phase_id"`
	PhaseName       string   `json:"phase_name"`
	// PhaseNameTranslations maps locale → translated phase name (#3377).
	PhaseNameTranslations map[string]string `json:"phase_name_translations,omitempty"`
	PhaseKind             string            `json:"phase_kind"`
	ServiceStartDate      careplan.Date     `json:"service_start_date" contract:"date"`
	ServiceEndDate        careplan.Date     `json:"service_end_date" contract:"date"`
	EnrollmentOpenAt      *time.Time        `json:"enrollment_open_at,omitempty"`
	EnrollmentCloseAt     *time.Time        `json:"enrollment_close_at,omitempty"`
	AlreadyLinked         bool              `json:"already_linked"`
	Audience              string            `json:"audience"`
}

// listEnrollableSchools returns every (school, open phase) pair the
// parent can submit a new enrollment to, with a flag indicating
// whether they already have a child at that school. Auth: parent
// scope, claims.ID for account_id.
func (rs *Resource) listEnrollableSchools(w http.ResponseWriter, r *http.Request) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(sessiontoken.ErrTokenUnauthorized))
		return
	}

	phases, err := rs.ParentService.ListEnrollableForAccount(r.Context(), int64(claims.ID))
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	out := make([]EnrollablePhaseResponse, 0, len(phases))
	for _, p := range phases {
		out = append(out, EnrollablePhaseResponse{
			SchoolID:              ident.ID(p.SchoolID),
			SchoolName:            p.SchoolName,
			SchoolSlug:            p.SchoolSlug,
			SchoolSubdomain:       p.SchoolSubdomain,
			PhaseID:               ident.ID(p.PhaseID),
			PhaseName:             p.PhaseName,
			PhaseNameTranslations: p.PhaseNameTranslations,
			PhaseKind:             p.PhaseKind,
			ServiceStartDate:      parentResponseDate(p.ServiceStartDate),
			ServiceEndDate:        parentResponseDate(p.ServiceEndDate),
			EnrollmentOpenAt:      p.EnrollmentOpenAt,
			EnrollmentCloseAt:     p.EnrollmentCloseAt,
			AlreadyLinked:         p.AlreadyLinked,
			Audience:              p.Audience,
		})
	}

	common.Respond(w, r, http.StatusOK, out, "Enrollable phases retrieved")
}
