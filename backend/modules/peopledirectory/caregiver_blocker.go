package peopledirectory

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

// BlockerActivity represents an activity supervision assignment that blocks disable.
type BlockerActivity struct {
	ID           ident.ID `json:"id"`
	ActivityID   ident.ID `json:"activity_id"`
	ActivityName string   `json:"activity_name"`
	IsPrimary    bool     `json:"is_primary"`
}
