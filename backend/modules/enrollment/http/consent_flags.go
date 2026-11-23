package enrollmenthttp

import (
	"encoding/json"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// ConsentFlags carries the typed checkbox values and preserves older
// recorded values verbatim. Only a real boolean is a checkbox answer.
type ConsentFlags map[string]common.LegacyJSON[*bool]

func consentFlagsFromOwner(values enrollment.FormValues) ConsentFlags {
	flags := make(ConsentFlags, values.Len())
	for key, value := range values.All() {
		flag := common.LegacyJSON[*bool]{}
		if accepted, ok := value.(bool); ok {
			flag.Value = &accepted
		} else {
			flag.Legacy = value
		}
		flags[key] = flag
	}
	return flags
}

// ConsentFlagsInput describes the checkbox values sent by the frontend. It
// still passes through non-boolean values sent by old clients so approval,
// validation and the immutable evidence write do not change in a rollout.
type ConsentFlagsInput struct {
	Value  map[string]*bool
	legacy map[string]any
}

func (flags *ConsentFlagsInput) UnmarshalJSON(data []byte) error {
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	flags.Value = nil
	if values != nil {
		flags.Value = make(map[string]*bool, len(values))
		for key, value := range values {
			if accepted, ok := value.(bool); ok {
				flags.Value[key] = &accepted
			} else {
				flags.Value[key] = nil
			}
		}
	}
	flags.legacy = values
	return nil
}

func (flags ConsentFlagsInput) values() map[string]any {
	if flags.legacy != nil {
		return flags.legacy
	}
	if flags.Value == nil {
		return nil
	}
	values := make(map[string]any, len(flags.Value))
	for key, value := range flags.Value {
		if value == nil {
			values[key] = nil
		} else {
			values[key] = *value
		}
	}
	return values
}

func (flags ConsentFlagsInput) MarshalJSON() ([]byte, error) {
	return json.Marshal(flags.values())
}

func (flags ConsentFlagsInput) IsZero() bool { return flags.Value == nil }
