package api

import (
	"context"
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

	"github.com/moto-ogs/project-phoenix/demoprofile"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var demoWeekdays = []string{"mon", "tue", "wed", "thu", "fri"}

const neighbourArrivalTime = "12:30"

type demoNeighbourSchool struct {
	key, name  string
	firstNames []string
	surnames   []string
	families   []string
	offerings  []seedCareOffering
}

func neighbourOffering(name string, places int, pickup string, weekdays []string) seedCareOffering {
	return seedCareOffering{
		name: name, capacity: &places, pickupTime: pickup, countsAsCare: true,
		daysMode: "fixed", days: weekdays,
	}
}

func (n demoNeighbourSchool) profile() demoProfileDefinition {
	definition := manualProfileDefinition()
	full := fullOperationProfileSettings()
	for _, key := range []string{profileSettingAttendanceLog, profileSettingEnrollmentEnabled, profileSettingCareOfferingsEnabled} {
		definition.Settings[key] = full[key]
	}
	bookings := definition.Settings[profileSettingBookingsAuthoritative]
	bookings.Value = []byte("true")
	definition.Settings[profileSettingBookingsAuthoritative] = bookings
	return definition
}

func (n demoNeighbourSchool) seedCare(ctx context.Context, rt *Runtime, options SeedOptions, definition demoProfileDefinition) error {
	if err := n.seedBookings(rt); err != nil {
		return err
	}
	write := presenceHistoryWriterFor(options, rt)
	if write == nil {
		return nil
	}
	today, err := rt.historyToday()
	if err != nil {
		return err
	}
	input, err := pastCareInputFrom(rt, definition, today, today.AddDays(-presenceHistoryDays))
	if err != nil {
		return err
	}
	devices, err := listOperatorSeedDevices(rt, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	web, err := findWebManualSeedDevice(devices)
	if err != nil {
		return err
	}
	input.deviceID = web.ID
	if options.PresenceHistoryRoute {
		if err := loadDemoPresenceBookings(rt, &input); err != nil {
			return err
		}
	}
	return seedPresenceHistoryPlan(ctx, rt, rt.Bootstrap.SchoolID, write, planPresenceHistory(input))
}

func (n demoNeighbourSchool) seedBookings(rt *Runtime) error {
	groups, err := seedManualGroups(rt)
	if err != nil {
		return err
	}
	enrollment := parentEnrollmentSeedStep{}
	schema, err := enrollment.createEnrollmentSchema(rt, rt.TenantAuth)
	if err != nil {
		return err
	}
	phase, phaseBody, err := enrollment.createEnrollmentPhase(rt, rt.TenantAuth, schema)
	if err != nil {
		return err
	}
	offerings := make([]int64, 0, len(n.offerings))
	for i, offering := range n.offerings {
		offering.sort = i + 1
		raw, err := rt.Client.Post("/api/enrollment/care-offerings", careOfferingSeedBody(offering, phase))
		if err != nil {
			return fmt.Errorf("create neighbour school offering %s: %w", offering.name, err)
		}
		id, err := parseEnvelopeStringID(raw)
		if err != nil {
			return err
		}
		offerings = append(offerings, id)
	}

	count := len(n.firstNames) * len(n.surnames)
	if err := withPhaseAudience(rt, rt.TenantAuth, phase, phaseBody, "existing_students", func() error {
		return n.seedRoster(rt, groups, phase, offerings, count)
	}); err != nil {
		return err
	}
	fmt.Printf("  Träger: neighbour school %s with %d children and %d care offerings\n", n.name, count, len(offerings))
	return nil
}

func (n demoNeighbourSchool) seedRoster(rt *Runtime, groups map[string]SeedEntityRef, phase int64, offerings []int64, count int) error {
	var children []demoprofile.NeighbourChild
	for i := range count {
		groupID := groups[fmt.Sprintf("bezugsgruppe-%d", 1+i*2/count)].ID
		offeringIndex := 0
		// The last third at Rheinblick uses the shorter offering.
		if len(offerings) == 2 && i >= count*2/3 {
			offeringIndex = 1
		}
		offering := n.offerings[offeringIndex]
		id, err := n.seedChild(rt, i, groupID, phase, offerings[offeringIndex], offering)
		if err != nil {
			return err
		}
		if i%4 == 0 {
			children = append(children, demoprofile.NeighbourChild{
				StudentID: id, Weekdays: offering.days, Arrival: neighbourArrivalTime, Pickup: offering.pickupTime,
			})
		}
	}
	// At this point the school's only staff member is the synthetic admin.
	staff, err := listSeedStaffIDs(rt)
	if err != nil {
		return err
	}
	if len(staff) != 1 {
		return fmt.Errorf("expected one neighbour school admin, got %d staff members", len(staff))
	}
	rt.neighbourAttendance = append(rt.neighbourAttendance, demoprofile.NeighbourAttendance{
		SchoolID:   rt.Bootstrap.SchoolID,
		StaffID:    staff[0],
		TenantSlug: rt.Bootstrap.TenantSlug,
		Admin:      makeBootstrapSeedState(rt.Bootstrap).SchoolAdmin,
		Children:   children,
	})
	return nil
}

func (n demoNeighbourSchool) seedChild(rt *Runtime, index int, groupID, phaseID, offeringID int64, offering seedCareOffering) (int64, error) {
	firstName := n.firstNames[index%len(n.firstNames)]
	lastName := n.surnames[index/len(n.firstNames)]
	guardian := n.families[index%len(n.families)]
	email := fmt.Sprintf("kontakt-%s-%02d@example.test", n.key, index+1)
	grade := 1 + index%4
	year := seedSchoolYearStart(rt.FixedSeeder.seedDay)
	birthday := calendar.NewDate(year-5-grade, 1, index+1).String()
	var arrivals, pickups []map[string]any
	for weekday := range offering.days {
		arrivals = append(arrivals, map[string]any{"weekday": weekday + 1, "expected_arrival": neighbourArrivalTime})
		pickups = append(pickups, map[string]any{"weekday": weekday + 1, "pickup_time": offering.pickupTime})
	}
	raw, err := rt.Client.Post("/api/students", map[string]any{
		"first_name": firstName, "last_name": lastName,
		"school_class": fmt.Sprintf("%da", grade), "group_id": ident.ID(groupID),
		"birthday": birthday, "pickup_status": "Wird abgeholt",
		"arrival_schedules": arrivals, "pickup_schedules": pickups,
		"guardians": []map[string]any{{
			"first_name": guardian, "last_name": lastName, "email": email,
			"relationship_type": "parent", "is_primary": true,
			"is_emergency_contact": true, "can_pickup": true, "emergency_priority": 1,
		}},
	})
	if err != nil {
		return 0, fmt.Errorf("create neighbour school child %d: %w", index+1, err)
	}
	id, err := decodeSeedEntityID(raw)
	if err != nil {
		return 0, err
	}
	raw, err = postShownForm(rt.Client.Get, map[string]any{
		"guardian_first_name": guardian, "guardian_last_name": lastName, "guardian_email": email,
		"consent_flags": map[string]bool{"data_processing": true},
		"children": []map[string]any{{
			"first_name": firstName, "last_name": lastName, "date_of_birth": birthday,
			"target_grade_level": grade, "offering_ids": []ident.ID{ident.ID(offeringID)},
			"custom_data": seedEnrollmentChildAnswers(firstName, lastName),
		}},
		"reason": "Buchung für das laufende Schuljahr", "external_consent_confirmed": true, "phase_id": ident.ID(phaseID),
	}, func(b map[string]any) ([]byte, error) {
		return rt.Client.Post(fmt.Sprintf("/api/enrollment/phases/%d/manual-approved-enrollments", phaseID), b)
	})
	if err != nil {
		return 0, fmt.Errorf("book care of neighbour school child %d: %w", index+1, err)
	}
	var result struct {
		Data struct {
			StudentID string `json:"student_id"`
			Status    string `json:"status"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &result); err != nil {
		return 0, err
	}
	if result.Data.StudentID != strconv.FormatInt(id, 10) || result.Data.Status != "approved" {
		return 0, fmt.Errorf("approved booking did not reach neighbour school child %d", id)
	}
	return id, nil
}
