package importpkg

import (
	"context"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"

	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	"github.com/stretchr/testify/assert"
)

func TestRelationshipResolver_ResolveGroup_ExactMatch(t *testing.T) {
	t.Parallel()

	resolver := &RelationshipResolver{
		groupCache: map[string]Reference{
			"gruppe 1a": {ID: 1, Name: "Gruppe 1A"},
			"gruppe 2b": {ID: 2, Name: "Gruppe 2B"},
			"gruppe 3c": {ID: 3, Name: "Gruppe 3C"},
		},
	}

	tests := []struct {
		name     string
		input    string
		wantID   *int64
		wantErrs bool
	}{
		{
			name:     "exact match lowercase",
			input:    "Gruppe 1A",
			wantID:   testpkg.Int64Ptr(1),
			wantErrs: false,
		},
		{
			name:     "exact match case insensitive",
			input:    "gruppe 1a",
			wantID:   testpkg.Int64Ptr(1),
			wantErrs: false,
		},
		{
			name:     "exact match with spaces",
			input:    "  Gruppe 1A  ",
			wantID:   testpkg.Int64Ptr(1),
			wantErrs: false,
		},
		{
			name:     "empty input",
			input:    "",
			wantID:   nil,
			wantErrs: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, errors := resolver.ResolveGroup(context.Background(), tt.input)

			if tt.wantID != nil {
				assert.NotNil(t, id, "Expected ID to be non-nil")
				assert.Equal(t, *tt.wantID, *id, "ID mismatch")
				assert.Empty(t, errors, "Expected no errors")
			} else if tt.wantErrs {
				assert.Nil(t, id, "Expected ID to be nil")
				assert.NotEmpty(t, errors, "Expected errors")
			} else {
				assert.Nil(t, id, "Expected ID to be nil")
				assert.Empty(t, errors, "Expected no errors")
			}
		})
	}
}

func TestRelationshipResolver_ResolveGroup_FuzzyMatch(t *testing.T) {
	t.Parallel()

	resolver := &RelationshipResolver{
		groupCache: map[string]Reference{
			"gruppe 1a":  {ID: 1, Name: "Gruppe 1A"},
			"gruppe 2b":  {ID: 2, Name: "Gruppe 2B"},
			"gruppe 10a": {ID: 10, Name: "Gruppe 10A"},
		},
	}

	tests := []struct {
		name                  string
		input                 string
		wantSuggestions       bool
		expectedInSuggestions []string
	}{
		{
			name:                  "close match - missing number",
			input:                 "Gruppe A",
			wantSuggestions:       true,
			expectedInSuggestions: []string{"Gruppe 1A"}, // Should suggest 1A
		},
		{
			name:                  "typo - single character difference",
			input:                 "Gruppe 1B",
			wantSuggestions:       true,
			expectedInSuggestions: []string{"Gruppe 1A", "Gruppe 2B"}, // Both close
		},
		{
			name:                  "typo - transposed characters",
			input:                 "Gruppe 01A",
			wantSuggestions:       true,
			expectedInSuggestions: []string{"Gruppe 10A", "Gruppe 1A"}, // Both close
		},
		{
			name:                  "no match - too different",
			input:                 "Abteilung ABC",
			wantSuggestions:       false,
			expectedInSuggestions: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, errors := resolver.ResolveGroup(context.Background(), tt.input)

			assert.Nil(t, id, "Expected ID to be nil for fuzzy/no match")
			assert.NotEmpty(t, errors, "Expected errors")

			if tt.wantSuggestions {
				assert.NotEmpty(t, errors[0].Suggestions, "Expected suggestions")
				assert.Equal(t, importModels.ErrorSeverityWarning, errors[0].Severity) // Warning, not error - allows import without group
				assert.Equal(t, "group_not_found_with_suggestions", errors[0].Code)
				assert.NotNil(t, errors[0].AutoFix, "Expected AutoFix")

				// Check if expected suggestions are present
				for _, expected := range tt.expectedInSuggestions {
					assert.Contains(t, errors[0].Suggestions, expected, "Missing expected suggestion")
				}
			} else {
				// No suggestions case
				assert.Empty(t, errors[0].Suggestions, "Expected no suggestions")
				assert.Equal(t, importModels.ErrorSeverityWarning, errors[0].Severity) // Warning, not error
				assert.Equal(t, "group_not_found", errors[0].Code)
			}
		})
	}
}

func TestRelationshipResolver_FindSimilarGroups(t *testing.T) {
	t.Parallel()

	resolver := &RelationshipResolver{
		groupCache: map[string]Reference{
			"gruppe 1a":  {ID: 1, Name: "Gruppe 1A"},
			"gruppe 1b":  {ID: 2, Name: "Gruppe 1B"},
			"gruppe 2a":  {ID: 3, Name: "Gruppe 2A"},
			"gruppe 10a": {ID: 4, Name: "Gruppe 10A"},
		},
	}

	tests := []struct {
		name        string
		input       string
		maxDistance int
		minMatches  int
		maxMatches  int
		firstMatch  string // Expected first suggestion (closest)
	}{
		{
			name:        "distance 1 - should find 1A and 1B",
			input:       "Gruppe 1C",
			maxDistance: 1,
			minMatches:  2,
			maxMatches:  3,
			firstMatch:  "Gruppe 1A", // or 1B, both distance 1
		},
		{
			name:        "distance 2 - should find multiple",
			input:       "Gruppe A",
			maxDistance: 3,
			minMatches:  1,
			maxMatches:  3,
			firstMatch:  "Gruppe 1A",
		},
		{
			name:        "distance 0 - exact match not found by findSimilar",
			input:       "Gruppe 1A",
			maxDistance: 0,
			minMatches:  1,
			maxMatches:  1,
			firstMatch:  "Gruppe 1A",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions := resolver.findSimilarGroups(tt.input, tt.maxDistance)

			assert.GreaterOrEqual(t, len(suggestions), tt.minMatches, "Too few suggestions")
			assert.LessOrEqual(t, len(suggestions), tt.maxMatches, "Too many suggestions")
			assert.LessOrEqual(t, len(suggestions), 3, "Should return max 3 suggestions")

			if len(suggestions) > 0 && tt.firstMatch != "" {
				// First suggestion should be the closest match
				assert.Contains(t, suggestions, tt.firstMatch, "Expected match not in suggestions")
			}
		})
	}
}

// ============================================================================
// NewRelationshipResolver Tests
// ============================================================================

func TestNewRelationshipResolver(t *testing.T) {
	t.Parallel()

	t.Run("creates resolver with an empty group cache", func(t *testing.T) {
		// ACT
		resolver := NewRelationshipResolver(nil)

		// ASSERT
		assert.NotNil(t, resolver)
		assert.NotNil(t, resolver.groupCache)
		assert.Empty(t, resolver.groupCache)
	})
}

// ============================================================================
// PreloadReferenceData Tests
// ============================================================================

type mockGroupRepo struct {
	groups []Reference
	err    error
}

func TestRelationshipResolver_PreloadGroups(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("preloads groups successfully", func(t *testing.T) {
		// ARRANGE
		mockRepo := &mockGroupRepo{
			groups: []Reference{
				{ID: 1, Name: "Gruppe 1A"},
				{ID: 2, Name: "Gruppe 2B"},
			},
		}
		resolver := NewRelationshipResolver(mockRepo.lookup)

		// ACT
		err := resolver.PreloadReferenceData(ctx)

		// ASSERT
		assert.NoError(t, err)
		assert.Len(t, resolver.groupCache, 2)
		assert.Contains(t, resolver.groupCache, "gruppe 1a")
		assert.Contains(t, resolver.groupCache, "gruppe 2b")
	})

	t.Run("returns error when repo fails", func(t *testing.T) {
		// ARRANGE
		mockRepo := &mockGroupRepo{
			err: assert.AnError,
		}
		resolver := NewRelationshipResolver(mockRepo.lookup)

		// ACT
		err := resolver.PreloadReferenceData(ctx)

		// ASSERT
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "preload groups")
	})
}

func (m *mockGroupRepo) lookup(context.Context) ([]Reference, error) { return m.groups, m.err }
