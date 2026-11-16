package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// Kinderakte (#4814): the letters and declarations of one child, read from
// Communication's own rows where staff look for the child, and the proof of
// a declaration for the school or for that child. Both reads are written to
// the data access log.

var errStudentRecordsNotWired = errors.New("announcement: student records are not wired")

// StudentParentRecords returns every Elternbrief that reached the child with
// the child's confirmation, and every Einverständnis of the child with its
// state on the current version, newest first.
func (s *service) StudentParentRecords(ctx context.Context, actorAccountID, studentID int64) (*communication.StudentParentRecords, error) {
	records, err := s.studentParentRecords(ctx, actorAccountID, studentID)
	return records, mapParentAnnouncementError(err)
}

func (s *service) studentParentRecords(ctx context.Context, actorAccountID, studentID int64) (*communication.StudentParentRecords, error) {
	if s.studentRecords == nil {
		return nil, errStudentRecordsNotWired
	}
	rows, err := s.studentRecords.AnnouncementStudentParentRecords(ctx, studentID)
	if err != nil {
		return nil, fmt.Errorf("announcement: read student records: %w", err)
	}
	out := &communication.StudentParentRecords{
		Letters:      []communication.StudentParentLetter{},
		Declarations: []communication.StudentParentDeclaration{},
	}
	now := s.now()
	for _, a := range rows.Announcements {
		if a.DeliveryMode == StaffParentAnnouncementDeliveryDeclaration {
			out.Declarations = append(out.Declarations, studentDeclaration(a, rows, studentID, now))
			continue
		}
		out.Letters = append(out.Letters, studentLetter(a))
	}
	if err := s.recordLetterAccess(ctx, communication.ParentLetterAccess{
		ActorAccountID: actorAccountID, Kind: communication.ParentLetterAccessStudentRecords,
		StudentID: &studentID, ChildCount: 1,
	}); err != nil {
		return nil, err
	}
	return out, nil
}

func studentLetter(a *communication.PortalStudentAnnouncement) communication.StudentParentLetter {
	letter := communication.StudentParentLetter{
		AnnouncementID: a.AnnouncementID, Title: a.Title, PublishedAt: a.PublishedAt,
		CanConfirm: a.CanConfirm || a.AcknowledgedAt != nil, AcknowledgedAt: a.AcknowledgedAt,
	}
	if a.AcknowledgedAt != nil {
		letter.AcknowledgedBy = strings.TrimSpace(a.AckFirstName + " " + a.AckLastName)
	}
	return letter
}

// studentDeclaration derives the child's state exactly as the declaration's
// own status does: the same rules, signers and latest action per signer on
// the current version.
func studentDeclaration(a *communication.PortalStudentAnnouncement, rows *communication.PortalStudentParentRecords, studentID int64, now time.Time) communication.StudentParentDeclaration {
	facts := &declarationFacts{
		announcement: &StaffParentAnnouncement{
			ID: a.AnnouncementID, Title: a.Title, ResponseDeadline: a.ResponseDeadline,
			DeliveryMode: a.DeliveryMode, Declaration: StaffAnnouncementDeclarationSettings(rows.Settings[a.AnnouncementID]),
		},
		children: []*StaffDeclarationChild{{AnnouncementID: a.AnnouncementID, StudentID: studentID}},
		signers:  map[int64][]*StaffDeclarationSigner{},
	}
	if version := rows.Versions[a.AnnouncementID]; version != nil {
		facts.versions = []*StaffDeclarationVersion{StaffAnnouncementDeclarationVersionFromValue((*DeclarationVersion)(version))}
	}
	for _, signer := range rows.Signers {
		if signer.StudentID == studentID {
			facts.signers[studentID] = append(facts.signers[studentID], (*StaffDeclarationSigner)(signer))
		}
	}
	for _, sub := range rows.Submissions {
		if sub.AnnouncementID == a.AnnouncementID && sub.StudentID == studentID {
			facts.submissions = append(facts.submissions, (*StaffDeclarationSubmission)(sub))
		}
	}
	declaration := communication.StudentParentDeclaration{
		AnnouncementID: a.AnnouncementID, Title: a.Title, PublishedAt: a.PublishedAt, Deadline: a.ResponseDeadline,
		Signers: []communication.DeclarationSignerStatus{},
	}
	if current := facts.currentVersion(); current != nil {
		declaration.VersionNo = current.VersionNo
	}
	for _, child := range declarationChildStatuses(facts, now) {
		declaration.State = child.State
		for _, signer := range child.Signers {
			declaration.Signers = append(declaration.Signers, communication.DeclarationSignerStatus(signer))
		}
	}
	return declaration
}

// ParentDeclarationProof is the status a declaration's proof is rendered
// from, narrowed to one child when a student is given. The download is
// written to the data access log.
func (s *service) ParentDeclarationProof(ctx context.Context, actorAccountID, announcementID int64, studentID *int64) (*communication.ParentDeclarationStatus, error) {
	status, err := s.declarationProof(ctx, actorAccountID, announcementID, studentID)
	if err != nil {
		return nil, mapParentAnnouncementError(err)
	}
	return mapDeclarationStatus(status), nil
}

func (s *service) declarationProof(ctx context.Context, actorAccountID, announcementID int64, studentID *int64) (*DeclarationStatus, error) {
	status, err := s.ParentDeclarationStatus(ctx, announcementID)
	if err != nil {
		return nil, err
	}
	if studentID != nil {
		if status, err = declarationStatusOfChild(status, *studentID); err != nil {
			return nil, err
		}
	}
	if err := s.recordLetterAccess(ctx, communication.ParentLetterAccess{
		ActorAccountID: actorAccountID, Kind: communication.ParentLetterAccessDeclarationProof,
		AnnouncementID: &announcementID, StudentID: studentID, ChildCount: status.ChildrenTotal,
	}); err != nil {
		return nil, err
	}
	return status, nil
}

// declarationStatusOfChild keeps one child and its history. The versions
// stay: they are what the child's answers were given on. A child the
// declaration does not list is not found, so a proof never names a child it
// never reached.
func declarationStatusOfChild(status *DeclarationStatus, studentID int64) (*DeclarationStatus, error) {
	child := *status
	child.Children = nil
	child.Submissions = nil
	child.Summary = map[string]int{}
	child.IntegrityAllGood = true
	for _, v := range status.Versions {
		child.IntegrityAllGood = child.IntegrityAllGood && v.IntegrityOK
	}
	for _, c := range status.Children {
		if c.StudentID == studentID {
			child.Children = append(child.Children, c)
			child.Summary[c.State]++
		}
	}
	if len(child.Children) == 0 {
		return nil, ErrNotFound
	}
	for _, sub := range status.Submissions {
		if sub.StudentID == studentID {
			child.Submissions = append(child.Submissions, sub)
			child.IntegrityAllGood = child.IntegrityAllGood && sub.IntegrityOK
		}
	}
	child.ChildrenTotal = len(child.Children)
	return &child, nil
}
