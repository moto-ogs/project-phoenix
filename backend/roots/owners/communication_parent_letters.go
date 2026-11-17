package owners

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/jpeg" // the login image may be JPEG
	_ "image/png"
	"os"
	"strings"

	_ "golang.org/x/image/webp" // the login image may be WebP

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

// BuildParentLetters binds the ports the personalised letters read over the
// owners a root has built: the People Directory, the school structure, Care
// Plan's weekly plans, the access log and the signed-in account of the
// request.
func BuildParentLetters(students ParentLetterStudents, groups schoolstructure.Query, schedules CarePlanSchedules, audit AuditOwner, tokens TokenAdapter) communicationCompose.ParentLetterPorts {
	return communicationCompose.ParentLetterPorts{
		Sources: communicationPorts.ParentLetterSources{
			Students: parentLetterStudents{source: students},
			Groups:   parentLetterGroups{source: groups}.GroupNames,
			Pickups:  parentLetterPickups{source: schedules.Pickups},
			Arrivals: parentLetterArrivals{source: schedules.Arrivals},
		},
		Logos: parentLetterLogos{},
		Access: parentLetterAccessLog{writer: audit.Persistence.DataAccessLog, actor: func(ctx context.Context) int64 {
			claims, _ := tokens.Claims(ctx)
			return claims.AccountID
		}},
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

// letterLogoImage keeps an upload the letters can show: a PNG, JPEG or
// WebP image. Anything else prints no logo.
func letterLogoImage(data []byte) []byte {
	if _, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
		return nil
	}
	return data
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
	case communication.ParentLetterAccessPreview:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPreview
	case communication.ParentLetterAccessPrint:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPrint
	case communication.ParentLetterAccessPublish:
		entry.ResourceType = auditModels.ResourceTypeParentLetterPublish
	case communication.ParentLetterAccessStudentRecords:
		entry.ResourceType = auditModels.ResourceTypeStudentParentRecords
	case communication.ParentLetterAccessDeclarationProof:
		entry.ResourceType = auditModels.ResourceTypeParentDeclarationProof
	default:
		return fmt.Errorf("parent letter access: unknown kind %q", access.Kind)
	}
	if access.AnnouncementID != nil {
		entry.Metadata["announcement_id"] = *access.AnnouncementID
	}
	return a.writer.Create(ctx, entry)
}
