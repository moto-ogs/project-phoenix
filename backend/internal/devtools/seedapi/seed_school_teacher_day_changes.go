package api

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedSchoolTeacherDayChangesStep gives "Heute anders" in moto schule the
// entries of #8155 for the seeded Lehrkraft: two children of her class are
// on a day outing and come back at 13:00 (reported through the class-trip
// route of moto schule, as she would), and a Klassenkonferenz the Leitung
// invited the Lehrkräfte to is cancelled today. It runs after seedSchoolTeacherStep;
// without the local Lehrkraft it does nothing.
type seedSchoolTeacherDayChangesStep struct{ seeder *Seeder }

func (seedSchoolTeacherDayChangesStep) Name() string {
	return "Seeding the school teacher's class outing and cancelled appointment"
}

func (s seedSchoolTeacherDayChangesStep) Run(_ context.Context, rt *Runtime) error {
	teacher := s.seeder.schoolTeacherAccount
	if teacher == nil {
		return nil
	}
	if rt.FixedSeeder == nil || rt.Bootstrap == nil || len(DemoStudents) == 0 {
		return fmt.Errorf("school teacher day changes require bootstrap and students")
	}
	today := todaySeedDate()
	if err := seedTeacherAppointment(rt, today); err != nil {
		return err
	}
	// A return time is refused on a weekend: the outing is a school day's.
	if weekday := today.Weekday(); weekday == time.Saturday || weekday == time.Sunday {
		fmt.Println("  School teacher's cancelled appointment created; the class outing skipped on a weekend")
		return nil
	}
	class := DemoStudents[0].Class
	children := demoStudentsOfClass(rt, class, 2)
	if len(children) < 2 {
		return fmt.Errorf("class outing demo children not available")
	}
	auth, err := loginSchoolTeacher(rt, teacher.Email, teacher.Password)
	if err != nil {
		return err
	}
	ids := make([]ident.ID, 0, len(children))
	for _, id := range children {
		ids = append(ids, ident.ID(id))
	}
	if _, err := rt.Client.PostWithAuth(auth, "/school/class-day/class-trips/"+url.PathEscape(class), map[string]any{
		"from": today.String(), "to": today.String(), "student_ids": ids,
		"reason": "Zoo", "return_time": "13:00",
	}); err != nil {
		return fmt.Errorf("seed class outing: %w", err)
	}
	fmt.Println("  School teacher's class outing and cancelled appointment created")
	return nil
}

// seedTeacherAppointment is a Klassenkonferenz of the Leitung for the
// Lehrkräfte of moto schule (all_teachers: a single staff target needs
// calendar:own), cancelled today.
func seedTeacherAppointment(rt *Runtime, today seedDate) error {
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)
	id, err := postCalendarAppointment(rt, map[string]any{
		"title": "Klassenkonferenz", "location": "Lehrerzimmer",
		"start_date": today.String(), "end_date": today.String(), "start_time": "14:00", "end_time": "15:00", "all_day": false,
		"delivery_mode": "informational", "targets": []map[string]any{{"type": "all_teachers"}}, "send_email": false,
	})
	if err != nil {
		return err
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/calendar/appointments/%d/cancel", id), nil); err != nil {
		return fmt.Errorf("cancel the Klassenkonferenz: %w", err)
	}
	return nil
}
