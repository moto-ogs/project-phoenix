package planning

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// A cancellation rebuilds the covers from its request (ADR 0311): the planner
// must have read the shift and exactly the covers stored now, each in its
// stored version. A write no person read (nil) checks nothing.
func TestCancellationReadCoversTheShiftAndEveryCover(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, time.September, 9, 8, 0, 0, 0, time.UTC)
	shiftAt := func(id int64, minutes int) *workforce.ShiftRecord {
		record := &workforce.ShiftRecord{}
		record.ID = id
		record.UpdatedAt = at.Add(time.Duration(minutes) * time.Minute)
		return record
	}
	origin := shiftAt(1, 0)
	covers := []*workforce.ShiftRecord{shiftAt(2, 1), shiftAt(3, 2)}
	read := func(version string, replacements map[int64]string) *workforce.ShiftReadState {
		return &workforce.ShiftReadState{Version: version, Replacements: replacements}
	}
	v := func(record *workforce.ShiftRecord) string { return workforce.ShiftVersion(record.UpdatedAt) }
	current := map[int64]string{2: v(covers[0]), 3: v(covers[1])}

	require.NoError(t, checkCancellationRead(nil, origin, covers))
	require.NoError(t, checkCancellationRead(read(v(origin), current), origin, covers))
	for name, state := range map[string]*workforce.ShiftReadState{
		"no version":           read("", current),
		"shift changed":        read(v(shiftAt(1, 5)), current),
		"cover added since":    read(v(origin), map[int64]string{2: v(covers[0])}),
		"cover removed since":  read(v(origin), map[int64]string{2: v(covers[0]), 3: v(covers[1]), 4: "x"}),
		"cover changed since":  read(v(origin), map[int64]string{2: v(covers[0]), 3: v(shiftAt(3, 9))}),
		"other cover was read": read(v(origin), map[int64]string{2: v(covers[0]), 4: v(covers[1])}),
	} {
		assert.ErrorIs(t, checkCancellationRead(state, origin, covers), readstate.ErrChanged, name)
	}
}
