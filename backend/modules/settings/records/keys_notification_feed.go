package records

// KeyNotificationsInstanceCancelledEnabled lets a school switch off the notice
// about a cancelled appointment or offering (#7148): neither feed entry nor
// push is written then.
const KeyNotificationsInstanceCancelledEnabled = "notifications.instance_cancelled_enabled"

// KeyNotificationsStaffingChangedEnabled lets a school switch off the notices
// about substitutions and other staffing changes (#7136): neither feed entry
// nor push is written then, for the people concerned and the group's teachers.
const KeyNotificationsStaffingChangedEnabled = "notifications.staffing_changed_enabled"

// KeyNotificationsStaffNoticePublishedEnabled lets a school switch off the
// notice about a new Hinweis der Leitung (#7143): neither feed entry nor push
// is written then.
const KeyNotificationsStaffNoticePublishedEnabled = "notifications.staff_notice_published_enabled"
