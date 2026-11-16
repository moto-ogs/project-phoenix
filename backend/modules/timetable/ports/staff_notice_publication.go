package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffNoticePublication tells the audience of a Hinweis der Leitung that it
// was published (#7143). ActorAccountID is the person who published it and
// never hears about it; Push is false for a notice that starts more than 14
// days ahead, which then reaches the notification feed only.
type StaffNoticePublication struct {
	NoticeID  int64
	Title     string
	ValidFrom calendar.Date
	// ValidUntil is the zero Date for a notice without an end.
	ValidUntil     calendar.Date
	ActorAccountID int64
	Push           bool
}

// StaffNoticePublications is the consumer-owned port to Delivery's
// notification feed. It reaches the accounts of the request's school that
// read the notices in the OGS portal, without the actor, and writes in the
// caller's transaction, so the notice commits or rolls back with the Hinweis.
type StaffNoticePublications interface {
	NotifyStaffNoticePublished(ctx context.Context, publication StaffNoticePublication) error
}
