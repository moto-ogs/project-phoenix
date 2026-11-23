package enrollmenthttp

import (
	"encoding/json"
	"sort"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// ChangeRequestSnapshot is enrollment data as recorded before or after a
// proposal. Old records can omit fields; bookkeeping such as status appears
// only where the snapshot knew it when it was taken.
type ChangeRequestSnapshot struct {
	PhaseID             *string                                         `json:"phase_id,omitempty"`
	GuardianFirstName   *string                                         `json:"guardian_first_name,omitempty"`
	GuardianLastName    *string                                         `json:"guardian_last_name,omitempty"`
	GuardianEmail       common.OptionalJSON[*string]                    `json:"guardian_email,omitzero"`
	GuardianPhone       common.OptionalJSON[*string]                    `json:"guardian_phone,omitzero"`
	ConsentFlags        common.OptionalJSON[ConsentFlags]               `json:"consent_flags,omitzero" contract_json:"Preserve the recorded value of historical non-boolean checkbox answers"`
	CustomData          common.OptionalJSON[map[string]any]             `json:"custom_data,omitzero" contract_json:"Answer values follow the school's versioned form schema"`
	AdditionalGuardians []common.LegacyJSON[ChangeRequestGuardian]      `json:"additional_guardians,omitzero" contract_json:"Historical snapshots can contain a displayed guardian name instead of a structured row"`
	Children            []common.LegacyJSON[ChangeRequestChildSnapshot] `json:"children,omitzero" contract_json:"Historical snapshots can contain a displayed child name instead of a structured row"`
}

type ChangeRequestGuardian struct {
	FirstName common.OptionalJSON[*string] `json:"first_name,omitzero"`
	LastName  common.OptionalJSON[*string] `json:"last_name,omitzero"`
	Email     common.OptionalJSON[*string] `json:"email,omitzero"`
	Phone     common.OptionalJSON[*string] `json:"phone,omitzero"`
}

type ChangeRequestChildSnapshot struct {
	ID                *string                             `json:"id,omitempty"`
	Status            *string                             `json:"status,omitempty"`
	FirstName         *string                             `json:"first_name,omitempty"`
	LastName          *string                             `json:"last_name,omitempty"`
	DateOfBirth       *string                             `json:"date_of_birth,omitempty"`
	TargetGradeLevel  common.OptionalJSON[*int16]         `json:"target_grade_level,omitzero"`
	TargetSchoolClass *string                             `json:"target_school_class,omitempty"`
	HolidayCareWish   *bool                               `json:"holiday_care_wish,omitempty"`
	CustomData        common.OptionalJSON[map[string]any] `json:"custom_data,omitzero" contract_json:"Answer values follow the school's versioned form schema"`
	OfferingIDs       []string                            `json:"offering_ids,omitzero"`
	OfferingDays      []ChangeRequestOfferingDays         `json:"offering_days,omitzero"`
}

type ChangeRequestOfferingDays struct {
	OfferingID   string   `json:"offering_id"`
	SelectedDays []string `json:"selected_days"`
}

type ChangeRequestDiff struct {
	Changed []string `json:"changed,omitzero"`
}

// Older diffs listed changed fields as object keys. Translate that stored
// representation rather than letting a typed decoder discard those keys.
func (diff *ChangeRequestDiff) UnmarshalJSON(data []byte) error {
	var old map[string]json.RawMessage
	if err := json.Unmarshal(data, &old); err != nil {
		return err
	}
	diff.Changed = nil
	var changed []json.RawMessage
	if raw, ok := old["changed"]; ok && json.Unmarshal(raw, &changed) == nil && changed != nil {
		diff.Changed = make([]string, 0, len(changed))
		for _, entry := range changed {
			var key *string
			if json.Unmarshal(entry, &key) == nil && key != nil {
				diff.Changed = append(diff.Changed, *key)
			}
		}
		return nil
	}
	for key := range old {
		if key != "changed" {
			diff.Changed = append(diff.Changed, key)
		}
	}
	sort.Strings(diff.Changed)
	return nil
}
