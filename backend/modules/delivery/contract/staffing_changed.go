package contract

// The notification types of a substitution or another change to who staffs a
// block (#7136). Timetable produces them; Delivery registers the types.
const (
	// NotificationStaffingChanged reaches the people a change is about: the
	// person who substitutes and the person who is absent or substituted.
	NotificationStaffingChanged = "staffing_changed"
	// NotificationGroupStaffingChanged reaches the teachers assigned to the
	// OGS group of an affected block.
	NotificationGroupStaffingChanged = "group_staffing_changed"
)
