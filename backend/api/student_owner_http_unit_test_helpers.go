//go:build testhooks

package api

import (
	"time"

	care "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	people "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
	projection "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	review "github.com/moto-ogs/project-phoenix/modules/requestreview/http"
	presence "github.com/moto-ogs/project-phoenix/modules/studentpresence/http"
	delete "github.com/moto-ogs/project-phoenix/workflows/studentdeletion/http"
)

func NewCareHTTPUnitResource(cfg care.ResourceConfig) *care.Resource {
	_, subject, _, _, _, _ := NewStudentHTTPResources(people.ResourceConfig{Now: time.Now}, cfg, projection.ResourceConfig{}, presence.ResourceConfig{}, delete.ResourceConfig{}, review.ResourceConfig{})
	return subject
}

// unusedCareResource is the care half the unit builders bind alongside and
// never serve; it needs a clock to be built.
var unusedCareResource = care.ResourceConfig{Now: time.Now}

func NewProjectionHTTPUnitResource(cfg projection.ResourceConfig) *projection.Resource {
	_, _, subject, _, _, _ := NewStudentHTTPResources(people.ResourceConfig{Now: time.Now}, unusedCareResource, cfg, presence.ResourceConfig{}, delete.ResourceConfig{}, review.ResourceConfig{})
	return subject
}
func NewReviewHTTPUnitResource(cfg review.ResourceConfig) *review.Resource {
	_, _, _, _, _, subject := NewStudentHTTPResources(people.ResourceConfig{Now: time.Now}, unusedCareResource, projection.ResourceConfig{}, presence.ResourceConfig{}, delete.ResourceConfig{}, cfg)
	return subject
}
