package ports

import "context"

// StaffQualificationReminders sends the due reminders of the staff
// qualifications (Nachweise) of the school in ctx (#4808): once at the start
// of the lead and once on the expiry day. The root binds Workforce.
type StaffQualificationReminders func(ctx context.Context) error

// TraegerStaffProofReminders sends the due warnings before a proof of a
// Träger's Personalstamm expires (#4707), once per run over every released
// Träger. The root binds Workforce.
type TraegerStaffProofReminders func(ctx context.Context) error
