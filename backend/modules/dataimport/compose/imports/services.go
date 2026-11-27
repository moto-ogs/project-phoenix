// Package imports constructs the Data Import application over native ports.
package imports

import (
	dataimport "github.com/moto-ogs/project-phoenix/modules/dataimport"
	application "github.com/moto-ogs/project-phoenix/modules/dataimport/internal/application/importservice"
	ports "github.com/moto-ogs/project-phoenix/modules/dataimport/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func NewStudentImportConfig(deps ports.StudentImportDeps) ports.ImportConfig[dataimport.StudentImportRow] {
	return application.NewStudentImportConfig(deps)
}
func NewStaffImportConfig(deps ports.StaffImportDeps) ports.ImportConfig[dataimport.StaffImportRow] {
	return application.NewStaffImportConfig(deps)
}
func NewClassListImportConfig(deps ports.ClassListImportDeps) ports.ImportConfig[dataimport.ClassListEntryImportRow] {
	return application.NewClassListImportConfig(deps)
}
func NewOpeningBalanceImportConfig(deps ports.OpeningBalanceImportDeps, day calendar.Date, note string, staffID int64) ports.ImportConfig[dataimport.OpeningBalanceImportRow] {
	return application.NewOpeningBalanceImportConfig(deps, day, note, staffID)
}
func NewRelationshipResolver(groups dataimport.ReferenceLookup) ports.RelationshipResolver {
	return application.NewRelationshipResolver(groups)
}
func NewImportService[T any](config ports.ImportConfig[T], runtime ports.ImportRuntime) dataimport.RowImporter[T] {
	return application.NewImportService(config, runtime)
}
func NewClassListConversion(deps ports.ClassListConversionDeps, students ports.StudentImportDeps) dataimport.ClassListConverter {
	return application.NewClassListConversion(deps, application.NewStudentImportConfig(students))
}
