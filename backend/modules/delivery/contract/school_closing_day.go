package contract

import "context"

// NotificationSchoolClosingDayChanged is the notification type of a closing
// day of the school that was planned, changed or cancelled (#7144): every
// account of the school in the OGS portal and in moto schule hears about it
// in the notification feed, and by push while the change takes effect within
// 14 days and the person did not switch it off. School Calendar produces it;
// Delivery registers the type.
const NotificationSchoolClosingDayChanged = "school_closing_day_changed"

// NotificationParentSchoolClosingDayChanged is the same notice for the
// families (#7144): every guardian holding parent_portal.access for a child
// of the school. It follows the school switch of
// NotificationSchoolClosingDayChanged.
const NotificationParentSchoolClosingDayChanged = "parent_school_closing_day_changed"

// SchoolAudience names everybody a notice to the whole school reaches
// (#7144), in the caller's tenant transaction of the school: the active
// accounts with a role of the OGS portal or of moto schule, and the active
// guardian accounts with the children they hold parent_portal.access for. It
// applies the conditions the notification feed, Web Push and SSE apply on
// delivery, so nobody is named who could not read the entry. It applies no
// personal choice and leaves out nobody: the producer removes the person who
// triggered the change.
type SchoolAudience interface {
	SchoolAudience(ctx context.Context, tenantID int64) (SchoolAudienceMembers, error)
}

// SchoolAudienceMembers are the accounts of one school's audience.
// StaffAccountIDs have an OGS staff role and therefore still need the
// notification type's permission. SchoolAccountIDs have a moto-schule role;
// types can explicitly waive that permission for this portal. StudentIDs are
// the children the guardians reach the notice through.
type SchoolAudienceMembers struct {
	StaffAccountIDs    []int64
	SchoolAccountIDs   []int64
	GuardianAccountIDs []int64
	StudentIDs         []int64
}
