package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/internal/adapters/parentpostgres"
	"github.com/uptrace/bun"
)

// NewParentClassTransitions is the communication side of the school-year
// change (#8214): class threads and draft class targets follow the children.
func NewParentClassTransitions(db *bun.DB) communication.ParentClassTransitions {
	return parentpostgres.NewParentClassTransitions(parentDatabase(db))
}
