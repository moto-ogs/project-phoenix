package application

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// Reminder mail of #4808.
const (
	QualificationReminderMailType = "staff_qualification_reminder"
	qualificationReminderTemplate = "staff-qualification-reminder.html"
)

// QualificationReminders sends the reminders of #4808 for the school in the
// context: to every holder of staff:stammdaten and to the affected person,
// in the app and by e-mail, once at the start of the lead and once on the
// expiry day.
type QualificationReminders struct {
	records qualificationRecords
	ports   workforce.QualificationReminderPorts
	logger  *slog.Logger
	// keptByTraeger reads the Träger's proofs of the school's employments a
	// record keeps (#4707); nil reads none.
	keptByTraeger schoolTraegerProofs
}

// schoolTraegerProofs is what a school reads of its Träger's proofs (ADR
// 0089 section 7), in its tenant transaction.
type schoolTraegerProofs interface {
	SchoolTraegerProofStatus(ctx context.Context) ([]domain.SchoolTraegerProofStatus, error)
}

// WithTraegerProofs lets the reminders leave out a qualification whose kind
// the school mapped onto a kind of its Träger, for an employment the Träger
// keeps in a record: the Träger's proof reminds instead (decision E4 of
// 13.11.2026). A school without such a Träger reads no row and keeps every
// reminder.
func (r *QualificationReminders) WithTraegerProofs(proofs schoolTraegerProofs) *QualificationReminders {
	r.keptByTraeger = proofs
	return r
}

// NewQualificationReminders builds the reminders; every port but Logger is
// required.
func NewQualificationReminders(store ports.Store, clock ports.Clock, bound workforce.QualificationReminderPorts) (*QualificationReminders, error) {
	if bound.Staff == nil || bound.Notify == nil || bound.Mail == nil || bound.Schools == nil {
		return nil, fmt.Errorf("qualification reminders: staff, notify, mail and schools are required")
	}
	logger := bound.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &QualificationReminders{records: newQualificationRecords(store, clock), ports: bound, logger: logger.With("service", "qualification_reminders")}, nil
}

// dueReminder is one reminder the snapshot found due.
type dueReminder struct {
	qualification domain.StaffQualification
	name          string
	stage         string
	// lapsed: the expiry reminder is caught up after the expiry day, so the
	// text says "abgelaufen" instead of "läuft heute ab".
	lapsed bool
}

// RunDue sends what is due today. Each reminder is claimed on its row after
// its notices went out, so a run that fails before the claim repeats it; the
// idempotency keys keep Delivery from sending a notice or mail twice. A
// reminder the notification window holds back stays unclaimed until a later
// run.
func (r *QualificationReminders) RunDue(ctx context.Context) error {
	today := r.records.today()
	due, err := r.dueReminders(ctx, today)
	if err != nil || len(due) == 0 {
		return err
	}
	members, err := r.ports.Staff.ListStaffMembers(ctx)
	if err != nil {
		return fmt.Errorf("list staff for qualification reminders: %w", err)
	}
	live := make(map[int64]bool, len(members))
	for _, member := range members {
		live[member.StaffID] = true
	}
	managers, err := r.ports.Staff.StammdatenManagers(ctx)
	if err != nil {
		return fmt.Errorf("list qualification reminder recipients: %w", err)
	}
	tenantID := tenant.FromContext(ctx)
	school, err := r.ports.Schools.School(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("read school for qualification reminders: %w", err)
	}
	for _, reminder := range due {
		if !live[reminder.qualification.StaffID] {
			continue
		}
		if err := r.remind(ctx, tenantID, school, managers, reminder); err != nil {
			return err
		}
	}
	return nil
}

func (r *QualificationReminders) dueReminders(ctx context.Context, today calendar.Date) ([]dueReminder, error) {
	types, qualifications, err := r.records.load(ctx, 0)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]domain.QualificationType, len(types))
	for _, kind := range types {
		byID[kind.ID] = kind
	}
	takenOver, err := r.takenOverByTraeger(ctx)
	if err != nil {
		return nil, err
	}
	var due []dueReminder
	for _, q := range qualifications {
		if q.TypeID != nil && takenOver[[2]int64{q.StaffID, *q.TypeID}] {
			continue
		}
		lead, name := domain.DefaultReminderLeadWeeks, q.Name
		if q.TypeID != nil {
			if kind, ok := byID[*q.TypeID]; ok {
				lead, name = kind.ReminderLeadWeeks, kind.Name
			}
		}
		if stage, ok := domain.DueQualificationReminder(q, lead, today); ok {
			due = append(due, dueReminder{qualification: q, name: name, stage: stage, lapsed: q.ExpiresOn < today.String()})
		}
	}
	return due, nil
}

// takenOverByTraeger names the employment and school kind pairs whose
// reminder the Träger's proof sends.
func (r *QualificationReminders) takenOverByTraeger(ctx context.Context) (map[[2]int64]bool, error) {
	if r.keptByTraeger == nil {
		return nil, nil
	}
	statuses, err := r.keptByTraeger.SchoolTraegerProofStatus(ctx)
	if err != nil {
		return nil, fmt.Errorf("read the Träger's proofs for qualification reminders: %w", err)
	}
	pairs := map[[2]int64]bool{}
	for _, status := range statuses {
		for _, kind := range status.SchoolTypeIDs {
			pairs[[2]int64{status.StaffID, kind}] = true
		}
	}
	return pairs, nil
}

func (r *QualificationReminders) remind(ctx context.Context, tenantID int64, school workforce.PayrollSchool, managers []workforce.QualificationStaffMember, reminder dueReminder) error {
	q := reminder.qualification
	key := fmt.Sprintf("staff-qualification-%d-%s-%s", q.ID, q.ExpiresOn, reminder.stage)
	if sent, err := r.send(ctx, tenantID, school, managers, reminder, key, true); err != nil || !sent {
		return err
	}
	_, err := r.claim(ctx, q.ID, reminder.stage, q.ExpiresOn)
	return err
}

// send delivers one reminder in the school of the tenant transaction: the
// notice and mail to the Leitung and, with toPerson, to the person. It
// reports false when the notification window held a notice back; the
// idempotency keys under key keep a repeat from sending twice.
func (r *QualificationReminders) send(ctx context.Context, tenantID int64, school workforce.PayrollSchool, managers []workforce.QualificationStaffMember, reminder dueReminder, key string, toPerson bool) (bool, error) {
	q := reminder.qualification
	person, err := r.ports.Staff.StaffContact(ctx, q.StaffID)
	if err != nil {
		return false, fmt.Errorf("read staff contact for qualification reminder: %w", err)
	}
	managerAccounts := make([]int64, 0, len(managers))
	isManager := false
	for _, manager := range managers {
		if manager.AccountID > 0 {
			managerAccounts = append(managerAccounts, manager.AccountID)
		}
		isManager = isManager || (person.AccountID > 0 && manager.AccountID == person.AccountID)
	}
	notice := qualificationNotice(reminder, false)
	notice.TenantID, notice.StaffID, notice.QualificationID = tenantID, q.StaffID, q.ID
	notice.IdempotencyKey, notice.RecipientAccountIDs = key, managerAccounts
	notice.DeepLink = fmt.Sprintf("/staff/%d", q.StaffID)
	if sent, err := r.notify(ctx, notice); err != nil || !sent {
		return false, err
	}
	// A person who manages the Stammdaten already got the Leitung's notice.
	toPerson = toPerson && !isManager
	if person.AccountID > 0 && toPerson {
		own := qualificationNotice(reminder, true)
		own.TenantID, own.StaffID, own.QualificationID = tenantID, q.StaffID, q.ID
		own.IdempotencyKey, own.RecipientAccountIDs, own.DeepLink = key+"-own", []int64{person.AccountID}, "/profile"
		if sent, err := r.notify(ctx, own); err != nil || !sent {
			return false, err
		}
	}
	if err := r.mail(ctx, tenantID, school, managers, person, !toPerson, reminder, key); err != nil {
		return false, err
	}
	return true, nil
}

func (r *QualificationReminders) notify(ctx context.Context, notice workforce.QualificationNotice) (bool, error) {
	if len(notice.RecipientAccountIDs) == 0 {
		return true, nil
	}
	sent, err := r.ports.Notify(ctx, notice)
	if err != nil {
		return false, fmt.Errorf("notify qualification reminder: %w", err)
	}
	if !sent {
		r.logger.Debug("qualification reminder held back",
			"qualification_id", notice.QualificationID,
			"stage", notice.Stage,
		)
	}
	return sent, nil
}

func (r *QualificationReminders) mail(ctx context.Context, tenantID int64, school workforce.PayrollSchool, managers []workforce.QualificationStaffMember, person workforce.QualificationStaffMember, isManager bool, reminder dueReminder, key string) error {
	q := reminder.qualification
	content := workforce.QualificationMailContent{
		SchoolName: school.Name, StaffName: strings.TrimSpace(person.FirstName + " " + person.LastName),
		QualificationName: reminder.name, ExpiresOn: formatGermanDate(q.ExpiresOn),
		ExpiryDay: reminder.stage == domain.QualificationReminderExpiry && !reminder.lapsed,
		Lapsed:    reminder.lapsed,
	}
	subject := "Nachweis läuft bald ab"
	switch {
	case content.Lapsed:
		subject = "Nachweis ist abgelaufen"
	case content.ExpiryDay:
		subject = "Nachweis läuft heute ab"
	}
	send := func(to workforce.QualificationStaffMember, own bool, path string) error {
		if strings.TrimSpace(to.Email) == "" {
			return nil
		}
		link, err := payrollTenantURL(r.ports.FrontendURL, school.Subdomain, path)
		if err != nil {
			link = ""
		}
		message := content
		message.FirstName, message.Own, message.LinkURL = to.FirstName, own, link
		return r.ports.Mail.Enqueue(ctx, workforce.QualificationMailMessage{
			TenantID: tenantID, ToName: strings.TrimSpace(to.FirstName + " " + to.LastName), ToAddress: to.Email,
			Subject: subject, Template: qualificationReminderTemplate, Content: message,
			Type: QualificationReminderMailType, ReferenceID: q.ID,
			IdempotencyKey: fmt.Sprintf("%s-mail-%d", key, to.StaffID),
		})
	}
	for _, manager := range managers {
		own, path := manager.StaffID == q.StaffID, fmt.Sprintf("/staff/%d", q.StaffID)
		if own {
			path = "/profile"
		}
		if err := send(manager, own, path); err != nil {
			return fmt.Errorf("enqueue qualification reminder mail: %w", err)
		}
	}
	if !isManager {
		if err := send(person, true, "/profile"); err != nil {
			return fmt.Errorf("enqueue qualification reminder mail: %w", err)
		}
	}
	return nil
}

// qualificationNotice is the push text. The Leitung's text names the kind,
// never the person: a push lands on a lock screen.
func qualificationNotice(reminder dueReminder, own bool) workforce.QualificationNotice {
	day := formatGermanDate(reminder.qualification.ExpiresOn)
	notice := workforce.QualificationNotice{Stage: reminder.stage, Own: own}
	switch {
	case reminder.lapsed && own:
		notice.Title = "Ihr Nachweis ist abgelaufen"
		notice.Body = "Ihr Nachweis „" + reminder.name + "“ galt bis " + day + ". Bitte reichen Sie einen neuen Nachweis ein."
	case reminder.lapsed:
		notice.Title = "Nachweis ist abgelaufen"
		notice.Body = "Am " + day + " ist ein Nachweis „" + reminder.name + "“ einer Person aus dem Team abgelaufen."
	case reminder.stage == domain.QualificationReminderExpiry && own:
		notice.Title = "Ihr Nachweis läuft heute ab"
		notice.Body = "Ihr Nachweis „" + reminder.name + "“ gilt nur noch heute. Bitte reichen Sie einen neuen Nachweis ein."
	case reminder.stage == domain.QualificationReminderExpiry:
		notice.Title = "Nachweis läuft heute ab"
		notice.Body = "Heute läuft ein Nachweis „" + reminder.name + "“ einer Person aus dem Team ab."
	case own:
		notice.Title = "Ihr Nachweis läuft bald ab"
		notice.Body = "Ihr Nachweis „" + reminder.name + "“ gilt bis " + day + ". Bitte kümmern Sie sich rechtzeitig um einen neuen."
	default:
		notice.Title = "Nachweis läuft bald ab"
		notice.Body = "Am " + day + " läuft ein Nachweis „" + reminder.name + "“ einer Person aus dem Team ab."
	}
	return notice
}

// claim records the reminder stage on the row once per expiry date.
func (r *QualificationReminders) claim(ctx context.Context, id int64, stage, expiresOn string) (bool, error) {
	claimed, _, err := r.records.store.ClaimQualificationReminder(ctx, id, stage, expiresOn)
	return claimed, mapStaffRecordError(err)
}
