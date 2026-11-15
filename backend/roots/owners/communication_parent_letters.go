package owners

import (
	"bytes"
	"context"
	"image/png"
	"os"
	"strings"
	"time"

	"golang.org/x/image/webp"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/communication"
	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	communicationPorts "github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ParentLetterStudents is the People Directory read of the letter values.
type ParentLetterStudents interface {
	ListStudentsByID(context.Context, []int64) ([]peopledirectory.Student, error)
	ListStudentNamesByID(context.Context, []int64) ([]peopledirectory.StudentName, error)
}

// ParentLetterPickups is the Care Plan read of the weekly pickup plan.
type ParentLetterPickups interface {
	GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, studentIDs []int64, date calendar.Date) ([]*careplan.PickupSchedule, error)
}

// ParentLetterArrivals is the Care Plan read of the weekly arrival plan. A
// weekday with an arrival or a pickup is a booked care day (Care Plan's
// CareDayNotScheduled: "no arrival and no pickup plans the weekday").
type ParentLetterArrivals interface {
	GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, studentIDs []int64, date calendar.Date) ([]*careplan.ArrivalSchedule, error)
}

// BuildParentLetters binds the Serienbrief ports over the owners a root has
// built: the People Directory, the school structure, Care Plan's weekly plans,
// the access log and the signed-in account of the request.
func BuildParentLetters(students ParentLetterStudents, groups schoolstructure.Query, schedules CarePlanSchedules, audit AuditOwner, tokens TokenAdapter, now func() time.Time) communication.ParentLetters {
	return NewParentLetters(communicationPorts.ParentLetterSources{
		Students: parentLetterStudents{source: students},
		Groups:   parentLetterGroups{source: groups}.GroupNames,
		Pickups:  parentLetterPickups{source: schedules.Pickups},
		Arrivals: parentLetterArrivals{source: schedules.Arrivals},
	},
		audit.Persistence.DataAccessLog, func(ctx context.Context) int64 { claims, _ := tokens.Claims(ctx); return claims.AccountID }, now)
}

// NewParentLetters binds the Serienbrief ports of the announcements. actor
// names the signed-in account the access log attributes a read to; a read
// without one (no request) is not logged as nobody's.
func NewParentLetters(sources communicationPorts.ParentLetterSources, accessLog DataAccessAppender, actor func(context.Context) int64, now func() time.Time) communication.ParentLetters {
	if now == nil {
		now = time.Now
	}
	return communication.ParentLetters{
		Children: communicationCompose.NewParentLetterChildren(sources, now),
		Logos:    parentLetterLogos{},
		Access:   parentLetterAccessLog{writer: accessLog, actor: actor},
	}
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
	if err != nil {
		return nil
	}
	return letterLogoImage(data)
}

// letterLogoImage is the logo as the letter layout embeds it: PNG and JPEG
// as uploaded, a WebP upload converted to PNG. Anything else prints no logo.
func letterLogoImage(data []byte) []byte {
	text := string(data)
	switch {
	case strings.HasPrefix(text, "\x89PNG\r\n\x1a\n"), strings.HasPrefix(text, "\xff\xd8\xff"):
		return data
	case len(text) >= 12 && text[:4] == "RIFF" && text[8:12] == "WEBP":
		decoded, err := webp.Decode(bytes.NewReader(data))
		if err != nil {
			return nil
		}
		var out bytes.Buffer
		if png.Encode(&out, decoded) != nil {
			return nil
		}
		return out.Bytes()
	}
	return nil
}

// parentLetterAccessLog writes each read of children's data through a
// letter to the school's data access log.
type parentLetterAccessLog struct {
	writer DataAccessAppender
	actor  func(context.Context) int64
}

func (a parentLetterAccessLog) RecordParentLetterAccess(ctx context.Context, access communication.ParentLetterAccess) error {
	if access.ActorAccountID <= 0 && a.actor != nil {
		access.ActorAccountID = a.actor(ctx)
	}
	if access.ActorAccountID <= 0 {
		return nil // no signed-in account: nobody to attribute the read to
	}
	entry := &auditModels.DataAccessLog{
		ActorAccountID: access.ActorAccountID, ActorRole: "staff", StudentID: access.StudentID,
		RangeStart: access.AccessedAt, RangeEnd: access.AccessedAt, AccessedAt: access.AccessedAt,
		Metadata: map[string]any{"child_count": access.ChildCount},
	}
	switch access.Kind {
	case communication.ParentLetterAccessPrint:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPrint
	case communication.ParentLetterAccessPublish:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPublish
	default:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPreview
	}
	if access.AnnouncementID != nil {
		entry.Metadata["announcement_id"] = *access.AnnouncementID
	}
	return a.writer.Create(ctx, entry)
}
