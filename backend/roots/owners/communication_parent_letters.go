package owners

import (
	"context"
	"os"
	"sort"
	"strings"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Serienbriefe (#4813): the root binds what a parent letter names for each
// child to the owners of that data, through their public reads: name and
// class from the People Directory, the group's name from the School
// Structure, the booked days and the pickup time from the Care Plan's
// weekly pickup plan of today. Every read takes the whole set at once and
// runs in the request's tenant transaction, so a child of another school
// is never found.

// ParentLetterStudents is the People Directory read of the letter values.
type ParentLetterStudents interface {
	ListStudentsByID(context.Context, []int64) ([]peopledirectory.Student, error)
	ListStudentNamesByID(context.Context, []int64) ([]peopledirectory.StudentName, error)
}

// ParentLetterPickups is the Care Plan read of the weekly pickup plan.
type ParentLetterPickups interface {
	GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, studentIDs []int64, date calendar.Date) ([]*careplan.PickupSchedule, error)
}

// NewParentLetters binds the Serienbrief ports of the announcements.
func NewParentLetters(students ParentLetterStudents, groups schoolstructure.Query, pickups ParentLetterPickups, accessLog DataAccessAppender, now func() time.Time) communication.ParentLetters {
	if now == nil {
		now = time.Now
	}
	return communication.ParentLetters{
		Children: parentLetterChildren{students: students, groups: groups, pickups: pickups, now: now},
		Logos:    parentLetterLogos{},
		Access:   parentLetterAccessLog{writer: accessLog},
	}
}

type parentLetterChildren struct {
	students ParentLetterStudents
	groups   schoolstructure.Query
	pickups  ParentLetterPickups
	now      func() time.Time
}

func (c parentLetterChildren) ParentLetterChildren(ctx context.Context, studentIDs []int64) ([]communication.ParentLetterChild, error) {
	if len(studentIDs) == 0 {
		return []communication.ParentLetterChild{}, nil
	}
	students, err := c.students.ListStudentsByID(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	names, err := c.studentNames(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	groups, err := c.groupNames(ctx, students)
	if err != nil {
		return nil, err
	}
	weeks, err := c.pickupWeeks(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	out := make([]communication.ParentLetterChild, 0, len(students))
	for _, student := range students {
		child := communication.ParentLetterChild{
			StudentID: student.ID, FirstName: names[student.ID].FirstName, LastName: names[student.ID].LastName,
			SchoolClass: strings.TrimSpace(student.SchoolClass),
		}
		if student.GroupID != nil {
			child.Group = groups[*student.GroupID]
		}
		child.CareDays, child.PickupTime = letterCareWeek(weeks[student.ID])
		out = append(out, child)
	}
	return out, nil
}

func (c parentLetterChildren) studentNames(ctx context.Context, studentIDs []int64) (map[int64]peopledirectory.StudentName, error) {
	names, err := c.students.ListStudentNamesByID(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]peopledirectory.StudentName, len(names))
	for _, name := range names {
		byID[name.StudentID] = name
	}
	return byID, nil
}

func (c parentLetterChildren) groupNames(ctx context.Context, students []peopledirectory.Student) (map[int64]string, error) {
	groupIDs := make([]int64, 0, len(students))
	for _, student := range students {
		if student.GroupID != nil {
			groupIDs = append(groupIDs, *student.GroupID)
		}
	}
	names := map[int64]string{}
	if len(groupIDs) == 0 {
		return names, nil
	}
	groups, err := c.groups.ListGroupsByID(ctx, groupIDs)
	if err != nil {
		return nil, err
	}
	for _, group := range groups {
		names[group.ID] = group.Name
	}
	return names, nil
}

func (c parentLetterChildren) pickupWeeks(ctx context.Context, studentIDs []int64) (map[int64][]*careplan.PickupSchedule, error) {
	schedules, err := c.pickups.GetWeeklySchedulesByStudentIDsForDate(ctx, studentIDs, calendar.DateFromTime(c.now()))
	if err != nil {
		return nil, err
	}
	weeks := map[int64][]*careplan.PickupSchedule{}
	for _, schedule := range schedules {
		if schedule != nil {
			weeks[schedule.StudentID] = append(weeks[schedule.StudentID], schedule)
		}
	}
	return weeks, nil
}

var letterWeekdayNames = map[int]string{1: "Montag", 2: "Dienstag", 3: "Mittwoch", 4: "Donnerstag", 5: "Freitag", 6: "Samstag", 7: "Sonntag"}
var letterWeekdayShort = map[int]string{1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 7: "So"}

// letterCareWeek writes the booked weekdays and the pickup time of a weekly
// plan: "Montag, Dienstag und Donnerstag" and "15:30 Uhr", or per day
// "Mo 15:00 Uhr, Di 16:00 Uhr" when the times differ.
func letterCareWeek(week []*careplan.PickupSchedule) (string, string) {
	sort.Slice(week, func(i, j int) bool { return week[i].Weekday < week[j].Weekday })
	days := make([]string, 0, len(week))
	perDay := make([]string, 0, len(week))
	clocks := map[string]bool{}
	clock := ""
	for _, day := range week {
		name, ok := letterWeekdayNames[day.Weekday]
		if !ok {
			continue
		}
		clock = day.PickupTime.Format("15:04")
		clocks[clock] = true
		days = append(days, name)
		perDay = append(perDay, letterWeekdayShort[day.Weekday]+" "+clock+" Uhr")
	}
	switch {
	case len(days) == 0:
		return "", ""
	case len(clocks) == 1:
		return germanList(days), clock + " Uhr"
	}
	return germanList(days), strings.Join(perDay, ", ")
}

func germanList(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " und " + items[len(items)-1]
}

// parentLetterLogos reads the school's uploaded logo for the printed letters.
// Only uploads under the login image folder are read; anything else, and
// any file the renderer cannot embed, prints no logo.
type parentLetterLogos struct{}

const (
	letterLogoPublicDir = "public"
	letterLogoPrefix    = "/uploads/login-images/"
	letterLogoMaxBytes  = 2 << 20
)

func (parentLetterLogos) ParentLetterLogo(_ context.Context, logoURL string) []byte {
	path, err := objects.ResolveStoredPath(letterLogoPublicDir, strings.TrimSpace(logoURL), letterLogoPrefix)
	if err != nil {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() > letterLogoMaxBytes {
		return nil
	}
	data, err := os.ReadFile(path) //nolint:gosec // the path is resolved inside the upload folder
	if err != nil || !embeddableLetterLogo(data) {
		return nil
	}
	return data
}

// embeddableLetterLogo accepts the PNG and JPEG images the letter layout
// embeds; a WebP upload prints without a logo.
func embeddableLetterLogo(data []byte) bool {
	return strings.HasPrefix(string(data), "\x89PNG\r\n\x1a\n") || strings.HasPrefix(string(data), "\xff\xd8\xff")
}

// parentLetterAccessLog writes each read of children's data through a
// letter to the school's data access log.
type parentLetterAccessLog struct {
	writer DataAccessAppender
}

func (a parentLetterAccessLog) RecordParentLetterAccess(ctx context.Context, access communication.ParentLetterAccess) error {
	entry := &auditModels.DataAccessLog{
		ActorAccountID: access.ActorAccountID, ActorRole: "staff", StudentID: access.StudentID,
		RangeStart: access.AccessedAt, RangeEnd: access.AccessedAt, AccessedAt: access.AccessedAt,
		Metadata: map[string]any{"child_count": access.ChildCount},
	}
	switch access.Kind {
	case communication.ParentLetterAccessPrint:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPrint
	default:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPreview
	}
	if access.AnnouncementID != nil {
		entry.Metadata["announcement_id"] = *access.AnnouncementID
	}
	return a.writer.Create(ctx, entry)
}
