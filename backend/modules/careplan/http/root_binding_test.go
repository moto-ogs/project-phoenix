package careplanhttp_test

import (
	"github.com/moto-ogs/project-phoenix/api"
	careplanhttp "github.com/moto-ogs/project-phoenix/modules/careplan/http"
)

// testResource binds the configuration the way the students mount does
// (api.NewStudentHTTPResources), keeping a test's own absence callback. A
// test that sets no clock runs on the package's fixed school day.
func testResource(cfg careplanhttp.ResourceConfig) *careplanhttp.Resource {
	if cfg.Now == nil {
		cfg.Now = fixedCalendarClock
	}
	bound := api.NewCareHTTPUnitResource(cfg)
	if cfg.NotifyAbsenceReported != nil {
		bound.NotifyAbsenceReported = cfg.NotifyAbsenceReported
	}
	return careplanhttp.NewResource(bound.ResourceConfig)
}
