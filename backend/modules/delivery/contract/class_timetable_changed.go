package contract

// The notification types of a changed Stundenplan of a class (#7142): the
// weekly Unterrichtsschluss of the class or a class-wide change on one day.
// Care Plan produces them; Delivery registers the types.
const (
	// NotificationClassTimetableChanged reaches the staff of the class: the
	// staff assigned to the class and the teachers of the OGS groups of its
	// children. It writes their feed always and pushes by default while the
	// change takes effect today or tomorrow.
	NotificationClassTimetableChanged = "class_timetable_changed"
	// NotificationClassTimetableChangedAhead is no event of its own: it is
	// the staff's choice whether a change 2 to 14 days ahead pushes too. The
	// feed entry of such a change is a NotificationClassTimetableChanged.
	NotificationClassTimetableChangedAhead = "class_timetable_changed_ahead"
	// NotificationParentClassTimetableChanged reaches the guardians with
	// parent_portal.access to a child of the class.
	NotificationParentClassTimetableChanged = "parent_class_timetable_changed"
)
