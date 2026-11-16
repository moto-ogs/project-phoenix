package config

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// ErrSchoolCreationOutsideAdminUnit rejects a school-creation write without
// the administrative unit that creates the school.
var ErrSchoolCreationOutsideAdminUnit = errors.New("school creation settings: the administrative unit of the school creation is required")

// SchoolCreationSettings records the settings an operator names when creating
// a school (#7174): today its federal state, which has no registry default.
// It participates in the administrative unit that creates the school (ADR
// 0067 command participation): no own transaction and no scope switch, so the
// school and its state commit together or not at all.
type SchoolCreationSettings struct {
	registry    *config.Registry
	values      config.SettingValueRepository
	audit       config.SettingAuditRepository
	inAdminUnit func(context.Context) bool
}

// NewSchoolCreationSettings binds the registry, the value and audit
// repositories over the ambient transaction, and the check for the
// administrative unit. Every dependency is required.
func NewSchoolCreationSettings(registry *config.Registry, values config.SettingValueRepository, audit config.SettingAuditRepository, inAdminUnit func(context.Context) bool) (*SchoolCreationSettings, error) {
	if registry == nil || values == nil || audit == nil || inAdminUnit == nil {
		return nil, errors.New("school creation settings: all dependencies are required")
	}
	return &SchoolCreationSettings{registry: registry, values: values, audit: audit, inAdminUnit: inAdminUnit}, nil
}

// RecordFederalState stores the new school's federal state with its audit
// entry and reports false, storing nothing, for a region that is no option
// of operations.federal_state. It is a system write without an author: the
// settings audit names accounts, an operator is none, and the operator audit
// entry of the creation names the operator.
func (s *SchoolCreationSettings) RecordFederalState(ctx context.Context, schoolID int64, region string) (bool, error) {
	if !s.inAdminUnit(ctx) {
		return false, ErrSchoolCreationOutsideAdminUnit
	}
	if schoolID <= 0 {
		return false, fmt.Errorf("school creation settings: school ID must be positive")
	}
	definition := s.registry.GetDefinition(config.KeyFederalState)
	if definition == nil {
		return false, &config.SettingsError{Op: "set_value", Err: &config.DefinitionNotFoundError{Key: config.KeyFederalState}}
	}
	if validateValue(definition, region) != nil {
		return false, nil
	}
	return true, s.storeFederalState(ctx, schoolID, region)
}

func (s *SchoolCreationSettings) storeFederalState(ctx context.Context, schoolID int64, region string) error {
	value, err := json.Marshal(region)
	if err != nil {
		return fmt.Errorf("school creation settings: marshal federal state: %w", err)
	}
	existing, err := s.values.FindByTenantAndKey(ctx, schoolID, config.KeyFederalState)
	if err != nil {
		return fmt.Errorf("school creation settings: read federal state: %w", err)
	}
	var old json.RawMessage
	if existing != nil {
		old = existing.Value
	}
	row := &config.SettingValue{SettingKey: config.KeyFederalState, Value: value}
	row.TenantID = schoolID
	if err := s.values.Upsert(ctx, row); err != nil {
		return fmt.Errorf("school creation settings: store federal state: %w", err)
	}
	if err := s.audit.Create(ctx, config.NewAuditEntry(schoolID, config.KeyFederalState, "set", old, value, nil)); err != nil {
		return fmt.Errorf("school creation settings: record federal state change: %w", err)
	}
	return nil
}
