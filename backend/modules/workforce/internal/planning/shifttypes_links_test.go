package planning

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// A create or an edit of a shift type always hands the category links a
// token map, an empty one when the client sent none, so Timetable refuses
// every link the write changes without the token its form read (ADR 0311).
// Linking a category to a new type moves it from the type it had.
func TestShiftTypeEditHandsTheCategoryLinksTheTokensItRead(t *testing.T) {
	t.Parallel()
	var handed []map[int64]string
	linker := func(_ context.Context, _ int64, _ []int64, expected map[int64]string) error {
		handed = append(handed, expected)
		return nil
	}
	active := true
	types := &stubShiftTypeService{types: map[int64]*workforce.ShiftTypeRecord{7: {Name: "Früh", Color: "#83CD2D", IsActive: true}}}
	admin := NewShiftTypeAdministration(types, linker)
	ctx := context.Background()

	_, err := admin.CreateShiftType(ctx, workforce.ShiftTypeInput{Name: "Neu", Color: "#83CD2D", CategoryIDs: []int64{1}})
	require.NoError(t, err)
	_, err = admin.CreateShiftType(ctx, workforce.ShiftTypeInput{
		Name: "Neu", Color: "#83CD2D", CategoryIDs: []int64{1}, ExpectedCategoryLinks: map[int64]string{1: "read"},
	})
	require.NoError(t, err)
	_, err = admin.UpdateShiftType(ctx, workforce.ShiftTypeInput{ID: 7, Name: "Früh", Color: "#83CD2D", IsActive: &active, CategoryIDs: []int64{1}})
	require.NoError(t, err)
	_, err = admin.UpdateShiftType(ctx, workforce.ShiftTypeInput{
		ID: 7, Name: "Früh", Color: "#83CD2D", IsActive: &active, CategoryIDs: []int64{1},
		ExpectedCategoryLinks: map[int64]string{1: "read"},
	})
	require.NoError(t, err)

	require.Len(t, handed, 4)
	assert.Equal(t, map[int64]string{}, handed[0], "a create without tokens checks every link it sets")
	assert.Equal(t, map[int64]string{1: "read"}, handed[1], "a create hands the tokens its form read")
	assert.Equal(t, map[int64]string{}, handed[2], "an edit without tokens checks every changed link")
	assert.Equal(t, map[int64]string{1: "read"}, handed[3])
}
