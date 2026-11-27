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

// KeyNotificationsMealPlanChangedEnabled lets a school switch off the notice
// to the families with a meal booking that the meal plan changed (#7145):
// neither feed entry nor push is written then.
const KeyNotificationsMealPlanChangedEnabled = "notifications.meal_plan_changed_enabled"

// KeyNotificationsInstanceRoomChangedEnabled lets a school switch off the
// notices about an appointment or offering that moves to another room
// (#7141): neither feed entry nor push is written then, for the staff of the
// block and for the families of its children.
const KeyNotificationsInstanceRoomChangedEnabled = "notifications.instance_room_changed_enabled"

// KeyNotificationsClassTimetableChangedEnabled lets a school switch off the
// notices about a changed Stundenplan of a class (#7142): neither feed entry
// nor push is written then, for the staff of the class and its families.
const KeyNotificationsClassTimetableChangedEnabled = "notifications.class_timetable_changed_enabled"

// KeyNotificationsSchoolClosingDayEnabled lets a school switch off the notice
// about a planned, changed or cancelled closing day (#7144): neither feed
// entry nor push is written then, for the team nor for the families.
const KeyNotificationsSchoolClosingDayEnabled = "notifications.school_closing_day_enabled"

// KeyNotificationsOpeningChangeEnabled lets a school switch off the notice
// about an entered, changed or deleted opening change (#8178): neither feed
// entry nor push is written then, for the team, the families nor the Träger.
const KeyNotificationsOpeningChangeEnabled = "notifications.opening_change_enabled"

// KeyNotificationsRoomClosedEnabled lets a school switch off the notice to
// the staff planned in a room it closes (#8234): neither feed entry nor push
// is written then.
const KeyNotificationsRoomClosedEnabled = "notifications.room_closed_enabled"
