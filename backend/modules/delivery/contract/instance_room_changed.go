package contract

// The notification types of an appointment or offering that moves to another
// room (#7141). Timetable produces them; Delivery registers the types.
//
// The day decides the type: a move for today or tomorrow pushes unless the
// person switched it off, a move for a later day pushes only for whoever
// switched that on, and a move more than 14 days ahead reaches the feed only.
// Two types keep both choices visible as their own switch.
const (
	// NotificationInstanceRoomChanged reaches the staff of the block's
	// staffing about a move for today or tomorrow.
	NotificationInstanceRoomChanged = "instance_room_changed"
	// NotificationInstanceRoomChangedLater reaches the same staff about a
	// move for a later day.
	NotificationInstanceRoomChangedLater = "instance_room_changed_later"
	// NotificationParentRoomChanged reaches the guardians of the booked
	// children about a move for today or tomorrow.
	NotificationParentRoomChanged = "parent_room_changed"
	// NotificationParentRoomChangedLater reaches the same guardians about a
	// move for a later day.
	NotificationParentRoomChangedLater = "parent_room_changed_later"
)
