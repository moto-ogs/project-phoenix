package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffNoticePublication tells the audience of a Hinweis der Leitung that it
// was published (#7143). AccountIDs are the readers of its audience without
// the person who wrote it; Push is false for a notice that starts more than
// 14 days ahead, which then reaches the notification feed only.
type StaffNoticePublication struct {
	NoticeID  int64
	Title     string
	ValidFrom calendar.Date
	// ValidUntil is the zero Date for a notice without an end.
	ValidUntil calendar.Date
	AccountIDs []int64
	Push       bool
}

// StaffNoticePublications is the consumer-owned port to the readers of the
// Tagesinformationen and to Delivery's notification feed. ReaderAccountIDs
// lists the accounts of the request's school that read the notices in the
// OGS portal. NotifyStaffNoticePublished writes in the caller's transaction,
// so the notice commits or rolls back with the Hinweis.
type StaffNoticePublications interface {
	ReaderAccountIDs(ctx context.Context) ([]int64, error)
	NotifyStaffNoticePublished(ctx context.Context, publication StaffNoticePublication) error
}
