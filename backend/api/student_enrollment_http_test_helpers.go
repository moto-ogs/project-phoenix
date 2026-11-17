//go:build testhooks

package api

import (
	"log/slog"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	studentsAPI "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
)

func NewStudentEnrollmentHTTPTestResource(people StudentTestPeople, userContext *owners.CallerRows) *enrollmentHTTP.StudentResource {
	directory := studentsAPI.NewResource(studentsAPI.ResourceConfig{PeopleDirectory: people.PeopleDirectory, UserContextService: userContext, Now: time.Now})
	return &enrollmentHTTP.StudentResource{StudentReadAccess: directory.StudentReadAccess, Logger: slog.Default()}
}
