package api

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/settings/records"
)

func TestTenantLookupSettingsOnlyChangeThroughSchoolWrites(t *testing.T) {
	t.Parallel()
	for _, key := range ContractTenantShellSettingKeys() {
		definition := records.GetDefinition(key)
		if definition == nil {
			t.Errorf("lookup setting %q is not registered", key)
			continue
		}
		if definition.Levels.AtTraeger() {
			t.Errorf("lookup setting %q can change through a Träger write: add invalidation on that write path", key)
		}
	}
}
