package api

import (
	"context"
	"testing"

	schoolMembershipModule "github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// classListLockOrder records whether the shared conversion lock came before
// the first switch read.
type classListLockOrder struct {
	calls []string
	on    bool
}

func (o *classListLockOrder) LockClassListConversionShared(context.Context) error {
	o.calls = append(o.calls, "lock")
	return nil
}

func (o *classListLockOrder) ResolveBool(context.Context, string) (bool, error) {
	o.calls = append(o.calls, "read")
	return o.on, nil
}

type recordingClassListEntries struct {
	schoolMembershipModule.ClassListEntries
	added bool
}

func (r *recordingClassListEntries) AddClassListEntry(context.Context, schoolMembershipModule.AddClassListEntry) (schoolMembershipModule.ClassListEntry, error) {
	r.added = true
	return schoolMembershipModule.ClassListEntry{}, nil
}

// TestClassListWritesLockBeforeReadingTheSwitch takes the shared side of the
// conversion lock before a new entry reads the switches
// (#4803 review): a switch turned on concurrently then either waits for the
// write's entries or is seen by it, so no entry stays unconverted. The import
// batch takes the same lock in classListImportConversion.
func TestClassListWritesLockBeforeReadingTheSwitch(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	settings := &classListLockOrder{}
	entries := &recordingClassListEntries{}
	_, err := classListEntriesWhileChildrenKept{ClassListEntries: entries, settings: settings, lock: settings}.
		AddClassListEntry(ctx, schoolMembershipModule.AddClassListEntry{})
	require.NoError(t, err)
	assert.True(t, entries.added)
	require.NotEmpty(t, settings.calls)
	assert.Equal(t, "lock", settings.calls[0], "the entry locks before it reads the switch")

}
