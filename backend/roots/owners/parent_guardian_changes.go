package owners

import (
	"github.com/moto-ogs/project-phoenix/modules/auditlog"
	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
)

// ParentGuardianChanges is the Audit Platform's guardian change trail the
// parent portal appends to inside the flow's tenant unit of work. The root
// binds it; the parent portal composition builds no other owner (#4004, ADR
// 0059 point 6). The database stamps the changes (ADR 0281, Nachtrag).
func ParentGuardianChanges() auditlog.GuardianChangeLog {
	return auditCompose.NewGuardianChangeLog()
}
