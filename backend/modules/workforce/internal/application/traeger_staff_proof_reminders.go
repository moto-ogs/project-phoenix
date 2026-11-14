package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
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

// NewTraegerProofReminders builds the reminders over the Personalstamm's
// store and the school reminders' ports; traeger lists the active Träger.
func NewTraegerProofReminders(store ports.TraegerStaffStore, clock ports.Clock, runtime workforce.TraegerStaffRuntime,
	traeger func(ctx context.Context) ([]int64, error), schoolStore ports.Store, bound workforce.QualificationReminderPorts,
) (*TraegerProofReminders, error) {
	if store == nil || clock == nil || runtime == nil || traeger == nil {
		return nil, errors.New("traeger proof reminders: store, clock, runtime and the Träger list are required")
	}
	reminders, err := NewQualificationReminders(schoolStore, clock, bound)
	if err != nil {
		return nil, err
	}
	staff := &TraegerStaff{store: store, ports: workforce.TraegerStaffPorts{Runtime: runtime}, clock: clock}
	return &TraegerProofReminders{staff: staff, reminders: reminders, traeger: traeger}, nil
}

// dueProof is one proof whose reminder stage is due, with the record's
// Einsatzorte.
type dueProof struct {
	proof  domain.TraegerProof
	kind   domain.TraegerProofType
	stage  string
	links  []domain.TraegerStaffLink
	failed bool
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
	bySchool := map[int64][]*dueProof{}
	var schools []int64
	for _, item := range due {
		for _, link := range item.links {
			if _, ok := bySchool[link.SchoolID]; !ok {
				schools = append(schools, link.SchoolID)
			}
			bySchool[link.SchoolID] = append(bySchool[link.SchoolID], item)
		}
	}
	// The person gets their own notice at one Einsatzort only: the first
	// that runs for them.
	ownSent := map[int64]bool{}
	for _, schoolID := range schools {
		if err := r.sendAtSchool(ctx, schoolID, bySchool[schoolID], ownSent); err != nil {
			return err
		}
	}
	return r.staff.released(ctx, actor, func(ctx context.Context) error {
		for _, item := range due {
			if item.failed {
				continue
			}
			if _, err := r.staff.store.ClaimProofReminder(ctx, organizationID, item.proof.ID, item.stage, item.proof.ExpiresOn); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *TraegerProofReminders) dueProofs(ctx context.Context, actor workforce.TraegerStaffActor) ([]*dueProof, error) {
	var due []*dueProof
	today := r.staff.today()
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
		if err != nil {
			return err
		}
		links := make(map[int64][]domain.TraegerStaffLink, len(records))
		for _, record := range records {
			links[record.ID] = record.Links
		}
		for _, proof := range proofs {
			kind, ok := liveProofKind(kinds, proof.TypeID)
			if !ok {
				continue
			}
			if stage, ok := domain.DueTraegerProofReminder(proof, kind.ReminderLeadWeeks, today); ok {
				due = append(due, &dueProof{proof: proof, kind: kind, stage: stage, links: links[proof.RecordID]})
			}
		}
		return nil
	})
	return due, err
}

// sendAtSchool sends the due proofs of the school's employments to its
// Leitung, in its tenant transaction. An employment the school ended gets
// nothing there. A notice the window holds back keeps its proof unclaimed.
func (r *TraegerProofReminders) sendAtSchool(ctx context.Context, schoolID int64, due []*dueProof, ownSent map[int64]bool) error {
	return r.staff.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		members, err := r.reminders.ports.Staff.ListStaffMembers(ctx)
		if err != nil {
			return fmt.Errorf("list staff for proof reminders: %w", err)
		}
		live := make(map[int64]bool, len(members))
		for _, member := range members {
			live[member.StaffID] = true
		}
		managers, err := r.reminders.ports.Staff.StammdatenManagers(ctx)
		if err != nil {
			return fmt.Errorf("list proof reminder recipients: %w", err)
		}
		school, err := r.reminders.ports.Schools.School(ctx, tenant.FromContext(ctx))
		if err != nil {
			return fmt.Errorf("read school for proof reminders: %w", err)
		}
		for _, item := range due {
			staffID := linkAt(item.links, schoolID)
			if !live[staffID] {
				continue
			}
			reminder := dueReminder{
				qualification: domain.StaffQualification{ID: item.proof.ID, StaffID: staffID, ExpiresOn: item.proof.ExpiresOn},
				name:          item.kind.Name, stage: item.stage, lapsed: item.proof.ExpiresOn < r.staff.today().String(),
			}
			key := fmt.Sprintf("traeger-staff-proof-%d-%s-%s-school-%d", item.proof.ID, item.proof.ExpiresOn, item.stage, schoolID)
			own := !ownSent[item.proof.ID]
			sent, err := r.reminders.send(ctx, schoolID, school, managers, reminder, key, own)
			if err != nil {
				return err
			}
			if !sent {
				item.failed = true
				continue
			}
			ownSent[item.proof.ID] = true
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
