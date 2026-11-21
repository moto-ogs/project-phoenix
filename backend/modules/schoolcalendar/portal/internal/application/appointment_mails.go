package application

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
)

type AppointmentMails = portal.AppointmentMails

// mailNotArrived are the outcomes of a mail that never reached the guardian
// and will not by itself: refused, given up on, held for a blocked address
// or delayed for days. The school has to reach the family another way.
var mailNotArrived = map[string]bool{
	"undeliverable":    true,
	"send_failed":      true,
	"blocked":          true,
	"provider_blocked": true,
	"overdue":          true,
}

// StaffAppointmentMails reports what became of the guardian e-mails of an
// appointment the caller organizes (#7058). Access is checked like
// GetStaffAppointmentDetail; the guardians are named from the recipient rows
// in one batch read, and only when a mail did not arrive.
func (s *service) StaffAppointmentMails(ctx context.Context, appointmentID int64) (*AppointmentMails, error) {
	appointment, err := s.loadOrganizedAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	result := &AppointmentMails{Kinds: map[string]map[string]int{}, NotArrived: map[string][]string{}}
	if s.cfg.Mails == nil {
		return result, nil
	}
	mails, err := s.cfg.Mails.AppointmentMails(ctx, appointment.ID.Int64())
	if err != nil {
		return nil, fmt.Errorf("calendar: read appointment mails: %w", err)
	}
	notArrived := countAppointmentMails(result.Kinds, newestMailPerAddress(mails))
	if len(notArrived) == 0 {
		return result, nil
	}
	names, err := s.recipientGuardianNamesByAddress(ctx, appointment.ID.Int64())
	if err != nil {
		return nil, err
	}
	for kind, addresses := range notArrived {
		if listed := namesAt(addresses, names); len(listed) > 0 {
			result.NotArrived[kind] = listed
		}
	}
	return result, nil
}

// countAppointmentMails counts the mails into kinds by kind and outcome and
// returns, per kind, the addresses whose mail did not arrive.
func countAppointmentMails(kinds map[string]map[string]int, mails []ports.AppointmentMail) map[string]map[string]bool {
	notArrived := map[string]map[string]bool{}
	for _, mail := range mails {
		if kinds[mail.Kind] == nil {
			kinds[mail.Kind] = map[string]int{}
		}
		kinds[mail.Kind][mail.Outcome]++
		if !mailNotArrived[mail.Outcome] {
			continue
		}
		if notArrived[mail.Kind] == nil {
			notArrived[mail.Kind] = map[string]bool{}
		}
		notArrived[mail.Kind][mail.Address] = true
	}
	return notArrived
}

// newestMailPerAddress keeps the newest mail of each kind to each address.
// The mails come oldest first, so a later one replaces an earlier one.
func newestMailPerAddress(mails []ports.AppointmentMail) []ports.AppointmentMail {
	type key struct{ kind, address string }
	index := make(map[key]int, len(mails))
	newest := make([]ports.AppointmentMail, 0, len(mails))
	for _, mail := range mails {
		k := key{mail.Kind, mail.Address}
		if at, seen := index[k]; seen {
			newest[at] = mail
			continue
		}
		index[k] = len(newest)
		newest = append(newest, mail)
	}
	return newest
}

// recipientGuardianNamesByAddress names the guardian recipients of the
// appointment by their current address in normalized form. A guardian
// without a name stays out: the list never shows an address instead.
func (s *service) recipientGuardianNamesByAddress(ctx context.Context, appointmentID int64) (map[string][]string, error) {
	recipients, err := s.cfg.Appointments.FindAppointmentRecipients(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	_, guardianIDs := recipientPersonIDs(recipients)
	if len(guardianIDs) == 0 {
		return map[string][]string{}, nil
	}
	profiles, err := s.cfg.GuardianProfileRepo.FindByIDs(ctx, guardianIDs)
	if err != nil {
		return nil, err
	}
	names := make(map[string][]string, len(profiles))
	for _, profile := range profiles {
		if profile == nil || profile.Email == nil {
			continue
		}
		name := strings.TrimSpace(profile.FirstName + " " + profile.LastName)
		address := strings.ToLower(strings.TrimSpace(*profile.Email))
		if name == "" || address == "" {
			continue
		}
		names[address] = append(names[address], name)
	}
	return names, nil
}

// namesAt lists the names behind the addresses once each, in German order.
func namesAt(addresses map[string]bool, names map[string][]string) []string {
	seen := map[string]bool{}
	listed := []string{}
	for address := range addresses {
		for _, name := range names[address] {
			if !seen[name] {
				seen[name] = true
				listed = append(listed, name)
			}
		}
	}
	sort.SliceStable(listed, func(i, j int) bool { return collation.CompareGerman(listed[i], listed[j]) < 0 })
	return listed
}
