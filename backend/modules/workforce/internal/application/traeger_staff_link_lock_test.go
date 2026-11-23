package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// errSaved stops a write once it reached the record: the test only asks
// whether it got there.
var errSaved = errors.New("record saved")

// linkLockStore is the record and the school's bank row a link writes under
// its locks. Methods a case does not reach stay on the nil interface.
type linkLockStore struct {
	ports.TraegerStaffStore
	record  domain.TraegerStaffRecord
	bank    []domain.StaffFinancialData
	saved   bool
	deleted bool
}

func (s *linkLockStore) FindStaffRecord(context.Context, int64, int64, bool) (domain.TraegerStaffRecord, error) {
	return s.record, nil
}

func (s *linkLockStore) SaveStaffRecord(context.Context, domain.TraegerStaffRecord) (int64, error) {
	s.saved = true
	return 0, errSaved
}

func (s *linkLockStore) SchoolFinancialRows(context.Context, []int64) ([]domain.StaffFinancialData, error) {
	return s.bank, nil
}

func (s *linkLockStore) DeleteSchoolFinancialRow(context.Context, int64) error {
	s.deleted = true
	return nil
}

type linkLockSchool struct{}

func (linkLockSchool) SchoolEmployments(_ context.Context, staffIDs []int64) ([]workforce.TraegerSchoolEmployment, error) {
	return []workforce.TraegerSchoolEmployment{{StaffID: staffIDs[0], PersonID: 3}}, nil
}

func (linkLockSchool) SchoolPersons(context.Context, []int64) ([]workforce.TraegerSchoolPerson, error) {
	return []workforce.TraegerSchoolPerson{{PersonID: 3, FirstName: "Mira", LastName: "Sommer"}}, nil
}

type linkLockSubjects struct{ ports.StaffSubjects }

func (linkLockSubjects) LockStaff(_ context.Context, staffID int64, _ bool) (domain.StaffSubject, error) {
	return domain.StaffSubject{ID: staffID}, nil
}

type linkLockAudit struct{ ports.StaffAdminAudit }

func (linkLockAudit) RecordMasterDataChange(context.Context, domain.MasterDataChange) error {
	return nil
}

func linkLockService(store *linkLockStore) *TraegerStaff {
	return &TraegerStaff{
		store:    store,
		ports:    workforce.TraegerStaffPorts{Employments: linkLockSchool{}, Persons: linkLockSchool{}},
		subjects: linkLockSubjects{},
		audit:    linkLockAudit{},
	}
}

// A link chose its values on the record as it read it. A colleague who
// changed the record between that read and the lock is not overwritten
// (ADR 0311): the write refuses before it saves anything.
func TestLinkRefusesARecordChangedBeforeItsLock(t *testing.T) {
	t.Parallel()
	read := domain.TraegerStaffRecord{ID: 7, OrganizationID: 1, FirstName: "Mira", LastName: "Sommer"}
	plan := linkPlan{record: &read, state: []linkSourceState{recordState(read, recordValues(read, map[string]string{}))}}
	resolved := domain.ResolvedStaffFields{Values: map[string]string{domain.StaffFieldFirstName: "Mira", domain.StaffFieldLastName: "Sommer"}}
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}

	changed := read
	changed.LastName = "Sommer-Berg"
	store := &linkLockStore{record: changed}
	_, err := linkLockService(store).writeLink(context.Background(), actor, plan, resolved)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.False(t, store.saved, "nothing is written over the colleague's change")

	store = &linkLockStore{record: read}
	_, err = linkLockService(store).writeLink(context.Background(), actor, plan, resolved)
	require.ErrorIs(t, err, errSaved, "the record as read is written")
}

// The link moves a school's bank row to the record as it read it. A row the
// school entered or changed since stays at the school, and the link reports
// the change: a new IBAN is neither deleted nor taken over unseen.
func TestHandOverKeepsABankRowTheLinkDidNotRead(t *testing.T) {
	t.Parallel()
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
	newer := []domain.StaffFinancialData{{StaffID: 10, IBANSealed: []byte("sealed-new")}}

	store := &linkLockStore{bank: newer}
	none := bankRowState(nil)
	kept, err := linkLockService(store).handOverSchool(context.Background(), actor, 10, nil, &none)
	require.NoError(t, err)
	assert.True(t, kept)
	assert.False(t, store.deleted, "the school keeps the row the link did not read")

	read := bankRowState(newer)
	store = &linkLockStore{bank: newer}
	kept, err = linkLockService(store).handOverSchool(context.Background(), actor, 10, nil, &read)
	require.NoError(t, err)
	assert.False(t, kept)
	assert.True(t, store.deleted, "the row the link read moves to the record")
}
