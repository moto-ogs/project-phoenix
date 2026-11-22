package studentpresencehttp

import (
	errors "errors"
	fmt "fmt"
	http "net/http"

	common "github.com/moto-ogs/project-phoenix/api/common"

	sessiontoken "github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
)

// getStaffIDFromJWT extracts the staff ID from JWT claims by looking up the
// person and staff. An account without either is refused with
// errPersonNotFoundForAccount or errUserNotStaff; a failed lookup is returned
// wrapped, so callers can tell the caller's gap from the server's.
func (rs *Resource) getStaffIDFromJWT(r *http.Request) (int64, error) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		return 0, errNoSessionAccount
	}

	// Get person from account ID
	person, err := rs.PeopleDirectory.FindPersonByAccount(r.Context(), int64(claims.ID))
	if err != nil {
		if errors.Is(err, peopleModule.ErrPersonNotFound) {
			return 0, errPersonNotFoundForAccount
		}
		return 0, fmt.Errorf("find person by account: %w", err)
	}

	// Get staff from person ID
	staffID, found, err := rs.Persons.StaffIDForPerson(r.Context(), person.ID)
	if err != nil {
		return 0, fmt.Errorf("find staff by person: %w", err)
	}
	if !found {
		return 0, errUserNotStaff
	}

	return staffID, nil
}

// renderSchoolCheckinActorError answers a failed resolution of who checks a
// child in or out. Checking in stays with the school's own staff: the
// attendance row names the person responsible on site (ADR 0089), so an
// account without a staff record, a Träger-Büro session included, gets its
// own code (#7818). A failed lookup is the server's (500) and must not read
// as a missing right.
func renderSchoolCheckinActorError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errPersonNotFoundForAccount), errors.Is(err, errUserNotStaff):
		common.RenderError(w, r, common.ErrorForbiddenWithCode(err, common.CodeAttendanceCheckinStaffProfileRequired))
	case errors.Is(err, errNoSessionAccount):
		common.RenderError(w, r, common.ErrorForbidden(err))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
