package application

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/roots/communicationtest"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// --- doubles for the Serienbrief ports (#4813) -----------------------------

type memoryLetterCopies struct {
	copies  map[int64][]communication.ParentLetterCopy
	deleted int
}

func (m *memoryLetterCopies) ReplaceParentLetterCopies(_ context.Context, _, announcementID int64, copies []communication.ParentLetterCopy) error {
	if m.copies == nil {
		m.copies = map[int64][]communication.ParentLetterCopy{}
	}
	if len(copies) == 0 {
		m.deleted++
	}
	m.copies[announcementID] = append([]communication.ParentLetterCopy(nil), copies...)
	return nil
}

func (m *memoryLetterCopies) ParentLetterCopies(_ context.Context, _, announcementID int64) ([]communication.ParentLetterCopy, error) {
	return m.copies[announcementID], nil
}

// letterChildValues answers what the owners know of each child today.
type letterChildValues map[int64]communication.ParentLetterChild

func (v letterChildValues) ParentLetterChildren(_ context.Context, ids []int64) ([]communication.ParentLetterChild, error) {
	out := []communication.ParentLetterChild{}
	for _, id := range ids {
		if child, ok := v[id]; ok {
			out = append(out, child)
		}
	}
	return out, nil
}

type recordingLetterAccess struct {
	entries []communication.ParentLetterAccess
}

func (r *recordingLetterAccess) RecordParentLetterAccess(_ context.Context, access communication.ParentLetterAccess) error {
	r.entries = append(r.entries, access)
	return nil
}

type fixedLetterLogo []byte

func (l fixedLetterLogo) ParentLetterLogo(context.Context, string) []byte { return l }

type letterFixture struct {
	repo    *letterRepo
	outbox  *letterOutbox
	copies  *memoryLetterCopies
	values  letterChildValues
	access  *recordingLetterAccess
	service StaffService
}

// Two families: Muster with the siblings Lina and Ben at one address, Weber
// with Emil. Each family must only ever read its own children's letters.
func newPersonalLetterFixture(body string) letterFixture {
	draft := letterDraft(StaffParentAnnouncementDeliveryLetter, StaffEmailAudiencePortalOnly)
	draft.Body = body
	lina := contact(1, acct(11), "muster@example.test", true)
	lina.StudentIDs = []int64{101, 102}
	weber := contact(2, acct(12), "weber@example.test", true)
	weber.StudentIDs = []int64{103}
	f := letterFixture{
		repo: &letterRepo{
			announcement: draft,
			recipients:   []*StaffAnnouncementDeliveryRecipient{lina, weber},
			children: []*StaffAnnouncementLetterChildStatus{
				{StudentID: 101, FirstName: "Lina", LastName: "Muster", SchoolClass: "3a"},
				{StudentID: 102, FirstName: "Ben", LastName: "Muster", SchoolClass: "1b"},
				{StudentID: 103, FirstName: "Emil", LastName: "Weber", SchoolClass: "3a"},
			},
		},
		outbox: &letterOutbox{},
		copies: &memoryLetterCopies{},
		values: letterChildValues{
			101: {StudentID: 101, FirstName: "Lina", LastName: "Muster", SchoolClass: "3a", Group: "Füchse", CareDays: "Montag und Dienstag", PickupTime: "15:30 Uhr"},
			102: {StudentID: 102, FirstName: "Ben", LastName: "Muster", SchoolClass: "1b", Group: "Igel", CareDays: "Freitag"},
			103: {StudentID: 103, FirstName: "Emil", LastName: "Weber", SchoolClass: "3a", Group: "Füchse", CareDays: "Montag bis Freitag", PickupTime: "16:00 Uhr"},
		},
		access: &recordingLetterAccess{},
	}
	f.service = NewService(ServiceConfig{
		Now: staffTestClock, Repo: f.repo, Settings: &fakeSettings{enabled: true, logoURL: "/uploads/login-images/7.png"},
		Notifier: &fakeNotifier{}, Outbox: f.outbox, Deliveries: &letterDeliveries{},
		ParentsURL: "https://eltern.example.test", Logger: slog.Default(),
		Letters: communication.ParentLetters{Copies: f.copies, Children: f.values, Logos: fixedLetterLogo("png"), Access: f.access},
	}, testpkg.TenantTransactionRuntime{}, deliveryPolicy.NewParentDeliveryPolicy())
	return f
}

const personalLetterBody = "Liebe Eltern von {{vorname}},\n\n{{vorname}} ist in der Gruppe {{gruppe}}.\nAbholzeit: {{abholzeit}}"

func mailBodies(outbox *letterOutbox) map[string]string {
	out := map[string]string{}
	for _, request := range outbox.requests {
		recipient, _ := request.Payload[emailPayloadRecipient].(string)
		body, _ := request.Payload[emailPayloadBody].(string)
		out[recipient] = body
	}
	return out
}

func TestPublishPersonalLetterWritesOneFrozenLetterPerChild(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture(personalLetterBody)

	if _, err := f.service.Publish(context.Background(), 42); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	copies := f.copies.copies[42]
	if len(copies) != 3 {
		t.Fatalf("wrote %d letters, want one per reached child (3)", len(copies))
	}
	want := map[int64]string{
		101: "Liebe Eltern von Lina,\n\nLina ist in der Gruppe Füchse.\nAbholzeit: 15:30 Uhr",
		102: "Liebe Eltern von Ben,\n\nBen ist in der Gruppe Igel.",
		103: "Liebe Eltern von Emil,\n\nEmil ist in der Gruppe Füchse.\nAbholzeit: 16:00 Uhr",
	}
	for _, c := range copies {
		if c.Body != want[c.StudentID] {
			t.Errorf("letter of child %d:\n%q\nwant\n%q", c.StudentID, c.Body, want[c.StudentID])
		}
		if c.PublishedAt.IsZero() {
			t.Errorf("letter of child %d carries no publication instant", c.StudentID)
		}
	}

	// The child's data change after publication; the letter does not.
	f.values[101] = communication.ParentLetterChild{StudentID: 101, FirstName: "Lina", Group: "Bären", PickupTime: "14:00 Uhr"}
	printed, err := f.service.PrintParentLetters(context.Background(), 5, 42)
	if err != nil {
		t.Fatalf("PrintLetters: %v", err)
	}
	for _, c := range printed.Copies {
		if c.Body != want[c.StudentID] {
			t.Errorf("printed letter of child %d changed after publication: %q", c.StudentID, c.Body)
		}
	}
}

func TestPublishPersonalLetterMailsEachFamilyOnlyItsOwnChildren(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture(personalLetterBody)

	if _, err := f.service.Publish(context.Background(), 42); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	bodies := mailBodies(f.outbox)
	if len(bodies) != 2 {
		t.Fatalf("queued mails to %d addresses, want 2", len(bodies))
	}
	muster := bodies["muster@example.test"]
	for _, wanted := range []string{"Brief für Lina Muster:", "Lina ist in der Gruppe Füchse.", "Brief für Ben Muster:", "Ben ist in der Gruppe Igel."} {
		if !strings.Contains(muster, wanted) {
			t.Errorf("the Muster mail misses %q:\n%s", wanted, muster)
		}
	}
	if strings.Contains(muster, "Emil") || strings.Contains(muster, "16:00") {
		t.Errorf("the Muster mail names another family's child:\n%s", muster)
	}
	weber := bodies["weber@example.test"]
	if weber != "Liebe Eltern von Emil,\n\nEmil ist in der Gruppe Füchse.\nAbholzeit: 16:00 Uhr" {
		t.Errorf("the Weber mail is %q, want Emil's letter alone", weber)
	}
	for address, body := range bodies {
		if strings.Contains(body, "{{") {
			t.Errorf("the mail to %s shows a placeholder: %q", address, body)
		}
	}
}

func TestPublishLetterWithoutPlaceholdersKeepsOneTextAndStillWritesCopies(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture("Liebe Eltern,\n\nam Freitag ist Sommerfest.")

	if _, err := f.service.Publish(context.Background(), 42); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	for address, body := range mailBodies(f.outbox) {
		if body != "Liebe Eltern,\n\nam Freitag ist Sommerfest." {
			t.Errorf("the mail to %s is %q, want the one text of the letter", address, body)
		}
	}
	if got := len(f.copies.copies[42]); got != 3 {
		t.Fatalf("wrote %d letters, want 3: a letter without placeholders prints one page per child too", got)
	}
}

func TestUnpublishDropsTheLettersOfThePublication(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture(personalLetterBody)
	if _, err := f.service.Publish(context.Background(), 42); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if _, err := f.service.Unpublish(context.Background(), 42); err != nil {
		t.Fatalf("Unpublish: %v", err)
	}
	if len(f.copies.copies[42]) != 0 || f.copies.deleted == 0 {
		t.Fatal("a retracted letter must not keep its letters")
	}
	if _, err := f.service.PrintParentLetters(context.Background(), 5, 42); !errors.Is(err, communication.ErrParentLetterNotPrintable) {
		t.Fatalf("printing a retracted letter: err = %v, want ErrParentLetterNotPrintable", err)
	}
}

func TestPrintLettersReturnsTheSchoolAndLogsTheAccess(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture(personalLetterBody)
	if _, err := f.service.PrintParentLetters(context.Background(), 5, 42); !errors.Is(err, communication.ErrParentLetterNotPrintable) {
		t.Fatalf("printing a draft: err = %v, want ErrParentLetterNotPrintable", err)
	}
	if _, err := f.service.Publish(context.Background(), 42); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	printed, err := f.service.PrintParentLetters(context.Background(), 5, 42)
	if err != nil {
		t.Fatalf("PrintLetters: %v", err)
	}
	if printed.SchoolName != "OGS Testschule" || string(printed.Logo) != "png" || len(printed.Copies) != 3 {
		t.Fatalf("print = %q, logo %q, %d letters; want the school, its logo and 3 letters", printed.SchoolName, printed.Logo, len(printed.Copies))
	}
	if len(f.access.entries) != 1 {
		t.Fatalf("logged %d accesses, want 1", len(f.access.entries))
	}
	entry := f.access.entries[0]
	if entry.Kind != communication.ParentLetterAccessPrint || entry.ActorAccountID != 5 || entry.ChildCount != 3 || entry.AnnouncementID == nil || *entry.AnnouncementID != 42 {
		t.Fatalf("access entry = %+v", entry)
	}
}

func TestPreviewLetterFillsOneChildAndLogsTheAccess(t *testing.T) {
	t.Parallel()
	f := newPersonalLetterFixture(personalLetterBody)

	preview, err := f.service.PreviewParentLetter(context.Background(), 5, "Hallo {{vorname}} aus der {{klasse}}", 103)
	if err != nil {
		t.Fatalf("PreviewLetter: %v", err)
	}
	if preview.Body != "Hallo Emil aus der 3a" || preview.Child.StudentID != 103 {
		t.Fatalf("preview = %+v", preview)
	}
	if len(f.access.entries) != 1 || f.access.entries[0].Kind != communication.ParentLetterAccessPreview || *f.access.entries[0].StudentID != 103 {
		t.Fatalf("access entries = %+v, want one preview of child 103", f.access.entries)
	}
	if _, err := f.service.PreviewParentLetter(context.Background(), 5, "Hallo {{vorname}}", 999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("preview for an unknown child: err = %v, want ErrNotFound", err)
	}
	var placeholders *communication.ParentLetterPlaceholderError
	if _, err := f.service.PreviewParentLetter(context.Background(), 5, "Hallo {{allergien}}", 103); !errors.As(err, &placeholders) {
		t.Fatalf("preview with an unknown placeholder: err = %v, want ParentLetterPlaceholderError", err)
	}
	if len(f.access.entries) != 1 {
		t.Fatalf("refused previews logged an access: %+v", f.access.entries)
	}
}

func TestSavingRefusesPlaceholdersALetterCannotFill(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		in         func() Input
		letterOnly bool
		names      []string
	}{
		"unknown placeholder in a letter": {in: func() Input {
			in := letterInput()
			in.Body = "Hallo {{vorname}}, {{geburtstag}} {{allergien}}"
			return in
		}, names: []string{"allergien", "geburtstag"}},
		"placeholder in the subject": {in: func() Input {
			in := letterInput()
			in.Title = "Brief für {{vorname}}"
			return in
		}, letterOnly: true},
		"placeholder in a plain announcement": {in: func() Input {
			in := letterInput()
			in.DeliveryMode = StaffParentAnnouncementDeliveryStandard
			in.Body = "Hallo {{vorname}}"
			return in
		}, letterOnly: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			in := tc.in()
			_, err := normalizeInput(&in, staffTestNow)
			var placeholders *communication.ParentLetterPlaceholderError
			if !errors.As(err, &placeholders) {
				t.Fatalf("err = %v, want ParentLetterPlaceholderError", err)
			}
			if placeholders.LetterOnly != tc.letterOnly || strings.Join(placeholders.Names, ",") != strings.Join(tc.names, ",") {
				t.Fatalf("error = %+v", placeholders)
			}
		})
	}
	in := letterInput()
	in.Body = "Liebe Eltern von {{vorname}} {{nachname}} ({{klasse}}, {{gruppe}}): {{betreuungstage}}, {{abholzeit}}"
	if _, err := normalizeInput(&in, staffTestNow); err != nil {
		t.Fatalf("a letter with every known placeholder: %v", err)
	}
}
