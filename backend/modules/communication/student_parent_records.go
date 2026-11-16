package communication

import (
	"context"
	"fmt"
	"time"
)

// Kinderakte (#4814): what the school sent one child's family and what the
// family answered, read where staff look for the child. The rows stay with
// Communication; the child's record reads them, nothing is copied.

// PortalStudentAnnouncement is one published Elternbrief or Einverständnis
// that reached a child, or that a guardian answered for it. The
// confirmation fields belong to a letter.
type PortalStudentAnnouncement struct {
	AnnouncementID   int64
	Title            string
	DeliveryMode     string
	PublishedAt      time.Time
	ResponseDeadline *time.Time
	ExpiresAt        *time.Time
	Active           bool
	CanConfirm       bool
	AcknowledgedAt   *time.Time
	AckFirstName     string
	AckLastName      string
}

// PortalStudentParentRecords are the rows a child's record is derived from:
// the announcements, the settings and current version of each declaration
// among them, the guardians who may declare for the child, and the child's
// declaration history.
type PortalStudentParentRecords struct {
	Announcements []*PortalStudentAnnouncement
	Settings      map[int64]PortalAnnouncementDeclarationSettings
	Versions      map[int64]*PortalDeclarationVersion
	Signers       []*PortalDeclarationSigner
	Submissions   []*PortalDeclarationSubmission
}

// StudentParentRecordRecords reads a child's record rows of the ambient
// school in a constant number of statements.
type StudentParentRecordRecords interface {
	AnnouncementStudentParentRecords(ctx context.Context, studentID int64) (*PortalStudentParentRecords, error)
}

// StudentParentLetter is one Elternbrief that reached the child, with the
// confirmation for that child: who confirmed it first and when. CanConfirm
// is false when no guardian of the child has a parent account.
type StudentParentLetter struct {
	AnnouncementID int64
	Title          string
	PublishedAt    time.Time
	CanConfirm     bool
	AcknowledgedAt *time.Time
	AcknowledgedBy string
}

// StudentParentDeclaration is one Einverständnis of the child with its
// state on the current version and who may answer for the child.
type StudentParentDeclaration struct {
	AnnouncementID int64
	Title          string
	PublishedAt    time.Time
	Deadline       *time.Time
	VersionNo      int
	State          string
	Signers        []DeclarationSignerStatus
}

// StudentParentRecords is a child's record of letters and declarations,
// newest first.
type StudentParentRecords struct {
	Letters      []StudentParentLetter
	Declarations []StudentParentDeclaration
}

// StudentParentRecordCapability reads a child's record and the proof of one
// declaration, for the whole school or for one child. Both reads are written
// to the data access log under actorAccountID.
type StudentParentRecordCapability interface {
	StudentParentRecords(ctx context.Context, actorAccountID, studentID int64) (*StudentParentRecords, error)
	// ParentDeclarationProof is the status a proof is rendered from. With a
	// student it holds only that child and its history; a child the
	// declaration never reached is ErrParentAnnouncementNotFound.
	ParentDeclarationProof(ctx context.Context, actorAccountID, announcementID int64, studentID *int64) (*ParentDeclarationStatus, error)
}

// StudentParentRecordsOf returns the child records of the parent
// announcements, which the owner composes with them.
func StudentParentRecordsOf(announcements ParentAnnouncementCapability) (StudentParentRecordCapability, error) {
	records, ok := announcements.(StudentParentRecordCapability)
	if !ok {
		return nil, fmt.Errorf("student parent records: parent announcements %T were composed without them", announcements)
	}
	return records, nil
}
