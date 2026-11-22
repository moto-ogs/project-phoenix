package api

// The staff names of one "Heute anders" request are read once (#7675): the
// Personal source names the people of a covered block, and the Stundenplan
// source names the same people on the same block. Both bind the same names
// port; the sources that share one savepoint share one memo, so the second
// asks only for the ids the first did not read.

import (
	"context"
)

type dayChangesNameMemoKey struct{}

// dayChangesNameMemo holds the names read during one savepoint. The sources
// of a savepoint read one after another (daychangesview), so it needs no
// lock.
type dayChangesNameMemo struct {
	names map[int64]string
	read  map[int64]bool
}

// withDayChangesNameMemo opens the name memo of one read of the sources.
func withDayChangesNameMemo(ctx context.Context) context.Context {
	return context.WithValue(ctx, dayChangesNameMemoKey{}, &dayChangesNameMemo{names: map[int64]string{}, read: map[int64]bool{}})
}

// memoStaffNames serves names from the request's memo and reads only the
// missing ids. Outside a request with a memo it reads every id.
type memoStaffNames struct{ inner dayChangesStaffNames }

func (m memoStaffNames) StaffNames(ctx context.Context, staffIDs []int64) (map[int64]string, error) {
	memo, ok := ctx.Value(dayChangesNameMemoKey{}).(*dayChangesNameMemo)
	if !ok {
		return m.inner.StaffNames(ctx, staffIDs)
	}
	missing := make([]int64, 0, len(staffIDs))
	for _, id := range staffIDs {
		if !memo.read[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		names, err := m.inner.StaffNames(ctx, missing)
		if err != nil {
			return nil, err
		}
		for _, id := range missing {
			memo.read[id] = true
			if name, found := names[id]; found {
				memo.names[id] = name
			}
		}
	}
	result := make(map[int64]string, len(staffIDs))
	for _, id := range staffIDs {
		if name, found := memo.names[id]; found {
			result[id] = name
		}
	}
	return result, nil
}
