package importpkg

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/agnivade/levenshtein"
	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	"github.com/moto-ogs/project-phoenix/modules/dataimport/ports"
)

type Reference = importModels.Reference
type ReferenceLookup = importModels.ReferenceLookup

// RelationshipResolver resolves human-readable group names to database IDs with fuzzy matching
type RelationshipResolver struct {
	groupRepo  ReferenceLookup
	groupCache map[string]Reference // lowercase name → group
}

// NewRelationshipResolver creates a new relationship resolver
func NewRelationshipResolver(groupRepo ReferenceLookup) *RelationshipResolver {
	return &RelationshipResolver{
		groupRepo:  groupRepo,
		groupCache: make(map[string]Reference),
	}
}

func (r *RelationshipResolver) newRequestScoped() ports.RelationshipResolver {
	return NewRelationshipResolver(r.groupRepo)
}

// PreloadReferenceData loads all groups into memory cache (called once before import)
func (r *RelationshipResolver) PreloadReferenceData(ctx context.Context) error {
	groups, err := r.groupRepo(ctx)
	if err != nil {
		return fmt.Errorf("preload groups: %w", err)
	}

	for _, group := range groups {
		key := strings.ToLower(strings.TrimSpace(group.Name))
		r.groupCache[key] = group
	}

	return nil
}

// ResolveGroup resolves human-readable group names to IDs with fuzzy matching.
func (r *RelationshipResolver) ResolveGroup(_ context.Context, name string) (*int64, []importModels.ValidationError) {
	if name == "" {
		return nil, nil // Optional field - empty is OK
	}

	normalized := strings.ToLower(strings.TrimSpace(name))

	// 1. Exact match (case-insensitive)
	if group, exists := r.groupCache[normalized]; exists {
		return &group.ID, nil
	}

	// 2. Fuzzy match (Levenshtein distance ≤ 3)
	suggestions := r.findSimilarGroups(name, 3)

	if len(suggestions) > 0 {
		return nil, []importModels.ValidationError{{
			Field:       "group",
			Message:     fmt.Sprintf("Gruppe '%s' nicht gefunden. Meintest du: %s? (Wird ohne Gruppe importiert)", name, strings.Join(suggestions, ", ")),
			Code:        "group_not_found_with_suggestions",
			Severity:    importModels.ErrorSeverityWarning,
			Suggestions: suggestions,
			AutoFix: &importModels.AutoFix{
				Action:      "replace",
				Replacement: suggestions[0], // Best match
				Description: fmt.Sprintf("Automatisch zu '%s' ändern", suggestions[0]),
			},
			ActualValue: name, // Store the actual value that caused the error for bulk actions
		}}
	}

	// 3. No matches - proceed without entity (warning only)
	return nil, []importModels.ValidationError{{
		Field:    "group",
		Message:  fmt.Sprintf("Gruppe '%s' existiert nicht. Kind wird ohne Gruppe importiert.", name),
		Code:     "group_not_found",
		Severity: importModels.ErrorSeverityWarning,
	}}
}

// findSimilar is a generic helper to find similar names using Levenshtein distance
func findSimilar(input string, maxDistance int, getNames func() []string) []string {
	type match struct {
		name     string
		distance int
	}

	var matches []match
	inputLower := strings.ToLower(input)

	for _, name := range getNames() {
		nameLower := strings.ToLower(name)
		distance := levenshtein.ComputeDistance(inputLower, nameLower)

		if distance <= maxDistance {
			matches = append(matches, match{name: name, distance: distance})
		}
	}

	// Sort by distance (closest first)
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].distance < matches[j].distance
	})

	// Return top 3 suggestions
	result := make([]string, 0, 3)
	for i := 0; i < len(matches) && i < 3; i++ {
		result = append(result, matches[i].name)
	}

	return result
}

// findSimilarGroups finds group names within Levenshtein distance threshold
func (r *RelationshipResolver) findSimilarGroups(input string, maxDistance int) []string {
	return findSimilar(input, maxDistance, func() []string {
		names := make([]string, 0, len(r.groupCache))
		for _, group := range r.groupCache {
			names = append(names, group.Name)
		}
		return names
	})
}
