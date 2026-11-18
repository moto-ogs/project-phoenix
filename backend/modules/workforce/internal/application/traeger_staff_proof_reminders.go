package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// TraegerProofReminders sends the warnings before a proof of the
// Personalstamm expires (#4707, ADR 0089 section 7): once when the kind's
// lead starts and once on the expiry day, to the Leitung of every live
// Einsatzort and to the person, in the app and by e-mail, with the texts
// and the notification window of the school's reminders (#4808). The
// Personalverwaltung sees the same proofs on the list of the Träger-Portal.
//
// For each released Träger it reads the due proofs in the Träger
// transaction, sends in each school's tenant transaction and claims a
// proof in the Träger transaction only after every school took it. A run
// that fails before the claim repeats; Delivery's idempotency keys keep a
// notice or mail from going out twice.
type TraegerProofReminders struct {
	staff     *TraegerStaff
	reminders *QualificationReminders
	traeger   func(ctx context.Context) ([]int64, error)
}

func newTraegerProofReminders(store ports.TraegerStaffStore, clock ports.Clock, reminders *QualificationReminders, bound workforce.QualificationReminderPorts) (*TraegerProofReminders, error) {
	if store == nil || bound.TraegerRuntime == nil || bound.Traeger == nil {
		return nil, errors.New("traeger proof reminders: store, runtime and the Träger list are required")
	}
	staff := &TraegerStaff{store: store, ports: workforce.TraegerStaffPorts{Runtime: bound.TraegerRuntime}, clock: clock}
	return &TraegerProofReminders{staff: staff, reminders: reminders, traeger: bound.Traeger}, nil
}

// dueProof is one proof whose reminder stage is due, with the record's
// Einsatzorte; held is set when a notice was held back somewhere.
type dueProof struct {
	proof domain.TraegerProof
	kind  domain.TraegerProofType
	stage string
	links []domain.TraegerStaffLink
	held  bool
}

// RunDue sends what is due today at every released Träger. A Träger that
// fails does not stop the others; the first error is returned.
func (r *TraegerProofReminders) RunDue(ctx context.Context) error {
	ids, err := r.traeger(ctx)
	if err != nil {
		return fmt.Errorf("list Träger for proof reminders: %w", err)
	}
	var first error
	for _, organizationID := range ids {
		if err := r.runTraeger(ctx, organizationID); err != nil && first == nil {
			first = fmt.Errorf("proof reminders of Träger %d: %w", organizationID, err)
		}
	}
	return first
}

func (r *TraegerProofReminders) runTraeger(ctx context.Context, organizationID int64) error {
	actor := workforce.TraegerStaffActor{OrganizationID: organizationID}
	due, err := r.dueProofs(ctx, actor)
	if errors.Is(err, workforce.ErrTraegerStaffNotReleased) || (err == nil && len(due) == 0) {
		return nil
	}
	if err != nil {
		return err
	}
	// The person gets their own notice at one Einsatzort only: the first
	// that runs for them.
	ownSent := map[int64]bool{}
	for _, school := range proofsBySchool(due) {
		if err := r.sendAtSchool(ctx, school.id, school.proofs, ownSent); err != nil {
			return err
		}
	}
	return r.staff.released(ctx, actor, func(ctx context.Context) error {
		return r.claim(ctx, organizationID, due)
	})
}

func (r *TraegerProofReminders) claim(ctx context.Context, organizationID int64, due []*dueProof) error {
	for _, item := range due {
		if item.held {
			continue
		}
		if _, err := r.staff.store.ClaimProofReminder(ctx, organizationID, item.proof.ID, item.stage, item.proof.ExpiresOn); err != nil {
			return err
		}
	}
	return nil
}

type schoolProofs struct {
	id     int64
	proofs []*dueProof
}

// proofsBySchool groups the due proofs by Einsatzort, in the order the
// schools first appear.
func proofsBySchool(due []*dueProof) []schoolProofs {
	index := map[int64]int{}
	var schools []schoolProofs
	for _, item := range due {
		for _, link := range item.links {
			i, ok := index[link.SchoolID]
			if !ok {
				i = len(schools)
				index[link.SchoolID] = i
				schools = append(schools, schoolProofs{id: link.SchoolID})
			}
			schools[i].proofs = append(schools[i].proofs, item)
		}
	}
	return schools
}

func (r *TraegerProofReminders) dueProofs(ctx context.Context, actor workforce.TraegerStaffActor) ([]*dueProof, error) {
	var due []*dueProof
	err := r.staff.released(ctx, actor, func(ctx context.Context) error {
		kinds, err := r.staff.proofKinds(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		records, err := r.staff.store.ListStaffRecords(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		proofs, err := r.staff.store.ListProofs(ctx, actor.OrganizationID, nil)
		due = dueOf(kinds, records, proofs, r.staff.today())
		return err
	})
	return due, err
}

func dueOf(kinds []domain.TraegerProofType, records []domain.TraegerStaffRecord, proofs []domain.TraegerProof, today calendar.Date) []*dueProof {
	links := make(map[int64][]domain.TraegerStaffLink, len(records))
	for _, record := range records {
		links[record.ID] = record.Links
	}
	var due []*dueProof
	for _, proof := range proofs {
		kind, ok := liveProofKind(kinds, proof.TypeID)
		if !ok {
			continue
		}
		if stage, ok := domain.DueTraegerProofReminder(proof, kind.ReminderLeadWeeks, today); ok {
			due = append(due, &dueProof{proof: proof, kind: kind, stage: stage, links: links[proof.RecordID]})
		}
	}
	return due
}

// schoolRecipients are the live staff and the Leitung of one school.
type schoolRecipients struct {
	school   workforce.PayrollSchool
	live     map[int64]bool
	managers []workforce.QualificationStaffMember
}

func (r *TraegerProofReminders) recipients(ctx context.Context) (schoolRecipients, error) {
	members, err := r.reminders.ports.Staff.ListStaffMembers(ctx)
	if err != nil {
		return schoolRecipients{}, fmt.Errorf("list staff for proof reminders: %w", err)
	}
	result := schoolRecipients{live: make(map[int64]bool, len(members))}
	for _, member := range members {
		result.live[member.StaffID] = true
	}
	if result.managers, err = r.reminders.ports.Staff.StammdatenManagers(ctx); err != nil {
		return schoolRecipients{}, fmt.Errorf("list proof reminder recipients: %w", err)
	}
	if result.school, err = r.reminders.ports.Schools.School(ctx, tenant.FromContext(ctx)); err != nil {
		return schoolRecipients{}, fmt.Errorf("read school for proof reminders: %w", err)
	}
	return result, nil
}

// sendAtSchool sends the due proofs of the school's employments to its
// Leitung, in its tenant transaction. An employment the school ended gets
// nothing there. A notice the window holds back keeps its proof unclaimed.
func (r *TraegerProofReminders) sendAtSchool(ctx context.Context, schoolID int64, due []*dueProof, ownSent map[int64]bool) error {
	return r.staff.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		to, err := r.recipients(ctx)
		if err != nil {
			return err
		}
		// A retired Einsatzort gets nothing (#7478); its proofs are claimed
		// with the other schools', as the school does not come back.
		if to.school.Retired {
			return nil
		}
		today := r.staff.today().String()
		for _, item := range due {
			staffID := linkAt(item.links, schoolID)
			if !to.live[staffID] {
				continue
			}
			reminder := dueReminder{
				qualification: domain.StaffQualification{ID: item.proof.ID, StaffID: staffID, ExpiresOn: item.proof.ExpiresOn},
				name:          item.kind.Name, stage: item.stage, lapsed: item.proof.ExpiresOn < today,
			}
			key := fmt.Sprintf("traeger-staff-proof-%d-%s-%s-school-%d", item.proof.ID, item.proof.ExpiresOn, item.stage, schoolID)
			sent, err := r.reminders.send(ctx, schoolID, to.school, to.managers, reminder, key, !ownSent[item.proof.ID])
			if err != nil {
				return err
			}
			item.held = item.held || !sent
			ownSent[item.proof.ID] = ownSent[item.proof.ID] || sent
		}
		return nil
	})
}

func linkAt(links []domain.TraegerStaffLink, schoolID int64) int64 {
	for _, link := range links {
		if link.SchoolID == schoolID {
			return link.StaffID
		}
	}
	return 0
}
