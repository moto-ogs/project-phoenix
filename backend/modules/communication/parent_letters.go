package communication

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrParentLetterNotPrintable refuses to print an announcement that is no
// published Elternbrief (#4813): only a letter that went out has letters to
// print.
var ErrParentLetterNotPrintable = errors.New("announcement: only a published parent letter can be printed")

// ParentLetterCopy is the letter one child got when an Elternbrief was
// published (#4813): the text with the child's values filled in, and the
// name and class it was addressed with. It stays as it was published, also
// when the child's data change later; a correction (unpublish, edit,
// publish) writes new copies.
type ParentLetterCopy struct {
	AnnouncementID int64
	StudentID      int64
	FirstName      string
	LastName       string
	SchoolClass    string
	Body           string
}

// ParentLetterCopyRecords keeps the copies of a letter in the publish
// transaction. Replace drops the copies of an earlier publication; no copies
// retract them.
type ParentLetterCopyRecords interface {
	ReplaceParentLetterCopies(ctx context.Context, tenantID, announcementID int64, copies []ParentLetterCopy) error
	ParentLetterCopies(ctx context.Context, tenantID, announcementID int64) ([]ParentLetterCopy, error)
}

// ParentLetterLogos reads the bytes of the school's logo for the printed
// letters. An unreadable or missing logo is nil: the letter prints without.
type ParentLetterLogos interface {
	ParentLetterLogo(ctx context.Context, logoURL string) []byte
}

// ParentLetterAccess is one read of children's data through a letter: a
// preview for one child or the print of every letter of a dispatch.
type ParentLetterAccess struct {
	ActorAccountID int64
	Kind           string
	AnnouncementID *int64
	StudentID      *int64
	ChildCount     int
	AccessedAt     time.Time
}

// The kinds of ParentLetterAccess. Publish is the read of every reached
// child's values when a letter that names each child goes out.
const (
	ParentLetterAccessPreview = "preview"
	ParentLetterAccessPrint   = "print"
	ParentLetterAccessPublish = "publish"
)

// ParentLetterAccessLog writes each read of children's data through a
// letter to the school's data access log, in the request transaction.
type ParentLetterAccessLog interface {
	RecordParentLetterAccess(ctx context.Context, access ParentLetterAccess) error
}

// ParentLetterPreview is a letter text filled for one child, before it is
// sent.
type ParentLetterPreview struct {
	Child ParentLetterChild
	Body  string
}

// ParentLetterPrint is every letter of one dispatch, ready to be laid out:
// the school that sends them and one copy per child.
type ParentLetterPrint struct {
	Title       string
	SchoolName  string
	SenderName  string
	Logo        []byte
	PublishedAt time.Time
	Copies      []ParentLetterCopy
}

// ParentLetterCapability fills, shows and prints the letters of a school.
// actorAccountID is the account the access log names. A preview with classes
// shows only a child of one of them (a Lehrkraft's reach); nil admits every
// child of the school.
type ParentLetterCapability interface {
	PreviewParentLetter(ctx context.Context, actorAccountID int64, body string, studentID int64, classes []string) (*ParentLetterPreview, error)
	PrintParentLetters(ctx context.Context, actorAccountID, announcementID int64) (*ParentLetterPrint, error)
}

// ParentLettersOf returns the letters of the parent announcements, which
// the owner composes with them.
func ParentLettersOf(announcements ParentAnnouncementCapability) (ParentLetterCapability, error) {
	letters, ok := announcements.(ParentLetterCapability)
	if !ok {
		return nil, fmt.Errorf("parent letters: parent announcements %T were composed without letters", announcements)
	}
	return letters, nil
}
