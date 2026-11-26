package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// dissolveStore is a record, its trail times and the schools' bank rows a
// dissolution reads and writes. Methods a case does not reach stay on the
// nil interface.
type dissolveStore struct {
	ports.TraegerStaffStore
	record    domain.TraegerStaffRecord
	changedAt map[string]time.Time
	// rows are the schools' bank rows by employment; writtenAt is the
	// database clock a write stamps them with.
	rows      map[int64]domain.StaffFinancialData
	writtenAt time.Time
	writes    int
	dissolved bool
	// locked counts the reads of the record under its lock; meanwhile, when
	// set, changes the record after a school's write, as a colleague's write
	// committed during the dissolution would.
	locked    int
	meanwhile func(*dissolveStore)
}

func (s *dissolveStore) TraegerStaffRelease(context.Context, int64) (*domain.TraegerStaffRelease, error) {
	return &domain.TraegerStaffRelease{OrganizationID: s.record.OrganizationID}, nil
}

func (s *dissolveStore) FindStaffRecord(_ context.Context, _ int64, _ int64, forUpdate bool) (domain.TraegerStaffRecord, error) {
	if forUpdate {
		s.locked++
	}
	return s.record, nil
}

func (s *dissolveStore) FinancialChangeTimes(context.Context, int64, int64) (map[string]time.Time, error) {
	return s.changedAt, nil
}

func (s *dissolveStore) SchoolFinancialRows(_ context.Context, staffIDs []int64) ([]domain.StaffFinancialData, error) {
	var rows []domain.StaffFinancialData
	for _, staffID := range staffIDs {
		if row, ok := s.rows[staffID]; ok {
			rows = append(rows, row)
		}
	}
	return rows, nil
}

func (s *dissolveStore) WriteSchoolFinancialRow(_ context.Context, row domain.StaffFinancialData) error {
	for _, link := range s.record.Links {
		if link.StaffID == row.StaffID {
			row.TenantID = link.SchoolID
		}
	}
	row.UpdatedAt = s.writtenAt
	s.rows[row.StaffID] = row
	s.wrote()
	return nil
}

func (s *dissolveStore) DeleteSchoolFinancialRow(_ context.Context, staffID int64) error {
	delete(s.rows, staffID)
	s.wrote()
	return nil
}

func (s *dissolveStore) wrote() {
	s.writes++
	if s.meanwhile != nil {
		s.meanwhile(s)
	}
}

func (s *dissolveStore) DeleteStaffRecord(context.Context, int64, int64) error {
	s.dissolved = true
	return nil
}

// dissolveAudit collects the schools' master data entries.
type dissolveAudit struct {
	ports.StaffAdminAudit
	changes *[]domain.MasterDataChange
}

func (a dissolveAudit) RecordMasterDataChange(_ context.Context, change domain.MasterDataChange) error {
	*a.changes = append(*a.changes, change)
	return nil
}

// dissolveLinkedAt is when the employments of the dissolution tests were
// linked; dissolveHeldAt is when the link held a school's row back.
var (
	dissolveLinkedAt = time.Date(2026, time.November, 20, 10, 0, 0, 0, time.UTC)
	dissolveHeldAt   = dissolveLinkedAt.Add(time.Second)
)

// The values of the dissolution tests: what the school entered and what
// the record holds.
const (
	schoolIBAN = "DE02120300000000202051"
	schoolTax  = "12345678901"
	schoolSSN  = "12150790M004"
	recordIBAN = "DE89370400440532013000"
	recordTax  = "98765432109"
)

// dissolveFixture is a record with IBAN and tax ID and Einsatzorte at school
// 2 (employment 10) and school 3 (employment 11).
func dissolveFixture(t *testing.T) (*TraegerStaff, *dissolveStore, *[]domain.MasterDataChange) {
	t.Helper()
	service := &TraegerStaff{bank: fakeBankCipher{}}
	record := domain.TraegerStaffRecord{ID: 7, OrganizationID: 1, Links: []domain.TraegerStaffLink{
		{SchoolID: 2, StaffID: 10, LinkedAt: dissolveLinkedAt}, {SchoolID: 3, StaffID: 11, LinkedAt: dissolveLinkedAt},
	}}
	require.NoError(t, service.sealRecordFinancial(&record, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: recordTax}))
	store := &dissolveStore{record: record, rows: map[int64]domain.StaffFinancialData{}, writtenAt: dissolveLinkedAt.Add(time.Hour)}
	changes := &[]domain.MasterDataChange{}
	service.store = store
	service.ports = workforce.TraegerStaffPorts{Employments: linkLockSchool{}, Persons: linkLockSchool{}, Runtime: linkLockRuntime{}}
	service.subjects = linkLockSubjects{}
	service.audit = dissolveAudit{changes: changes}
	return service, store, changes
}

// schoolRow seals the school's own values into its row of employment 10.
func schoolRow(t *testing.T, service *TraegerStaff, values map[string]string, updatedAt time.Time) domain.StaffFinancialData {
	t.Helper()
	row, err := service.schoolFinancialRow(2, 10, values)
	require.NoError(t, err)
	row.TenantID, row.UpdatedAt = 2, updatedAt
	return row
}

// schoolValues opens the bank row of an employment as the school sees it.
func schoolValues(t *testing.T, service *TraegerStaff, store *dissolveStore, staffID int64) map[string]string {
	t.Helper()
	row, ok := store.rows[staffID]
	if !ok {
		return nil
	}
	values, err := service.openSchoolFinancial(row)
	require.NoError(t, err)
	return values
}

func dissolveActor() workforce.TraegerStaffActor {
	return workforce.TraegerStaffActor{OrganizationID: 1, AccountID: 9}
}

// A row the link held back keeps what the school entered, except where the
// Personalverwaltung changed the field after the hold: there the record's
// value wins, an emptied one included (#8029). Each changed field leaves an
// entry in the school's master data audit, mask to mask.
func TestDissolveGivesAHeldRowTheFieldsChangedAfterTheHold(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	store.rows[10] = schoolRow(t, service, map[string]string{
		domain.StaffFieldIBAN: schoolIBAN, domain.StaffFieldTaxID: schoolTax, domain.StaffFieldSocialSecurityNumber: schoolSSN,
	}, dissolveHeldAt)
	store.changedAt = map[string]time.Time{
		domain.StaffFieldIBAN:                 dissolveHeldAt.Add(time.Minute),
		domain.StaffFieldTaxID:                dissolveLinkedAt,
		domain.StaffFieldSocialSecurityNumber: dissolveHeldAt.Add(time.Minute),
	}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.Equal(t, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: schoolTax}, schoolValues(t, service, store, 10),
		"the changed IBAN and the emptied SV-Nummer come from the record, the tax ID stays the school's")
	assert.Equal(t, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: recordTax}, schoolValues(t, service, store, 11),
		"a school without a row gets the record's values")
	assert.True(t, store.dissolved)

	school2 := auditOf(*changes, 10)
	require.Len(t, school2, 2, "only the fields that changed at the school are in its audit")
	assert.Equal(t, domain.MasterDataChange{
		StaffID: 10, ChangedBy: 9, Section: domain.AuditSectionBankSteuer, Field: domain.StaffFieldIBAN,
		OldValue: domain.MaskStaffValue(domain.StaffFieldIBAN, schoolIBAN), NewValue: domain.MaskStaffValue(domain.StaffFieldIBAN, recordIBAN), Note: noteReturnedByTraeger,
	}, school2[0])
	assert.Equal(t, domain.StaffFieldSocialSecurityNumber, school2[1].Field)
	assert.NotEmpty(t, school2[1].OldValue)
	assert.Empty(t, school2[1].NewValue)
	assert.Len(t, auditOf(*changes, 11), 2)
}

// A held row with no later change of the Personalverwaltung stays as the
// school entered it: no write, no audit entry.
func TestDissolveKeepsAHeldRowWithoutALaterChange(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	held := schoolRow(t, service, map[string]string{domain.StaffFieldIBAN: schoolIBAN, domain.StaffFieldTaxID: schoolTax}, dissolveHeldAt)
	store.rows[10] = held
	store.changedAt = map[string]time.Time{domain.StaffFieldIBAN: dissolveLinkedAt, domain.StaffFieldTaxID: dissolveLinkedAt}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.Equal(t, held, store.rows[10], "the held row is not written")
	assert.Empty(t, auditOf(*changes, 10))
}

// A row from before the link, one a failed hand-over left at the school,
// loses to the record in every field.
func TestDissolveReplacesARowFromBeforeTheLink(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	store.rows[10] = schoolRow(t, service, map[string]string{
		domain.StaffFieldIBAN: schoolIBAN, domain.StaffFieldTaxID: recordTax, domain.StaffFieldSocialSecurityNumber: schoolSSN,
	}, dissolveLinkedAt.Add(-time.Hour))

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.Equal(t, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: recordTax}, schoolValues(t, service, store, 10))
	fields := []string{}
	for _, change := range auditOf(*changes, 10) {
		fields = append(fields, change.Field)
	}
	assert.Equal(t, []string{domain.StaffFieldIBAN, domain.StaffFieldSocialSecurityNumber}, fields, "the unchanged tax ID writes no entry")
}

// A dissolution that fails at a later school repeats (ADR 0233 section 6):
// the school that got its values back keeps them, without a second write or
// audit entry, and the record goes only once every school has its values.
func TestDissolveRepeatsWithTheSameResult(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	store.rows[10] = schoolRow(t, service, map[string]string{domain.StaffFieldIBAN: schoolIBAN}, dissolveLinkedAt.Add(-time.Hour))
	service.ports.Runtime = linkLockRuntime{failSchool: 3}

	require.Error(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.False(t, store.dissolved)
	returned := schoolValues(t, service, store, 10)
	assert.Equal(t, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: recordTax}, returned)
	writes, entries := store.writes, len(*changes)

	service.ports.Runtime = linkLockRuntime{}
	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.True(t, store.dissolved)
	assert.Equal(t, returned, schoolValues(t, service, store, 10), "the repeat keeps the returned values")
	assert.Equal(t, writes+1, store.writes, "only school 3 is written")
	assert.Len(t, auditOf(*changes, 10), entries, "school 2 gets no second entry")
}

// auditOf returns the audit entries of one employment in their order.
func auditOf(changes []domain.MasterDataChange, staffID int64) []domain.MasterDataChange {
	var entries []domain.MasterDataChange
	for _, change := range changes {
		if change.StaffID == staffID {
			entries = append(entries, change)
		}
	}
	return entries
}

// A held row whose only value the Personalverwaltung emptied after the hold
// keeps no value: the school's row goes instead of staying as an empty row,
// with the emptied value in its audit.
func TestDissolveDeletesARowLeftWithoutAValue(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	store.rows[10] = schoolRow(t, service, map[string]string{domain.StaffFieldSocialSecurityNumber: schoolSSN}, dissolveHeldAt)
	store.changedAt = map[string]time.Time{domain.StaffFieldSocialSecurityNumber: dissolveHeldAt.Add(time.Minute)}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	_, kept := store.rows[10]
	assert.False(t, kept, "a row without a value goes")
	entries := auditOf(*changes, 10)
	require.Len(t, entries, 1)
	assert.Equal(t, domain.StaffFieldSocialSecurityNumber, entries[0].Field)
	assert.Empty(t, entries[0].NewValue)
}

// recordIBANLater is the IBAN the Personalverwaltung saves while a
// dissolution writes the schools.
const recordIBANLater = "DE75512108001245126199"

// The Personalverwaltung saves a new IBAN while the dissolution writes the
// schools. The record is not deleted over it: the return runs again, and the
// new IBAN reaches every school, also one whose row the first attempt
// stamped after the trail entry of the save (both stamps are transaction
// starts). The record is read and deleted under its lock.
func TestDissolveReturnsAValueSavedDuringTheDissolution(t *testing.T) {
	t.Parallel()
	service, store, changes := dissolveFixture(t)
	store.meanwhile = func(s *dissolveStore) {
		s.meanwhile = nil
		require.NoError(t, service.sealRecordFinancial(&s.record, map[string]string{domain.StaffFieldIBAN: recordIBANLater, domain.StaffFieldTaxID: recordTax}))
		s.changedAt = map[string]time.Time{domain.StaffFieldIBAN: s.writtenAt.Add(-time.Minute)}
	}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.True(t, store.dissolved)
	want := map[string]string{domain.StaffFieldIBAN: recordIBANLater, domain.StaffFieldTaxID: recordTax}
	assert.Equal(t, want, schoolValues(t, service, store, 10), "the school written first gets the new IBAN as well")
	assert.Equal(t, want, schoolValues(t, service, store, 11))
	assert.Equal(t, 3, store.locked, "the first read and the check before each delete take the lock")
	assert.Len(t, auditOf(*changes, 10), 3, "school 2 logs both values, then the new IBAN")
}

// An Einsatzort linked while the dissolution writes the schools handed its
// bank row to the record. The record is not deleted with that link: the
// return runs again and gives the new school the record's values.
func TestDissolveReturnsToAnEinsatzortLinkedDuringTheDissolution(t *testing.T) {
	t.Parallel()
	service, store, _ := dissolveFixture(t)
	store.meanwhile = func(s *dissolveStore) {
		s.meanwhile = nil
		s.record.Links = append(s.record.Links, domain.TraegerStaffLink{SchoolID: 4, StaffID: 12, LinkedAt: s.writtenAt.Add(time.Minute)})
	}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.True(t, store.dissolved)
	assert.Equal(t, map[string]string{domain.StaffFieldIBAN: recordIBAN, domain.StaffFieldTaxID: recordTax}, schoolValues(t, service, store, 12),
		"the school linked meanwhile keeps the bank values")
}

// A record that changes on every attempt is refused as changed after the
// last one and stays: nothing is lost, the Personalverwaltung dissolves it
// again (ADR 0311).
func TestDissolveRefusesARecordThatKeepsChanging(t *testing.T) {
	t.Parallel()
	service, store, _ := dissolveFixture(t)
	ibans := []string{recordIBANLater, schoolIBAN, recordIBAN, recordIBANLater, schoolIBAN, recordIBAN}
	store.meanwhile = func(s *dissolveStore) {
		require.NoError(t, service.sealRecordFinancial(&s.record, map[string]string{domain.StaffFieldIBAN: ibans[s.writes%len(ibans)]}))
	}

	require.ErrorIs(t, service.Dissolve(context.Background(), dissolveActor(), 7), readstate.ErrChanged)
	assert.False(t, store.dissolved)
}

// An Einsatzort linked while the dissolution writes the schools holds a
// newer IBAN its school saved during the link (HoldSchoolFinancialRow), and
// the link changed the record's IBAN. The value the record changed meanwhile
// wins only at the Einsatzorte the earlier attempt already wrote: the newly
// linked school keeps the IBAN the Personalverwaltung has not seen.
func TestDissolveKeepsARowHeldByALinkDuringTheDissolution(t *testing.T) {
	t.Parallel()
	service, store, _ := dissolveFixture(t)
	linkedAt := store.writtenAt.Add(time.Minute)
	store.meanwhile = func(s *dissolveStore) {
		s.meanwhile = nil
		s.record.Links = append(s.record.Links, domain.TraegerStaffLink{SchoolID: 4, StaffID: 12, LinkedAt: linkedAt})
		require.NoError(t, service.sealRecordFinancial(&s.record, map[string]string{domain.StaffFieldIBAN: recordIBANLater, domain.StaffFieldTaxID: recordTax}))
		s.changedAt = map[string]time.Time{domain.StaffFieldIBAN: linkedAt}
		s.rows[12] = schoolRow(t, service, map[string]string{domain.StaffFieldIBAN: schoolIBAN}, linkedAt.Add(time.Second))
	}

	require.NoError(t, service.Dissolve(context.Background(), dissolveActor(), 7))
	assert.True(t, store.dissolved)
	assert.Equal(t, schoolIBAN, schoolValues(t, service, store, 12)[domain.StaffFieldIBAN],
		"the school linked meanwhile keeps the IBAN it held")
	assert.Equal(t, recordIBANLater, schoolValues(t, service, store, 10)[domain.StaffFieldIBAN],
		"a school written before the change gets the record's new IBAN")
}
