package application

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Financial serves the bank and tax section of a record: masked, or with
// reveal the values as entered. The read is logged at every Einsatzort
// first; nothing leaves without the entries (ADR 0089 section 6).
func (t *TraegerStaff) Financial(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, reveal bool) (workforce.TraegerStaffFinancial, error) {
	var record domain.TraegerStaffRecord
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false)
		return err
	})
	if err != nil {
		return workforce.TraegerStaffFinancial{}, publicTraegerStaffError(err)
	}
	view := workforce.TraegerStaffViewFinancial
	if reveal {
		view = workforce.TraegerStaffViewFinancialReveal
	}
	if _, err := t.readSchools(ctx, actor, staffView{name: view, recordID: record.ID}, linkSchools(record), linkWanted(record), false); err != nil {
		return workforce.TraegerStaffFinancial{}, err
	}
	if !reveal {
		return maskedRecordFinancial(record), nil
	}
	values, err := t.openRecordFinancial(record)
	if err != nil {
		return workforce.TraegerStaffFinancial{}, err
	}
	return workforce.TraegerStaffFinancial{
		IBAN: optional(values[domain.StaffFieldIBAN]), TaxID: optional(values[domain.StaffFieldTaxID]),
		SocialSecurityNumber: optional(values[domain.StaffFieldSocialSecurityNumber]),
		Version:              financialVersion(record),
	}, nil
}

// UpdateFinancial replaces the bank and tax section of a record. The trail
// keeps each replaced value, sealed. A section changed since the form read
// it is refused under the record lock (ADR 0311).
func (t *TraegerStaff) UpdateFinancial(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, input workforce.StammdatenFinancialInput) error {
	section, err := domain.NormalizeFinancialSection(domain.FinancialSection{IBAN: input.IBAN, TaxID: input.TaxID, SocialSecurityNumber: input.SocialSecurityNumber})
	if err != nil {
		return publicTraegerStaffError(err)
	}
	after := map[string]string{
		domain.StaffFieldIBAN: domain.Deref(section.IBAN), domain.StaffFieldTaxID: domain.Deref(section.TaxID),
		domain.StaffFieldSocialSecurityNumber: domain.Deref(section.SocialSecurityNumber),
	}
	var saved domain.TraegerStaffRecord
	err = t.released(ctx, actor, func(ctx context.Context) error {
		saved, err = t.writeFinancial(ctx, actor, recordID, domain.Deref(input.ExpectedVersion), after)
		return err
	})
	if err != nil {
		return publicTraegerStaffError(err)
	}
	if saved.ID == 0 {
		return nil
	}
	_, err = t.handOver(ctx, actor, saved, nil)
	return err
}

// writeFinancial seals the section under the record lock with the trail of
// every replaced value; a section that differs from the expected version is
// refused before anything is written. An unchanged section returns no
// record.
func (t *TraegerStaff) writeFinancial(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, expectedVersion string, after map[string]string) (domain.TraegerStaffRecord, error) {
	record, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	if err := readstate.Check(expectedVersion, financialVersion(record)); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	before, err := t.openRecordFinancial(record)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	changes, err := t.replacedValues(actor, recordID, before, after)
	if err != nil || len(changes) == 0 {
		return domain.TraegerStaffRecord{}, err
	}
	if err := t.sealRecordFinancial(&record, after); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	if err := t.store.SealStaffRecord(ctx, record); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	return record, t.store.AppendStaffChanges(ctx, actor.OrganizationID, changes)
}

// Dissolve ends a record: every live Einsatzort gets the bank and tax values
// back as its own row, then the record goes with its links and trail. The
// schools' personnel numbers stay. Per field the newer entry wins (#8029,
// returnedFinancial). Each school is written in its own tenant transaction,
// never with the Träger's (ADR 0105), so a dissolution that fails at one
// school repeats (ADR 0233 section 6): a school that got its values back
// keeps them.
//
// The record is read and deleted under its lock, which every write of its
// values and links takes. A record whose values or Einsatzorte changed while
// the schools were written is not deleted: the return runs again on the
// changed record, and a value changed meanwhile wins at every school, being
// newer than anything a school holds. After dissolveAttempts the
// dissolution is refused as changed (ADR 0311).
func (t *TraegerStaff) Dissolve(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64) error {
	var read dissolution
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		read, err = t.lockDissolution(ctx, actor, recordID)
		return err
	})
	if err != nil {
		return publicTraegerStaffError(err)
	}
	newer := map[string]bool{}
	for attempt := 1; ; attempt++ {
		if err := t.returnToSchools(ctx, actor, read, newer); err != nil {
			return err
		}
		current, deleted, err := t.deleteDissolved(ctx, actor, read)
		if err != nil || deleted {
			return publicTraegerStaffError(err)
		}
		if attempt == dissolveAttempts {
			return readstate.ErrChanged
		}
		for _, field := range domain.FinancialStaffFields {
			if read.values[field] != current.values[field] {
				newer[field] = true
			}
		}
		read = current
	}
}

// dissolveAttempts bounds how often a dissolution returns the values again
// on a record that changed under it.
const dissolveAttempts = 3

// dissolution is the record a dissolution returns, read under its lock: the
// opened bank and tax values and, per field, the trail's newest change.
type dissolution struct {
	record    domain.TraegerStaffRecord
	values    map[string]string
	changedAt map[string]time.Time
}

// lockDissolution locks the record and reads it with its trail times. The
// trail is read after the lock in its own statement (ADR 0311): a write of
// the values holds the lock until its trail entries commit with them.
func (t *TraegerStaff) lockDissolution(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64) (dissolution, error) {
	record, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
	if err != nil {
		return dissolution{}, err
	}
	values, err := t.openRecordFinancial(record)
	if err != nil {
		return dissolution{}, err
	}
	changedAt, err := t.store.FinancialChangeTimes(ctx, actor.OrganizationID, recordID)
	return dissolution{record: record, values: values, changedAt: changedAt}, err
}

// deleteDissolved deletes the record under its lock when its values and
// Einsatzorte are still the ones read returned. Otherwise it keeps the
// record and returns it as it is now.
func (t *TraegerStaff) deleteDissolved(ctx context.Context, actor workforce.TraegerStaffActor, read dissolution) (dissolution, bool, error) {
	var current dissolution
	deleted := false
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if current, err = t.lockDissolution(ctx, actor, read.record.ID); err != nil {
			return err
		}
		if financialVersion(current.record) != financialVersion(read.record) || !sameLinks(current.record.Links, read.record.Links) {
			return nil
		}
		deleted = true
		return t.store.DeleteStaffRecord(ctx, actor.OrganizationID, read.record.ID)
	})
	return current, deleted, err
}

// sameLinks reports whether two reads hold the same employments.
func sameLinks(a, b []domain.TraegerStaffLink) bool {
	keys := func(links []domain.TraegerStaffLink) []employmentKey {
		out := make([]employmentKey, 0, len(links))
		for _, link := range links {
			out = append(out, employmentKey{link.SchoolID, link.StaffID})
		}
		slices.SortFunc(out, func(x, y employmentKey) int {
			return cmp.Or(cmp.Compare(x.schoolID, y.schoolID), cmp.Compare(x.staffID, y.staffID))
		})
		return out
	}
	return slices.Equal(keys(a), keys(b))
}

// returnToSchools returns the values to every Einsatzort of the read record,
// each in its school's transaction.
func (t *TraegerStaff) returnToSchools(ctx context.Context, actor workforce.TraegerStaffActor, read dissolution, newer map[string]bool) error {
	for _, link := range read.record.Links {
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			return t.returnToSchool(ctx, actor, link, read, newer)
		})
		if err != nil {
			return publicTraegerStaffError(fmt.Errorf("return to school %d: %w", link.SchoolID, err))
		}
	}
	return nil
}

// returnToSchool writes the values returnedFinancial decides into the
// school's bank row of a live employment, under the lock the school writes
// its row under, with a master data audit entry per field that changes. A
// row left without a value goes.
func (t *TraegerStaff) returnToSchool(ctx context.Context, actor workforce.TraegerStaffActor, link domain.TraegerStaffLink, read dissolution, newer map[string]bool) error {
	live, err := t.schoolStaff(ctx, []int64{link.StaffID})
	if err != nil || len(live) == 0 {
		return err
	}
	if _, err := t.subjects.LockStaff(ctx, link.StaffID, false); err != nil {
		return err
	}
	rows, err := t.store.SchoolFinancialRows(ctx, []int64{link.StaffID})
	if err != nil {
		return err
	}
	school := map[string]string{}
	if len(rows) > 0 {
		if school, err = t.openSchoolFinancial(rows[0]); err != nil {
			return err
		}
	}
	after := returnedFinancial(link, rows, school, read, newer)
	changed := false
	for _, field := range domain.FinancialStaffFields {
		if school[field] == after[field] {
			continue
		}
		changed = true
		if err := t.audit.RecordMasterDataChange(ctx, domain.MasterDataChange{
			StaffID: link.StaffID, ChangedBy: actor.AccountID, Section: domain.AuditSectionBankSteuer, Field: field,
			OldValue: domain.MaskStaffValue(field, school[field]), NewValue: domain.MaskStaffValue(field, after[field]), Note: noteReturnedByTraeger,
		}); err != nil {
			return fmt.Errorf("write bank return audit: %w", err)
		}
	}
	if !changed {
		return nil
	}
	if len(after) == 0 {
		return t.store.DeleteSchoolFinancialRow(ctx, link.StaffID)
	}
	row, err := t.schoolFinancialRow(link.SchoolID, link.StaffID, after)
	if err != nil {
		return err
	}
	return t.store.WriteSchoolFinancialRow(ctx, row)
}

// returnedFinancial decides the school's bank values when its Träger
// dissolves a record (#8029): per field the newer entry wins. A school
// without a row, or with a row from before the link (one a failed hand-over
// left), gets the record's values. A row stamped after the link is one the
// link held back (HoldSchoolFinancialRow) or an earlier attempt of the
// dissolution wrote: it keeps a value unless the trail changed or imported
// that field after the row's stamp, or the field changed while the
// dissolution ran (newer), a value then emptied included. Both stamps are
// on the database clock (ADR 0280).
func returnedFinancial(link domain.TraegerStaffLink, rows []domain.StaffFinancialData, school map[string]string, read dissolution, newer map[string]bool) map[string]string {
	if len(rows) == 0 || !rows[0].UpdatedAt.After(link.LinkedAt) {
		return read.values
	}
	after := map[string]string{}
	for _, field := range domain.FinancialStaffFields {
		value := school[field]
		if at, ok := read.changedAt[field]; newer[field] || (ok && at.After(rows[0].UpdatedAt)) {
			value = read.values[field]
		}
		if value != "" {
			after[field] = value
		}
	}
	return after
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
