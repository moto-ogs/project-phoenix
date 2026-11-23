package application

import (
	"context"
	"errors"
	"testing"
	"time"

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
	// holdAt is the database clock of a hold; trail collects the Träger's
	// trail entries.
	holdAt time.Time
	trail  []domain.TraegerStaffChange
	// accesses are the school's access log entries.
	accesses []domain.DataAccess
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
	s.bank = nil
	return nil
}

func (s *linkLockStore) HoldSchoolFinancialRow(context.Context, int64) error {
	s.bank[0].UpdatedAt = s.holdAt
	return nil
}

func (s *linkLockStore) TraegerStaffRelease(context.Context, int64) (*domain.TraegerStaffRelease, error) {
	return &domain.TraegerStaffRelease{OrganizationID: 1}, nil
}

func (s *linkLockStore) AppendStaffChanges(_ context.Context, _ int64, changes []domain.TraegerStaffChange) error {
	s.trail = append(s.trail, changes...)
	return nil
}

// linkLockRuntime runs every school's and the Träger's transaction inline;
// the transaction of failSchool fails before it starts.
type linkLockRuntime struct{ failSchool int64 }

// errSchoolDown is the failure of the school a hand-over cannot reach.
var errSchoolDown = errors.New("school transaction failed")

func (r linkLockRuntime) WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
	if schoolID == r.failSchool {
		return errSchoolDown
	}
	return fn(ctx)
}

func (linkLockRuntime) WithinTraeger(ctx context.Context, _ int64, fn func(context.Context) error) error {
	return fn(ctx)
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

// linkLockAudit collects the school's access entries.
type linkLockAudit struct {
	ports.StaffAdminAudit
	accesses *[]domain.DataAccess
}

func (linkLockAudit) RecordMasterDataChange(context.Context, domain.MasterDataChange) error {
	return nil
}

func (a linkLockAudit) RecordDataAccess(_ context.Context, access domain.DataAccess) error {
	*a.accesses = append(*a.accesses, access)
	return nil
}

func linkLockService(store *linkLockStore) *TraegerStaff {
	return &TraegerStaff{
		store:    store,
		ports:    workforce.TraegerStaffPorts{Employments: linkLockSchool{}, Persons: linkLockSchool{}, Runtime: linkLockRuntime{}},
		subjects: linkLockSubjects{},
		audit:    linkLockAudit{accesses: &store.accesses},
		clock:    fixedClock{now: linkLockLinkedAt.Add(time.Minute)},
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

	link := domain.TraegerStaffLink{SchoolID: 2, StaffID: 10, LinkedAt: linkLockLinkedAt}

	store := &linkLockStore{bank: newer, holdAt: linkLockLinkedAt.Add(time.Second)}
	none := bankRowState(nil)
	outcome, err := linkLockService(store).handOverSchool(context.Background(), actor, link, nil, &none)
	require.NoError(t, err)
	assert.True(t, outcome.changed)
	assert.NotNil(t, outcome.held)
	assert.False(t, store.deleted, "the school keeps the row the link did not read")

	read := bankRowState(newer)
	store = &linkLockStore{bank: newer}
	outcome, err = linkLockService(store).handOverSchool(context.Background(), actor, link, nil, &read)
	require.NoError(t, err)
	assert.False(t, outcome.changed)
	assert.True(t, store.deleted, "the row the link read moves to the record")
}

// linkLockLinkedAt is when the employment of the hand-over tests was linked.
var linkLockLinkedAt = time.Date(2026, time.November, 20, 10, 0, 0, 0, time.UTC)

// linkLockRecord is a record holding the employment of the hand-over tests.
func linkLockRecord() domain.TraegerStaffRecord {
	return domain.TraegerStaffRecord{ID: 7, OrganizationID: 1, Links: []domain.TraegerStaffLink{{SchoolID: 2, StaffID: 10, LinkedAt: linkLockLinkedAt}}}
}

// A row the link held back stays at the school on every later write of the
// record (UpdatePersonnelNumber, the bank values, a hire): its catch-up does
// not delete a value the Personalverwaltung has not seen. The link names the
// kept values in the Träger's trail and refuses as changed.
func TestHandOverKeepsAHeldBankRowOnLaterWrites(t *testing.T) {
	t.Parallel()
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
	record := linkLockRecord()
	store := &linkLockStore{
		bank:   []domain.StaffFinancialData{{StaffID: 10, IBANSealed: []byte("sealed-new"), IBANMasked: new("DE** **** 4711"), UpdatedAt: linkLockLinkedAt.Add(-time.Second)}},
		holdAt: linkLockLinkedAt.Add(time.Second),
	}
	service := linkLockService(store)

	planned := map[employmentKey]string{{2, 10}: bankRowState(nil)}
	require.ErrorIs(t, service.handOver(context.Background(), actor, record, planned), readstate.ErrChanged)
	require.Len(t, store.trail, 1)
	assert.Equal(t, domain.StaffChangeNotChosen, store.trail[0].Kind)
	assert.Equal(t, domain.StaffFieldIBAN, store.trail[0].Field)
	assert.Equal(t, "DE** **** 4711", domain.Deref(store.trail[0].ValueMasked))
	require.NotNil(t, store.trail[0].SchoolID)
	assert.Equal(t, record.Links[0].SchoolID, *store.trail[0].SchoolID)
	require.Len(t, store.accesses, 1, "the school logs the Träger's read of the masks")
	assert.Equal(t, workforce.StaffDataAccessFinancialView, store.accesses[0].Resource)
	assert.Equal(t, record.Links[0].StaffID, store.accesses[0].StaffID)
	assert.Equal(t, actor.AccountID, store.accesses[0].ActorAccountID)
	assert.Equal(t, actorRoleTraeger, store.accesses[0].ActorRole)

	require.NoError(t, service.handOver(context.Background(), actor, record, nil))
	assert.False(t, store.deleted, "the held row survives the next write")
	assert.Len(t, store.trail, 1, "the catch-up adds no entry of its own")
	assert.Len(t, store.accesses, 1, "the catch-up reads no mask")
}

// The catch-up still hands over a row from before the link, one a school
// whose hand-over failed kept by accident.
func TestHandOverCatchUpMovesARowFromBeforeTheLink(t *testing.T) {
	t.Parallel()
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
	store := &linkLockStore{bank: []domain.StaffFinancialData{{StaffID: 10, IBANSealed: []byte("sealed-old"), UpdatedAt: linkLockLinkedAt.Add(-time.Hour)}}}

	require.NoError(t, linkLockService(store).handOver(context.Background(), actor, linkLockRecord(), nil))
	assert.True(t, store.deleted)
	assert.Empty(t, store.trail)
}

// A link whose school row changed since its read is refused as changed
// (ADR 0311) once the school is through, also when the row is gone: the
// record holds what the link read, the person sees the new state.
func TestHandOverRefusesALinkWhoseBankRowChanged(t *testing.T) {
	t.Parallel()
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
	read := []domain.StaffFinancialData{{StaffID: 10, IBANSealed: []byte("sealed-read")}}

	store := &linkLockStore{}
	planned := map[employmentKey]string{{2, 10}: bankRowState(read)}
	require.ErrorIs(t, linkLockService(store).handOver(context.Background(), actor, linkLockRecord(), planned), readstate.ErrChanged)

	store = &linkLockStore{bank: read}
	require.NoError(t, linkLockService(store).handOver(context.Background(), actor, linkLockRecord(), planned))
	assert.True(t, store.deleted)
}

// A school that holds a changed row commits the hold in its own transaction.
// When a later school's hand-over fails, the Träger's trail still names the
// held values: no later catch-up would add the entry.
func TestHandOverNamesAHeldRowWhenALaterSchoolFails(t *testing.T) {
	t.Parallel()
	actor := workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
	record := linkLockRecord()
	record.Links = append(record.Links, domain.TraegerStaffLink{SchoolID: 3, StaffID: 11, LinkedAt: linkLockLinkedAt})
	store := &linkLockStore{
		bank:   []domain.StaffFinancialData{{StaffID: 10, IBANSealed: []byte("sealed-new"), IBANMasked: new("DE** **** 4711"), UpdatedAt: linkLockLinkedAt.Add(-time.Second)}},
		holdAt: linkLockLinkedAt.Add(time.Second),
	}
	service := linkLockService(store)
	service.ports.Runtime = linkLockRuntime{failSchool: 3}

	planned := map[employmentKey]string{{2, 10}: bankRowState(nil)}
	err := service.handOver(context.Background(), actor, record, planned)
	require.Error(t, err)
	assert.NotErrorIs(t, err, readstate.ErrChanged, "the failed school decides the answer")
	require.Len(t, store.trail, 1, "the held row of school 2 has its trail entry")
	assert.Equal(t, domain.StaffChangeNotChosen, store.trail[0].Kind)
	require.NotNil(t, store.trail[0].SchoolID)
	assert.Equal(t, record.Links[0].SchoolID, *store.trail[0].SchoolID)
}
