package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// staffNoticePublishPushDays is how far ahead a Hinweis der Leitung may start
// and still ring a phone (#7143), the relevance window of the notification
// feed (#7127): a later one reaches the feed only.
const staffNoticePublishPushDays = 14

// publishes reports whether saving the notice publishes it to its audience:
// a new active notice, or one switched on again. An edit of a notice that
// was already on tells nobody (#7143).
func publishes(wasActive bool, notice *scheduleModels.StaffNotice) bool {
	return notice.Active && !wasActive
}

// acknowledgeAuthorAndPublish stamps the author's own acknowledgement where
// the notice asks for one and tells the audience when saving published it.
// Both run in the caller's unit: the routes open the request's tenant
// transaction, so the feed entry commits or rolls back with the Hinweis.
func (s *staffNoticeService) acknowledgeAuthorAndPublish(ctx context.Context, notice *scheduleModels.StaffNotice, wasActive bool, actorAccountID int64) error {
	if notice.RequiresAcknowledgement {
		if err := s.repo.Acknowledge(ctx, notice.ID, notice.CreatedBy); err != nil {
			return fmt.Errorf("staffnotice: acknowledge author: %w", err)
		}
	}
	if !publishes(wasActive, notice) {
		return nil
	}
	return s.noticeAudienceOfPublication(ctx, notice, actorAccountID)
}

// noticeAudienceOfPublication tells the audience of a published Hinweis der
// Leitung (#7143) in the transaction that saved it. The audience are the
// readers of the Tagesinformationen in the OGS portal, without the person who
// published it, whom the port leaves out. A notice only for the Lehrkräfte of moto schule reaches
// nobody here: the feed of moto schule follows with #7139. A notice that has
// already ended tells nobody.
func (s *staffNoticeService) noticeAudienceOfPublication(ctx context.Context, notice *scheduleModels.StaffNotice, actorAccountID int64) error {
	if s.publications == nil || notice.Audience == scheduleModels.StaffNoticeAudienceLehrkraft {
		return nil
	}
	today := s.currentDate()
	if notice.ValidUntil != nil && notice.ValidUntil.Before(today) {
		return nil
	}
	publication := ports.StaffNoticePublication{
		NoticeID: notice.ID, Title: notice.Title, ValidFrom: notice.ValidFrom,
		ActorAccountID: actorAccountID, Push: today.DaysUntil(notice.ValidFrom) <= staffNoticePublishPushDays,
	}
	if notice.ValidUntil != nil {
		publication.ValidUntil = *notice.ValidUntil
	}
	if err := s.publications.NotifyStaffNoticePublished(ctx, publication); err != nil {
		return fmt.Errorf("staffnotice: notify audience: %w", err)
	}
	return nil
}

// StaffNoticeFor gives a reader the notice the feed entry links to (#7143).
// Unlike the day list it shows a notice that starts later or has ended: the
// entry names it, so the page must find it. A notice switched off, or one
// for the other portal, does not exist for the reader.
func (s *staffNoticeService) StaffNoticeFor(ctx context.Context, accountID, id int64, reader string) (timetable.StaffNoticeView, error) {
	notice, err := s.find(ctx, id)
	if err != nil {
		return timetable.StaffNoticeView{}, err
	}
	if !scheduleModels.ValidStaffNoticeReader(reader) || !notice.Active || !notice.AppliesTo(reader) {
		return timetable.StaffNoticeView{}, timetable.ErrStaffNoticeNotFound
	}
	views, err := s.decorate(ctx, accountID, []*scheduleModels.StaffNotice{notice}, false)
	if err != nil {
		return timetable.StaffNoticeView{}, err
	}
	return views[0], nil
}
