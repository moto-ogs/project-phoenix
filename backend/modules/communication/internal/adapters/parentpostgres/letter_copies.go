package parentpostgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// The letter each child got when an Elternbrief was published (#4813). Every
// statement touches Communication's own table only.

// letterDeliveryMode is the delivery mode of an Elternbrief.
const letterDeliveryMode = "letter"

const (
	letterCopyTableExpr = `users.parent_announcement_letter_copies AS "plc"`
	letterCopyAlias     = "plc"
)

type letterCopyRow struct {
	bun.BaseModel  `bun:"table:users.parent_announcement_letter_copies,alias:plc"`
	ID             int64     `bun:"id,pk,autoincrement"`
	TenantID       int64     `bun:"tenant_id,notnull"`
	AnnouncementID int64     `bun:"announcement_id,notnull"`
	StudentID      int64     `bun:"student_id,notnull"`
	FirstName      string    `bun:"first_name,notnull"`
	LastName       string    `bun:"last_name,notnull"`
	SchoolClass    string    `bun:"school_class,notnull"`
	Body           string    `bun:"body,notnull"`
	PublishedAt    time.Time `bun:"published_at,notnull"`
}

func (r letterCopyRow) value() communication.ParentLetterCopy {
	return communication.ParentLetterCopy{
		AnnouncementID: r.AnnouncementID, StudentID: r.StudentID, FirstName: r.FirstName, LastName: r.LastName,
		SchoolClass: r.SchoolClass, Body: r.Body, PublishedAt: r.PublishedAt,
	}
}

// ReplaceParentLetterCopies drops the copies of an earlier publication and
// writes those of this one in one statement; no copies retract the letter.
func (r *announcementRepository) ReplaceParentLetterCopies(ctx context.Context, tenantID, announcementID int64, copies []communication.ParentLetterCopy) error {
	db, ambient, err := r.store.database(ctx)
	if err != nil {
		return err
	}
	tenant := firstTenant(tenantID, ambient.TenantID)
	drop := db.NewDelete().Model((*letterCopyRow)(nil)).ModelTableExpr(letterCopyTableExpr).
		Where(`"plc".announcement_id = ?`, announcementID)
	drop = withTenant(drop, letterCopyAlias, TenantScope{TenantID: tenant})
	if _, err := drop.Exec(ctx); err != nil {
		return fmt.Errorf("delete parent letter copies: %w", err)
	}
	if len(copies) == 0 {
		return nil
	}
	rows := make([]letterCopyRow, 0, len(copies))
	for _, c := range copies {
		rows = append(rows, letterCopyRow{
			TenantID: tenant, AnnouncementID: announcementID, StudentID: c.StudentID, FirstName: c.FirstName,
			LastName: c.LastName, SchoolClass: c.SchoolClass, Body: c.Body, PublishedAt: c.PublishedAt,
		})
	}
	if _, err := db.NewInsert().Model(&rows).ModelTableExpr(letterCopyTableExpr).Returning("NULL").Exec(ctx); err != nil {
		return fmt.Errorf("insert parent letter copies: %w", err)
	}
	return nil
}

// ParentLetterCopies lists the copies of one letter by class and name.
func (r *announcementRepository) ParentLetterCopies(ctx context.Context, tenantID, announcementID int64) ([]communication.ParentLetterCopy, error) {
	db, ambient, err := r.store.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []letterCopyRow
	query := db.NewSelect().Model(&rows).ModelTableExpr(letterCopyTableExpr).
		Where(`"plc".announcement_id = ?`, announcementID).
		OrderExpr(`LOWER("plc".school_class), LOWER("plc".last_name), LOWER("plc".first_name), "plc".student_id`)
	query = withTenant(query, letterCopyAlias, TenantScope{TenantID: firstTenant(tenantID, ambient.TenantID)})
	if err := query.Scan(ctx); err != nil {
		return nil, fmt.Errorf("list parent letter copies: %w", err)
	}
	copies := make([]communication.ParentLetterCopy, 0, len(rows))
	for _, row := range rows {
		copies = append(copies, row.value())
	}
	return copies, nil
}

// attachLetterCopies puts the letters of the account's own children on each
// personalised Elternbrief of a feed page (#4813), in two statements for the
// whole page: which children the account may read for, then their copies.
// The item's text becomes the first own child's letter, so no placeholder is
// ever shown; a letter without own copies shows its text without the values.
func (r *announcementRepository) attachLetterCopies(ctx context.Context, accountID int64, items []*communication.PortalAnnouncementFeedItem) error {
	byID, ids := personalLetterItems(items)
	if len(ids) == 0 {
		return nil
	}
	permitted, err := r.PermittedLetterChildren(ctx, accountID, ids)
	if err != nil {
		return err
	}
	copies, err := r.permittedLetterCopies(ctx, ids, permitted)
	if err != nil {
		return err
	}
	for _, letter := range copies {
		byID[letter.AnnouncementID].Letters = append(byID[letter.AnnouncementID].Letters, letter)
	}
	for _, item := range byID {
		item.Body = ownLetterText(item)
	}
	return nil
}

// personalLetterItems picks the Elternbriefe of a page that name each child.
func personalLetterItems(items []*communication.PortalAnnouncementFeedItem) (map[int64]*communication.PortalAnnouncementFeedItem, []int64) {
	byID := map[int64]*communication.PortalAnnouncementFeedItem{}
	ids := make([]int64, 0)
	for _, item := range items {
		if item.DeliveryMode == letterDeliveryMode && communication.HasParentLetterPlaceholders(item.Body) {
			byID[item.ID] = item
			ids = append(ids, item.ID)
		}
	}
	return byID, ids
}

// permittedLetterCopies reads the copies of exactly the permitted pairs of
// letter and child.
func (r *announcementRepository) permittedLetterCopies(ctx context.Context, ids []int64, permitted map[int64][]int64) ([]communication.ParentLetterCopy, error) {
	allowed := map[[2]int64]bool{}
	studentIDs := make([]int64, 0)
	for announcementID, children := range permitted {
		for _, studentID := range children {
			allowed[[2]int64{announcementID, studentID}] = true
			studentIDs = append(studentIDs, studentID)
		}
	}
	if len(studentIDs) == 0 {
		return nil, nil
	}
	db, _, err := r.store.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []letterCopyRow
	if err := db.NewSelect().Model(&rows).ModelTableExpr(letterCopyTableExpr).
		Where(`"plc".announcement_id IN (?)`, bun.List(ids)).
		Where(`"plc".student_id IN (?)`, bun.List(studentIDs)).
		OrderExpr(`"plc".announcement_id, LOWER("plc".first_name), "plc".student_id`).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("list parent letter copies for account: %w", err)
	}
	copies := make([]communication.ParentLetterCopy, 0, len(rows))
	for _, row := range rows {
		if allowed[[2]int64{row.AnnouncementID, row.StudentID}] {
			copies = append(copies, row.value())
		}
	}
	return copies, nil
}

// ownLetterText is the text a feed item shows: the first own child's letter.
func ownLetterText(item *communication.PortalAnnouncementFeedItem) string {
	if len(item.Letters) > 0 {
		return item.Letters[0].Body
	}
	return communication.FillParentLetter(item.Body, communication.ParentLetterChild{})
}
