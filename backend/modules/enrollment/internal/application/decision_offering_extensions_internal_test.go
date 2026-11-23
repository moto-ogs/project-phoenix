package application

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingCareStudents struct{ err error }

func (f failingCareStudents) PhaseCareStudents(context.Context, []int64) ([]enrollmentNative.PhaseCareStudent, error) {
	return nil, f.err
}

// The care ends behind an extension are optional (#7929): they are read in a
// savepoint, so a failed read leaves the ambient transaction usable and the
// detail offers no extension. Only a failed savepoint ends the read.
func TestTheCareEndsOfAnExtensionAreReadInASavepoint(t *testing.T) {
	t.Parallel()
	readFailed, savepointFailed := errors.New("statement timeout"), errors.New("savepoint failed")
	for name, tc := range map[string]struct {
		savepointErr error
		wantErr      error
	}{
		"a failed read offers nothing":   {},
		"a failed savepoint is an error": {savepointErr: savepointFailed, wantErr: savepointFailed},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			savepoints := 0
			d := &Decisions{deps: DecisionDependencies{
				CareStudents: failingCareStudents{err: readFailed},
				Logger:       slog.New(slog.DiscardHandler),
				Runtime: Runtime{
					InTransaction: func(context.Context) bool { return true },
					Savepoint: func(ctx context.Context, fn func(context.Context) error) error {
						savepoints++
						if err := fn(ctx); err != nil && tc.savepointErr != nil {
							return tc.savepointErr
						} else if err != nil {
							return err
						}
						return nil
					},
					IsSavepointControl: func(err error) bool { return errors.Is(err, savepointFailed) },
				},
			}}
			student, end := int64(7), calendar.NewDate(2027, 3, 1)
			phase := &enrollmentNative.Phase{ServiceEndDate: "2027-07-31"}
			children := []*enrollmentNative.RequestChild{{ID: 1, Status: enrollmentNative.ChildStatusApproved, CreatedStudentID: &student}}
			sets := map[int64]enrollmentNative.ChildOfferingSet{1: {Current: []enrollmentNative.ChildOfferingRow{
				{OfferingID: 3, ManualSelectedDays: []string{"mon"}, ValidUntil: &end},
			}}}

			err := d.markExtendableBookings(context.Background(), phase, calendar.NewDate(2027, 1, 4), children, nil, sets)

			assert.Equal(t, 1, savepoints, "the read runs in a savepoint")
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Nil(t, sets[1].Current[0].ExtendsUntil)
		})
	}
}
