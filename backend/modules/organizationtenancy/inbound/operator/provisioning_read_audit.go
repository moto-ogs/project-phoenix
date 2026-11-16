package operator

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// AuditReadAccess records one bounded access attempt before invoking the reader.
// Only route IDs and the fixed view survive; query strings and payloads do not.
func (rs *ProvisioningResource) AuditReadAccess(view organizationtenancy.OperatorReadView, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := sessiontoken.ClaimsFromCtx(r.Context())
		if claims.ID <= 0 || !claims.IsPlatformScope() {
			common.RenderError(w, r, common.OperatorUnauthorized())
			return
		}
		access := organizationtenancy.OperatorReadAccess{View: view, OperatorID: int64(claims.ID), ClientIP: common.ParseClientIP(r)}
		if !operatorReadTarget(w, r, &access) {
			return
		}
		if err := rs.service.RecordOperatorRead(r.Context(), access); err != nil {
			common.RenderError(w, r, ProvisioningErrorRenderer(err))
			return
		}
		next(w, r)
	}
}

func operatorReadTarget(w http.ResponseWriter, r *http.Request, access *organizationtenancy.OperatorReadAccess) bool {
	if !operatorReadParent(w, r, access) {
		return false
	}
	switch access.View {
	case organizationtenancy.ReadSchoolAccountCaregiver, organizationtenancy.ReadSchoolAccountMFA,
		organizationtenancy.ReadAccountMFA:
		return routeID(w, r, "accountId", "invalid account ID", &access.AccountID)
	case organizationtenancy.ReadAccountTenants:
		// PUT and DELETE change one school access; the list routes name none.
		return routeID(w, r, "accountId", "invalid account ID", &access.AccountID) &&
			optionalRouteID(w, r, "tenantId", "invalid school ID", &access.SchoolID)
	case organizationtenancy.ReadUnregisteredTagScans:
		// POST /{id}/resolve changes one scan; the list route names none.
		return optionalRouteID(w, r, "id", "invalid scan ID", &access.TagScanID)
	default:
		return true
	}
}

// operatorReadParent reads the announcement, school or Träger a view
// belongs to.
func operatorReadParent(w http.ResponseWriter, r *http.Request, access *organizationtenancy.OperatorReadAccess) bool {
	switch access.View {
	case organizationtenancy.ReadAnnouncementViews, organizationtenancy.ReadAnnouncement:
		return routeID(w, r, "id", "invalid announcement ID", &access.AnnouncementID)
	case organizationtenancy.ReadSchoolAccounts, organizationtenancy.ReadSchoolPersons,
		organizationtenancy.ReadSchoolBookingAuthorityImpact,
		organizationtenancy.ReadSchool, organizationtenancy.ReadSchoolAdminInvitation,
		organizationtenancy.ReadSchoolAccountCreation, organizationtenancy.ReadSchoolSettingsSchema,
		organizationtenancy.ReadSchoolSettingReveal,
		organizationtenancy.ReadDemoPresenceHistory,
		organizationtenancy.ReadSchoolAccountMFA, organizationtenancy.ReadSchoolAccountCaregiver:
		return routeID(w, r, "id", "invalid school ID", &access.SchoolID)
	case organizationtenancy.ReadOrganizationAccounts, organizationtenancy.ReadOrganizationPersons,
		organizationtenancy.ReadOrganizationSchools, organizationtenancy.ReadTraegerMembers,
		organizationtenancy.ReadTraegerSettings, organizationtenancy.ReadBelegRetention,
		organizationtenancy.ReadTraegerInvitations, organizationtenancy.ReadTraegerStaffRelease:
		return routeID(w, r, "id", "invalid organization ID", &access.OrganizationID)
	default:
		return true
	}
}

// routeID parses a required route ID and answers 400 when it is malformed.
func routeID(w http.ResponseWriter, r *http.Request, key, message string, target *int64) bool {
	id, ok := common.ParseInt64IDWithError(w, r, key, message)
	if ok {
		*target = id
	}
	return ok
}

// optionalRouteID parses a route ID only when the matched route has one.
func optionalRouteID(w http.ResponseWriter, r *http.Request, key, message string, target *int64) bool {
	if chi.URLParam(r, key) == "" {
		return true
	}
	return routeID(w, r, key, message, target)
}
