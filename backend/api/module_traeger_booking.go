package api

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	settings "github.com/moto-ogs/project-phoenix/modules/settings"
	settingsRecords "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// traegerModuleGateKey carries the lock of the Träger portal (#6052) from
// the router-wide middleware to TraegerScopeMiddleware.
type traegerModuleGateKey struct{}

// TraegerBookedModules answers the modules that count as booked for a
// Träger, in catalog order (#6052). The switches are per school and the
// Träger portal spans the schools of its Träger, so a module counts once at
// least one of them books it, as the parents portal stays open while one
// guardian school books Eltern-App (#4895). A failed read is an error, never
// a booking decision. The settings system serves it with
// settings.TraegerModuleBooking.
type TraegerBookedModules interface {
	BookedModules(ctx context.Context, organizationID int64) ([]settings.ModuleKey, error)
}

// NewTraegerBookedModules binds the answer to the school set of Organisation
// & Tenancy and the module switches of the settings system. A deactivated,
// deleted or unknown Träger is traegerview.ErrTraegerUnavailable, as for the
// Träger projection. Both sources are required: a missing one is a
// composition error and stops the start, never an open lock. Only a
// route-sized test router hands a nil answer to the locks itself.
func NewTraegerBookedModules(organizations organizationtenancy.TraegerMembershipQuery, switches settings.ModuleBatchReader) TraegerBookedModules {
	if organizations == nil || switches == nil {
		panic("module lock of the Träger portal: the schools of a Träger and the settings reader are required")
	}
	booking, err := settings.NewTraegerModuleBooking(traegerSchoolIDs{organizations: organizations}, switches)
	if err != nil {
		panic(err)
	}
	return booking
}

// requireTraegerModuleBooked answers nil while the Träger counts module as
// booked and *settings.ModuleNotBookedError naming the Träger otherwise.
//
// It reads in administrative units of its own: the caller may run in a
// Träger transaction, whose row security hides the settings of the schools
// (ADR 0105).
func requireTraegerModuleBooked(ctx context.Context, booked TraegerBookedModules, organizationID int64, module settings.ModuleKey) error {
	modules, err := booked.BookedModules(tenant.ContextWithoutTransaction(ctx), organizationID)
	if err != nil {
		return err
	}
	if !slices.Contains(modules, module) {
		return &settings.ModuleNotBookedError{OrganizationID: organizationID, Module: module}
	}
	return nil
}

// requireTraegerModule refuses a Träger-portal request whose module none of
// the Träger's schools books with 403 module.not_booked (#6052); the module
// key travels in details so the portal explains the missing module. A
// failed read is a server error. Without a requirement (Basis) or without
// the gate (route-sized test routers) the request passes.
func requireTraegerModule(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requirement, ok := r.Context().Value(moduleRequirementKey{}).(moduleRequirement)
		booked, gated := r.Context().Value(traegerModuleGateKey{}).(TraegerBookedModules)
		organizationID := tenant.OrgFromContext(r.Context())
		if !ok || !gated || booked == nil || organizationID <= 0 {
			next.ServeHTTP(w, r)
			return
		}
		err := requireTraegerModuleBooked(r.Context(), booked, organizationID, requirement.module)
		var notBooked *settings.ModuleNotBookedError
		switch {
		case errors.As(err, &notBooked):
			common.RenderError(w, r, moduleNotBookedResponse(notBooked))
		case errors.Is(err, traegerview.ErrTraegerUnavailable):
			// A deactivated or deleted Träger has no session to serve, as
			// the frame of the portal answers.
			common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		case err != nil:
			common.RenderError(w, r, common.ErrorInternalServerWrap("module booking of the Träger could not be read", err))
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// traegerFrameModules binds the frame of the Träger portal to the booked
// modules of its Träger (#6052): the portal locks its navigation and
// explains a page with them. Without the gate (route-sized test routers)
// every module of the catalog counts as booked, as the lock passes there.
func traegerFrameModules(booked TraegerBookedModules) func(context.Context, int64) ([]string, error) {
	return func(ctx context.Context, organizationID int64) ([]string, error) {
		modules := []settings.ModuleKey{}
		if booked == nil {
			for _, module := range settingsRecords.Modules() {
				modules = append(modules, module.Key)
			}
		} else {
			var err error
			if modules, err = booked.BookedModules(tenant.ContextWithoutTransaction(ctx), organizationID); err != nil {
				return nil, err
			}
		}
		keys := make([]string, len(modules))
		for i, module := range modules {
			keys[i] = string(module)
		}
		return keys, nil
	}
}
