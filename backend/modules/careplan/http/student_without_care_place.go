package careplanhttp

import (
	"context"
	"errors"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// Keys of the Settings Platform registry that decide whether the school keeps
// children without an OGS place (#4803, ADR 0282). tenant_settings_test.go
// pins them to the owner's public names.
const (
	settingModuleUnterrichtVormittag = "module.unterricht_vormittag"
	settingChildrenWithoutCarePlace  = "operations.children_without_care_place"
)

// ErrWithoutCarePlaceCareData refuses OGS care data (group, arrival or
// pickup times) for a child without an OGS place.
var ErrWithoutCarePlaceCareData = errors.New("a child without an OGS place has no group and no arrival or pickup times")

// errWithoutCarePlaceOff refuses a child without an OGS place while the
// school's switch is off or Unterricht am Vormittag is not booked.
var errWithoutCarePlaceOff = errors.New("this school does not keep children without an OGS place")

// studentRequestError maps a refused create request onto its response.
func studentRequestError(err error) render.Renderer {
	if errors.Is(err, ErrWithoutCarePlaceCareData) {
		return common.ErrorInvalidRequestWithCode(err, common.CodeStudentsWithoutCarePlaceGroup)
	}
	return common.ErrorInvalidRequest(err)
}

// withoutCarePlaceRefusal answers a create request for a child without an
// OGS place when the school does not keep such children; nil lets it pass.
// A read error is an error, never a verdict.
func (rs *Resource) withoutCarePlaceRefusal(ctx context.Context, req *StudentRequest) render.Renderer {
	if !req.WithoutCarePlace {
		return nil
	}
	on, err := childrenWithoutCarePlaceOn(ctx, rs.SettingsService)
	if err != nil {
		return common.ErrorInternalServer(err)
	}
	if !on {
		return common.ErrorConflictWithCode(errWithoutCarePlaceOff, common.CodeStudentsWithoutCarePlaceOff)
	}
	return nil
}

// childrenWithoutCarePlaceOn reads the school's switch and the module it
// needs; both must be on.
func childrenWithoutCarePlaceOn(ctx context.Context, settings TenantSettings) (bool, error) {
	if settings == nil {
		return false, errors.New("student routes: settings are not configured")
	}
	for _, key := range []string{settingModuleUnterrichtVormittag, settingChildrenWithoutCarePlace} {
		on, err := settings.ResolveBool(ctx, key)
		if err != nil || !on {
			return false, err
		}
	}
	return true, nil
}
