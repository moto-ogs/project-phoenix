package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// activationStore answers the versions of one contract and records how a
// signed version joins its timeline.
type activationStore struct {
	Store
	versions  []carecontract.Version
	activated *ports.VersionActivation
}

func (s *activationStore) Versions(context.Context, int64, int64) ([]carecontract.Version, error) {
	return s.versions, nil
}

func (s *activationStore) ActivateVersion(_ context.Context, _, _ int64, activation ports.VersionActivation) error {
	s.activated = &activation
	return nil
}

func activationVersion(number int, status, from string) carecontract.Version {
	return carecontract.Version{ID: ident.ID(number), Number: number, Status: status, EffectiveFrom: calendar.Date(from)}
}

// TestSignedChangeJoinsTheTimeline pins where a signed changed version
// takes effect (#4816): from its effective date, never before the day of
// the signature, with the step a new version takes on the timeline.
func TestSignedChangeJoinsTheTimeline(t *testing.T) {
	t.Parallel()
	inForce := activationVersion(1, carecontract.VersionEffective, "2027-08-01")
	march := calendar.NewDate(2028, 3, 1)
	for name, c := range map[string]struct {
		timeline []carecontract.Version
		signedOn string
		want     ports.VersionActivation
	}{
		"signed in time: it follows the version in force from its date": {
			timeline: []carecontract.Version{inForce}, signedOn: "2028-02-10",
			want: ports.VersionActivation{VersionID: 9, Status: carecontract.VersionEffective, EffectiveFrom: march,
				Step: ports.VersionStep{Supersede: 1, Status: carecontract.VersionEffective}},
		},
		"signed late: it holds from the day of the signature and keeps the agreed date": {
			timeline: []carecontract.Version{inForce}, signedOn: "2028-03-20",
			want: ports.VersionActivation{VersionID: 9, Status: carecontract.VersionEffective, EffectiveFrom: calendar.NewDate(2028, 3, 20),
				AgreedFrom: &march, Step: ports.VersionStep{Supersede: 1, Status: carecontract.VersionEffective}},
		},
		"a version starts on its day: it replaces that version": {
			timeline: []carecontract.Version{activationVersion(1, carecontract.VersionSuperseded, "2027-08-01"),
				activationVersion(2, carecontract.VersionEffective, "2028-03-01")}, signedOn: "2028-02-10",
			want: ports.VersionActivation{VersionID: 9, Status: carecontract.VersionEffective, EffectiveFrom: march,
				Step: ports.VersionStep{Replace: 2, Status: carecontract.VersionEffective}},
		},
		"a version is planned after it: it goes before the planned one": {
			timeline: []carecontract.Version{activationVersion(1, carecontract.VersionSuperseded, "2027-08-01"),
				activationVersion(2, carecontract.VersionEffective, "2028-05-01")}, signedOn: "2028-02-10",
			want: ports.VersionActivation{VersionID: 9, Status: carecontract.VersionSuperseded, EffectiveFrom: march},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			store := &activationStore{versions: c.timeline}
			record := ContractRecord{Version: activationVersion(9, carecontract.VersionRequested, "2028-03-01")}
			require.NoError(t, activateSigned(context.Background(), store, 1, record, calendar.Date(c.signedOn)))
			require.NotNil(t, store.activated)
			assert.Equal(t, c.want, *store.activated)
		})
	}
}

// A changed version that ended before the parents signed it takes no
// effect: its care is over.
func TestSignedChangeThatEndedIsNotSigned(t *testing.T) {
	t.Parallel()
	ended := calendar.NewDate(2028, 3, 15)
	record := ContractRecord{Version: activationVersion(9, carecontract.VersionRequested, "2028-03-01")}
	record.Version.EndsOn = &ended
	store := &activationStore{versions: []carecontract.Version{activationVersion(1, carecontract.VersionEffective, "2027-08-01")}}
	err := activateSigned(context.Background(), store, 1, record, calendar.NewDate(2028, 3, 20))
	require.ErrorIs(t, err, carecontract.ErrContractNotSignable)
	assert.Nil(t, store.activated)
}

// The checksum of a version signed late counts the date its document names,
// so the signature stays intact after the version moved to the day of the
// signature.
func TestChecksumOfAVersionSignedLateCountsTheAgreedDate(t *testing.T) {
	t.Parallel()
	fingerprint := func(data []byte) string { return string(data) }
	signed := activationVersion(9, carecontract.VersionRequested, "2028-03-01")
	want, err := versionChecksum(fingerprint, signed)
	require.NoError(t, err)
	agreed := signed.EffectiveFrom
	moved := signed
	moved.Status, moved.EffectiveFrom, moved.AgreedFrom = carecontract.VersionEffective, calendar.NewDate(2028, 3, 20), &agreed
	got, err := versionChecksum(fingerprint, moved)
	require.NoError(t, err)
	assert.Equal(t, want, got)
}
