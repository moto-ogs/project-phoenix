package application

import (
	"context"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// QualificationList reads the Nachweise (#4808): every qualification of
// the live staff with its status and every mandatory kind a person lacks.
type QualificationList struct {
	records qualificationRecords
	staff   workforce.QualificationStaff
	// keptByTraeger reads the Träger's proofs (#4707); nil reads none.
	keptByTraeger schoolTraegerProofs
}

// traegerCoverage reads the Träger's proofs only when a missing mandatory
// kind asks for them, so a school without a missing kind (and every school
// without a released Träger in that case) pays no extra read. The first
// read error stays in err and every later question answers false.
type traegerCoverage struct {
	ctx    context.Context
	reader schoolTraegerProofs
	pairs  map[[2]int64]bool
	loaded bool
	err    error
}

func (o *QualificationList) coveredByTraeger(ctx context.Context) *traegerCoverage {
	return &traegerCoverage{ctx: ctx, reader: o.keptByTraeger}
}

func (c *traegerCoverage) has(staffID, typeID int64) bool {
	if !c.loaded {
		c.loaded = true
		c.pairs, c.err = takenOverByTraeger(c.ctx, c.reader)
	}
	return c.pairs[[2]int64{staffID, typeID}]
}

// StaffTraegerProofs lists what the school sees of the Träger's proofs of
// one of its employments: per kind the status and the expiry date, nothing
// of the proof itself (ADR 0089 section 7). An employment the Träger does
// not keep has none.
func (o *QualificationList) StaffTraegerProofs(ctx context.Context, staffID int64) ([]workforce.SchoolTraegerProof, error) {
	result := []workforce.SchoolTraegerProof{}
	if o.keptByTraeger == nil || staffID <= 0 {
		return result, nil
	}
	statuses, err := o.keptByTraeger.SchoolTraegerProofStatus(ctx)
	if err != nil {
		return nil, err
	}
	today := o.records.today()
	for _, status := range statuses {
		if status.StaffID != staffID {
			continue
		}
		kind := domain.TraegerProofType{Mandatory: status.Mandatory, ReminderLeadWeeks: status.ReminderLeadWeeks}
		var proof *domain.TraegerProof
		if status.Held {
			proof = &domain.TraegerProof{ExpiresOn: status.ExpiresOn}
		}
		result = append(result, workforce.SchoolTraegerProof{
			TypeName: status.TypeName, Status: domain.TraegerProofStatus(kind, proof, today), ExpiresOn: status.ExpiresOn,
		})
	}
	return result, nil
}

// NewQualificationList builds the Nachweise read over the records and
// the staff directory.
// keptByTraeger reads the Träger's proofs of the school's employments
// (#4707); nil reads none.
func NewQualificationList(store ports.Store, clock ports.Clock, staff workforce.QualificationStaff, keptByTraeger schoolTraegerProofs) *QualificationList {
	if staff == nil {
		panic("qualification overview: staff is required")
	}
	return &QualificationList{records: newQualificationRecords(store, clock), staff: staff, keptByTraeger: keptByTraeger}
}

// QualificationOverview lists the live staff by name, each with their
// qualifications in their order and the missing mandatory kinds after them.
func (o *QualificationList) QualificationOverview(ctx context.Context) ([]workforce.QualificationOverviewRow, error) {
	members, err := o.staff.ListStaffMembers(ctx)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(members, func(a, b workforce.QualificationStaffMember) int {
		if order := strings.Compare(a.LastName, b.LastName); order != 0 {
			return order
		}
		if order := strings.Compare(a.FirstName, b.FirstName); order != 0 {
			return order
		}
		switch {
		case a.StaffID < b.StaffID:
			return -1
		case a.StaffID > b.StaffID:
			return 1
		default:
			return 0
		}
	})
	types, qualifications, err := o.records.load(ctx, 0)
	if err != nil {
		return nil, mapStaffRecordError(err)
	}
	covered := o.coveredByTraeger(ctx)
	byStaff := make(map[int64][]domain.StaffQualification, len(members))
	for _, q := range qualifications {
		byStaff[q.StaffID] = append(byStaff[q.StaffID], q)
	}
	today := o.records.today()
	rows := make([]workforce.QualificationOverviewRow, 0, len(qualifications))
	for _, member := range members {
		for _, entry := range qualificationEntries(member.StaffID, byStaff[member.StaffID], types, today, covered.has) {
			rows = append(rows, workforce.QualificationOverviewRow{QualificationEntry: entry, FirstName: member.FirstName, LastName: member.LastName})
		}
	}
	if covered.err != nil {
		return nil, covered.err
	}
	return rows, nil
}

// StaffQualificationStatus lists one person's qualifications with status and
// their missing mandatory kinds; the person's own view and the profile use it.
func (o *QualificationList) StaffQualificationStatus(ctx context.Context, staffID int64) ([]workforce.QualificationEntry, error) {
	if staffID <= 0 {
		return nil, invalidStaffRecord("staff ID is required")
	}
	members, err := o.staff.ListStaffMembers(ctx)
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(members, func(member workforce.QualificationStaffMember) bool {
		return member.StaffID == staffID
	}) {
		return nil, &domain.RecordNotFoundError{Op: "find live staff"}
	}
	types, qualifications, err := o.records.load(ctx, staffID)
	if err != nil {
		return nil, mapStaffRecordError(err)
	}
	covered := o.coveredByTraeger(ctx)
	entries := qualificationEntries(staffID, qualifications, types, o.records.today(), covered.has)
	if covered.err != nil {
		return nil, covered.err
	}
	return entries, nil
}

// qualificationEntries gives each qualification its status and adds one
// missing entry per live mandatory kind the person has no qualification of,
// unless the Träger's proof covers that kind for the person (takenOver,
// #4707): the school then sees the Träger's status instead.
func qualificationEntries(staffID int64, qualifications []domain.StaffQualification, types []domain.QualificationType, today calendar.Date, covered func(staffID, typeID int64) bool) []workforce.QualificationEntry {
	byID := make(map[int64]domain.QualificationType, len(types))
	for _, kind := range types {
		byID[kind.ID] = kind
	}
	held := map[int64]bool{}
	entries := make([]workforce.QualificationEntry, 0, len(qualifications))
	for _, q := range qualifications {
		lead := domain.DefaultReminderLeadWeeks
		name := q.Name
		mandatory := false
		if q.TypeID != nil {
			held[*q.TypeID] = true
			if kind, ok := byID[*q.TypeID]; ok {
				lead, name = kind.ReminderLeadWeeks, kind.Name
				mandatory = kind.Mandatory && !kind.Archived()
			}
		}
		entries = append(entries, workforce.QualificationEntry{
			StaffID: staffID, QualificationID: new(q.ID), TypeID: q.TypeID, Name: name,
			AcquiredOn: q.AcquiredOn, ExpiresOn: q.ExpiresOn, Mandatory: mandatory,
			Status: domain.QualificationStatus(q.ExpiresOn, lead, today),
		})
	}
	for _, kind := range types {
		if kind.Mandatory && !kind.Archived() && !held[kind.ID] && !covered(staffID, kind.ID) {
			entries = append(entries, workforce.QualificationEntry{
				StaffID: staffID, TypeID: new(kind.ID), Name: kind.Name, Mandatory: true,
				Status: domain.QualificationStatusMissing,
			})
		}
	}
	return entries
}
