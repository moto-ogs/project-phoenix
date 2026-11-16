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
