package records

// KeyNotificationsInstanceCancelledEnabled lets a school switch off the notice
// about a cancelled appointment or offering (#7148): neither feed entry nor
// push is written then.
const KeyNotificationsInstanceCancelledEnabled = "notifications.instance_cancelled_enabled"

// KeyNotificationsStaffingChangedEnabled lets a school switch off the notices
// about substitutions and other staffing changes (#7136): neither feed entry
// nor push is written then, for the people concerned, the group's teachers
// and the rest of the group's team (#7138).
const KeyNotificationsStaffingChangedEnabled = "notifications.staffing_changed_enabled"

// KeyNotificationsStaffNoticePublishedEnabled lets a school switch off the
// notice about a new Hinweis der Leitung (#7143): neither feed entry nor push
// is written then.
const KeyNotificationsStaffNoticePublishedEnabled = "notifications.staff_notice_published_enabled"

// KeyNotificationsInstanceRoomChangedEnabled lets a school switch off the
// notices about an appointment or offering that moves to another room
// (#7141): neither feed entry nor push is written then, for the staff of the
// block and for the families of its children.
const KeyNotificationsInstanceRoomChangedEnabled = "notifications.instance_room_changed_enabled"
