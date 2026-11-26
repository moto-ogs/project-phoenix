package settings

import (
	"context"

	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// CareFacilityArticleSource is the resolver slice ResolveCareFacilityArticle
// reads.
type CareFacilityArticleSource interface {
	ResolveString(ctx context.Context, key string) (string, error)
}

// ResolveCareFacilityArticle is the article the fixed German texts decline
// the school's care name with (#8136): the chosen one for an own name, "die"
// for the presets and for schools that never chose. Both reads fail the
// caller, so no school gets a guessed wording.
func ResolveCareFacilityArticle(ctx context.Context, source CareFacilityArticleSource) (string, error) {
	term, err := source.ResolveString(ctx, configModel.KeyEnrollmentCareFacilityTerm)
	if err != nil {
		return "", err
	}
	stored, err := source.ResolveString(ctx, configModel.KeyEnrollmentCareFacilityArticle)
	if err != nil {
		return "", err
	}
	return textnorm.CareArticle(term, stored), nil
}
