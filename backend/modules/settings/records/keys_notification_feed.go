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

// KeyNotificationsSchoolClosingDayEnabled lets a school switch off the notice
// about a planned, changed or cancelled closing day (#7144): neither feed
// entry nor push is written then, for the team nor for the families.
const KeyNotificationsSchoolClosingDayEnabled = "notifications.school_closing_day_enabled"
