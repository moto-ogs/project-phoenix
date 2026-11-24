package application

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The Nachweise of the Personalstamm (#4707, ADR 0089 section 7). Kinds,
// proofs and mappings live in the Träger transaction of the session's
// Träger; the schools are read and logged only in their own tenant
// transactions, before or after it (ADR 0105).

var _ workforce.TraegerStaffProofs = (*TraegerStaff)(nil)

func (t *TraegerStaff) today() calendar.Date {
	return calendar.DateFromTime(t.clock.Now())
}

// proofKinds adds the standard kinds the Träger does not have yet and lists
// all of its kinds, in the caller's Träger transaction.
func (t *TraegerStaff) proofKinds(ctx context.Context, organizationID int64) ([]domain.TraegerProofType, error) {
	if err := t.store.EnsureStandardProofTypes(ctx, organizationID, domain.StandardTraegerProofTypes()); err != nil {
		return nil, err
	}
	return t.store.ListProofTypes(ctx, organizationID)
}

// recordProofs is the state of every kind at one record, in the caller's
// Träger transaction.
func (t *TraegerStaff) recordProofs(ctx context.Context, organizationID, recordID int64) ([]workforce.TraegerStaffProof, error) {
	kinds, err := t.proofKinds(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	proofs, err := t.store.ListProofs(ctx, organizationID, []int64{recordID})
	if err != nil {
		return nil, err
	}
	return proofStates(kinds, proofs, t.today()), nil
}

// proofStates lists the live kinds in their order with the record's proof,
// then archived kinds the record still holds a proof of.
func proofStates(kinds []domain.TraegerProofType, proofs []domain.TraegerProof, today calendar.Date) []workforce.TraegerStaffProof {
	held := make(map[int64]domain.TraegerProof, len(proofs))
	for _, proof := range proofs {
		held[proof.TypeID] = proof
	}
	states := make([]workforce.TraegerStaffProof, 0, len(kinds))
	for _, kind := range kinds {
		proof, ok := held[kind.ID]
		if kind.Archived() && !ok {
			continue
		}
		state := workforce.TraegerStaffProof{
			TypeID: ident.ID(kind.ID), TypeName: kind.Name, Mandatory: kind.Mandatory, PoliceCertificate: kind.PoliceCertificate(), Held: ok,
		}
		if ok {
			state.PresentedOn, state.IssuedOn, state.NoRelevantEntry, state.ExpiresOn = proof.PresentedOn, proof.IssuedOn, proof.NoRelevantEntry, proof.ExpiresOn
			state.Status = domain.TraegerProofStatus(kind, &proof, today)
		} else {
			state.Status = domain.TraegerProofStatus(kind, nil, today)
		}
		states = append(states, state)
	}
	return states
}

// ProofTypes lists the kinds of the Träger, the standard list included.
func (t *TraegerStaff) ProofTypes(ctx context.Context, actor workforce.TraegerStaffActor) ([]workforce.TraegerStaffProofType, error) {
	var kinds []domain.TraegerProofType
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		kinds, err = t.proofKinds(ctx, actor.OrganizationID)
		return err
	})
	if err != nil {
		return nil, publicProofError(err)
	}
	return publicProofTypes(kinds), nil
}

// CreateProofType adds a kind of the Träger after the existing ones.
func (t *TraegerStaff) CreateProofType(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerStaffProofTypeInput) (workforce.TraegerStaffProofType, error) {
	if input.Archived {
		return workforce.TraegerStaffProofType{}, &workforce.TraegerProofError{Field: "archived", Reason: "a new kind cannot be archived"}
	}
	return t.saveProofType(ctx, actor, 0, input)
}

// UpdateProofType rewrites a kind. Archiving keeps the first archive time;
// restoring a kind whose name a live kind took meanwhile is refused as a
// taken name, and a kind changed since the form read it as changed.
func (t *TraegerStaff) UpdateProofType(ctx context.Context, actor workforce.TraegerStaffActor, id int64, input workforce.TraegerStaffProofTypeInput) (workforce.TraegerStaffProofType, error) {
	if id <= 0 {
		return workforce.TraegerStaffProofType{}, workforce.ErrTraegerProofTypeNotFound
	}
	return t.saveProofType(ctx, actor, id, input)
}

func (t *TraegerStaff) saveProofType(ctx context.Context, actor workforce.TraegerStaffActor, id int64, input workforce.TraegerStaffProofTypeInput) (workforce.TraegerStaffProofType, error) {
	kind, err := domain.TraegerProofType{
		ID: id, OrganizationID: actor.OrganizationID, Name: input.Name, ValidityMonths: input.ValidityMonths,
		ReminderLeadWeeks: input.ReminderLeadWeeks, Mandatory: input.Mandatory,
	}.Normalize()
	if err != nil {
		return workforce.TraegerStaffProofType{}, publicProofError(err)
	}
	if input.Archived {
		// The store keeps an earlier archive time.
		archivedAt := t.clock.Now()
		kind.ArchivedAt = &archivedAt
	}
	var saved domain.TraegerProofType
	err = t.released(ctx, actor, func(ctx context.Context) error {
		if err := t.store.EnsureStandardProofTypes(ctx, actor.OrganizationID, domain.StandardTraegerProofTypes()); err != nil {
			return err
		}
		if id > 0 {
			// A kind changed since the form read it is refused (ADR 0311).
			locked, err := t.store.LockProofType(ctx, actor.OrganizationID, id)
			if err != nil {
				return err
			}
			if err := readstate.Check(input.ExpectedVersion, proofTypeVersion(locked)); err != nil {
				return err
			}
		}
		saved, err = t.store.SaveProofType(ctx, kind)
		return err
	})
	if err != nil {
		return workforce.TraegerStaffProofType{}, publicProofError(err)
	}
	return publicProofType(saved), nil
}

// SaveProof records or renews the proof of a live kind at a record and
// returns the record's proofs. The answer shows the record, so every
// Einsatzort gets the access entry.
func (t *TraegerStaff) SaveProof(ctx context.Context, actor workforce.TraegerStaffActor, recordID, typeID int64, input workforce.TraegerStaffProofInput) ([]workforce.TraegerStaffProof, error) {
	return t.changeProof(ctx, actor, recordID, typeID, &input)
}

// DeleteProof removes the proof of a kind from a record, for an entry made
// by mistake; a renewal replaces the proof instead.
func (t *TraegerStaff) DeleteProof(ctx context.Context, actor workforce.TraegerStaffActor, recordID, typeID int64) ([]workforce.TraegerStaffProof, error) {
	if typeID <= 0 {
		return nil, workforce.ErrTraegerProofNotFound
	}
	return t.changeProof(ctx, actor, recordID, typeID, nil)
}

// changeProof saves input as the proof of a kind at a locked record, or
// without input deletes it, and returns the record's proofs after the
// access entry at every Einsatzort.
func (t *TraegerStaff) changeProof(ctx context.Context, actor workforce.TraegerStaffActor, recordID, typeID int64, input *workforce.TraegerStaffProofInput) ([]workforce.TraegerStaffProof, error) {
	var record domain.TraegerStaffRecord
	var states []workforce.TraegerStaffProof
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true); err != nil {
			return err
		}
		kinds, err := t.proofKinds(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		if err := t.writeProof(ctx, actor, recordID, typeID, kinds, input); err != nil {
			return err
		}
		proofs, err := t.store.ListProofs(ctx, actor.OrganizationID, []int64{recordID})
		states = proofStates(kinds, proofs, t.today())
		return err
	})
	if err != nil {
		return nil, publicProofError(err)
	}
	if err := t.logRecords(ctx, actor, staffView{name: workforce.TraegerStaffViewProofChange, recordID: record.ID}, []domain.TraegerStaffRecord{record}); err != nil {
		return nil, err
	}
	return states, nil
}

func (t *TraegerStaff) writeProof(ctx context.Context, actor workforce.TraegerStaffActor, recordID, typeID int64, kinds []domain.TraegerProofType, input *workforce.TraegerStaffProofInput) error {
	if input == nil {
		return t.store.DeleteProof(ctx, actor.OrganizationID, recordID, typeID)
	}
	kind, ok := liveProofKind(kinds, typeID)
	if !ok {
		return domain.ErrTraegerProofTypeMissing
	}
	proof, err := domain.PrepareProof(domain.TraegerProof{
		OrganizationID: actor.OrganizationID, RecordID: recordID, TypeID: typeID, PresentedOn: strings.TrimSpace(input.PresentedOn),
		IssuedOn: strings.TrimSpace(input.IssuedOn), NoRelevantEntry: input.NoRelevantEntry, ExpiresOn: strings.TrimSpace(input.ExpiresOn),
		RecordedByAccountID: actor.AccountID,
	}, kind, t.today())
	if err != nil {
		return err
	}
	return t.store.SaveProof(ctx, proof)
}

// logRecords writes the access entry of a view at every Einsatzort of the
// records, ended ones included, naming the employments it showed.
func (t *TraegerStaff) logRecords(ctx context.Context, actor workforce.TraegerStaffActor, view staffView, records []domain.TraegerStaffRecord) error {
	shown := map[int64][]int64{}
	var schools []int64
	for _, record := range records {
		for _, link := range record.Links {
			if _, ok := shown[link.SchoolID]; !ok {
				schools = append(schools, link.SchoolID)
			}
			shown[link.SchoolID] = append(shown[link.SchoolID], link.StaffID)
		}
	}
	for _, schoolID := range schools {
		err := t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
			return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: view.name, Rows: len(shown[schoolID]),
				StaffIDs: shown[schoolID], RecordID: view.recordID,
			})
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// ProofList lists the state of every kind at every record that has one:
// expired, missing, expiring and valid proofs. Each Einsatzort gets the
// access entry of view before anything leaves; a failed entry fails the
// list, and the export with it.
func (t *TraegerStaff) ProofList(ctx context.Context, actor workforce.TraegerStaffActor, view string) (workforce.TraegerStaffProofList, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerStaffProofList{}, err
	}
	var kinds []domain.TraegerProofType
	var records []domain.TraegerStaffRecord
	var proofs []domain.TraegerProof
	err = t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		if kinds, err = t.proofKinds(ctx, actor.OrganizationID); err != nil {
			return err
		}
		if records, err = t.store.ListStaffRecords(ctx, actor.OrganizationID); err != nil {
			return err
		}
		proofs, err = t.store.ListProofs(ctx, actor.OrganizationID, nil)
		return err
	})
	if err != nil {
		return workforce.TraegerStaffProofList{}, publicProofError(err)
	}
	if err := t.logRecords(ctx, actor, staffView{name: view}, records); err != nil {
		return workforce.TraegerStaffProofList{}, err
	}
	today := t.today()
	list := workforce.TraegerStaffProofList{Today: today.String(), Types: publicProofTypes(kinds), Entries: []workforce.TraegerStaffProofEntry{}}
	byRecord := map[int64][]domain.TraegerProof{}
	for _, proof := range proofs {
		byRecord[proof.RecordID] = append(byRecord[proof.RecordID], proof)
	}
	names := schoolNames(schools)
	for _, record := range records {
		for _, state := range proofStates(kinds, byRecord[record.ID], today) {
			if state.Status == "" {
				continue
			}
			list.Entries = append(list.Entries, workforce.TraegerStaffProofEntry{
				RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName, PersonnelNumber: record.PersonnelNumber,
				Schools: recordSchoolNames(record, names), TypeID: state.TypeID, TypeName: state.TypeName, Status: state.Status,
				PresentedOn: state.PresentedOn, ExpiresOn: state.ExpiresOn,
			})
			countProof(&list.Counts, state.Status)
		}
	}
	slices.SortStableFunc(list.Entries, compareProofEntries)
	return list, nil
}

func recordSchoolNames(record domain.TraegerStaffRecord, names map[int64]string) []string {
	result := make([]string, 0, len(record.Links))
	for _, link := range record.Links {
		if name := names[link.SchoolID]; name != "" && !slices.Contains(result, name) {
			result = append(result, name)
		}
	}
	slices.Sort(result)
	return result
}

func countProof(counts *workforce.TraegerStaffProofCounts, status string) {
	switch status {
	case workforce.TraegerProofStatusExpired:
		counts.Expired++
	case workforce.TraegerProofStatusMissing:
		counts.Missing++
	case workforce.TraegerProofStatusExpiringSoon:
		counts.ExpiringSoon++
	default:
		counts.Valid++
	}
}

var proofStatusRank = map[string]int{
	workforce.TraegerProofStatusExpired: 0, workforce.TraegerProofStatusMissing: 1,
	workforce.TraegerProofStatusExpiringSoon: 2, workforce.TraegerProofStatusValid: 3,
}

// compareProofEntries puts the most urgent first: by status, then the
// earliest expiry (none last), then by name.
func compareProofEntries(a, b workforce.TraegerStaffProofEntry) int {
	if a.Status != b.Status {
		return proofStatusRank[a.Status] - proofStatusRank[b.Status]
	}
	if a.ExpiresOn != b.ExpiresOn {
		switch {
		case a.ExpiresOn == "":
			return 1
		case b.ExpiresOn == "":
			return -1
		}
		return strings.Compare(a.ExpiresOn, b.ExpiresOn)
	}
	if order := strings.Compare(strings.ToLower(a.LastName), strings.ToLower(b.LastName)); order != 0 {
		return order
	}
	if order := strings.Compare(strings.ToLower(a.FirstName), strings.ToLower(b.FirstName)); order != 0 {
		return order
	}
	switch {
	case a.RecordID < b.RecordID:
		return -1
	case a.RecordID > b.RecordID:
		return 1
	}
	return 0
}

// SchoolProofKinds lists the live kinds of every school of the Träger with
// the Träger kind each maps onto. The kinds hold no personal data.
func (t *TraegerStaff) SchoolProofKinds(ctx context.Context, actor workforce.TraegerStaffActor) ([]workforce.TraegerSchoolProofKinds, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	var mappings []domain.TraegerProofTypeMapping
	err = t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		mappings, err = t.store.ListProofTypeMappings(ctx, actor.OrganizationID)
		return err
	})
	if err != nil {
		return nil, publicProofError(err)
	}
	mapped := make(map[[2]int64]int64, len(mappings))
	for _, mapping := range mappings {
		mapped[[2]int64{mapping.SchoolID, mapping.SchoolTypeID}] = mapping.ProofTypeID
	}
	result := make([]workforce.TraegerSchoolProofKinds, 0, len(schools))
	for _, school := range schools {
		kinds, err := t.schoolKinds(ctx, school.ID.Int64())
		if err != nil {
			return nil, err
		}
		entry := workforce.TraegerSchoolProofKinds{SchoolID: school.ID, SchoolName: school.Name, Kinds: make([]workforce.TraegerSchoolProofKind, 0, len(kinds))}
		for _, kind := range kinds {
			public := workforce.TraegerSchoolProofKind{SchoolTypeID: ident.ID(kind.ID), Name: kind.Name}
			if proofType, ok := mapped[[2]int64{school.ID.Int64(), kind.ID}]; ok {
				public.ProofTypeID = (*ident.ID)(new(proofType))
			}
			entry.Kinds = append(entry.Kinds, public)
		}
		result = append(result, entry)
	}
	return result, nil
}

func (t *TraegerStaff) schoolKinds(ctx context.Context, schoolID int64) ([]domain.QualificationType, error) {
	var kinds []domain.QualificationType
	err := t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		var err error
		kinds, err = t.store.SchoolProofKinds(ctx)
		return err
	})
	return kinds, err
}

// MapProofKind maps a live kind of one school of the Träger onto a live kind
// of the Träger, or removes the mapping, and returns the mappings.
func (t *TraegerStaff) MapProofKind(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerProofMappingInput) ([]workforce.TraegerSchoolProofKinds, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(schools, func(school workforce.TraegerStaffSchool) bool { return school.ID == ident.ID(input.SchoolID) }) {
		return nil, workforce.ErrTraegerProofMappingInvalid
	}
	kinds, err := t.schoolKinds(ctx, input.SchoolID)
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(kinds, func(kind domain.QualificationType) bool { return kind.ID == input.SchoolTypeID }) {
		return nil, workforce.ErrTraegerProofMappingInvalid
	}
	mapping := domain.TraegerProofTypeMapping{SchoolID: input.SchoolID, SchoolTypeID: input.SchoolTypeID}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		if input.ProofTypeID != nil {
			proofKinds, err := t.proofKinds(ctx, actor.OrganizationID)
			if err != nil {
				return err
			}
			if _, ok := liveProofKind(proofKinds, *input.ProofTypeID); !ok {
				return domain.ErrTraegerProofTypeMissing
			}
			mapping.ProofTypeID = *input.ProofTypeID
		}
		return t.store.SaveProofTypeMapping(ctx, actor.OrganizationID, actor.AccountID, mapping, t.clock.Now())
	})
	if err != nil {
		return nil, publicProofError(err)
	}
	return t.SchoolProofKinds(ctx, actor)
}

func liveProofKind(kinds []domain.TraegerProofType, id int64) (domain.TraegerProofType, bool) {
	for _, kind := range kinds {
		if kind.ID == id && !kind.Archived() {
			return kind, true
		}
	}
	return domain.TraegerProofType{}, false
}

func publicProofType(kind domain.TraegerProofType) workforce.TraegerStaffProofType {
	return workforce.TraegerStaffProofType{
		ID: ident.ID(kind.ID), StandardKey: kind.StandardKey, Name: kind.Name, ValidityMonths: kind.ValidityMonths,
		ReminderLeadWeeks: kind.ReminderLeadWeeks, Mandatory: kind.Mandatory, Archived: kind.Archived(),
		PoliceCertificate: kind.PoliceCertificate(), Version: proofTypeVersion(kind),
	}
}

func publicProofTypes(kinds []domain.TraegerProofType) []workforce.TraegerStaffProofType {
	result := make([]workforce.TraegerStaffProofType, 0, len(kinds))
	for _, kind := range kinds {
		result = append(result, publicProofType(kind))
	}
	return result
}

// publicProofError maps the stored refusals of the Nachweise onto the
// contract, then those of the Personalstamm.
func publicProofError(err error) error {
	if invalid, ok := errors.AsType[*domain.TraegerProofInvalidError](err); ok {
		return &workforce.TraegerProofError{Field: invalid.Field, Reason: invalid.Reason}
	}
	for _, pair := range []struct{ cause, kind error }{
		{domain.ErrTraegerProofTypeNameTaken, workforce.ErrTraegerProofTypeNameTaken},
		{domain.ErrTraegerProofTypeMissing, workforce.ErrTraegerProofTypeNotFound},
		{domain.ErrTraegerProofMissing, workforce.ErrTraegerProofNotFound},
	} {
		if errors.Is(err, pair.cause) {
			return errors.Join(pair.kind, err)
		}
	}
	return publicTraegerStaffError(err)
}
