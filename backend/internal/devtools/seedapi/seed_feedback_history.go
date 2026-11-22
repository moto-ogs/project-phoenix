package api

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// PastFeedback is one past rating of a child (#5029), as the kiosk records
// one when the child leaves or after lunch.
type PastFeedback struct {
	Value           string `json:"value"`
	Day             string `json:"day"`
	Time            string `json:"time"`
	StudentID       apiID  `json:"student_id"`
	IsMensaFeedback bool   `json:"is_mensa_feedback"`
}

// FeedbackHistoryWriter records the past ratings of one school. No regular
// API backdates a rating, so the dev tools bind it to Feedback's history
// writer directly, or, in the public demo, to the operator route only its
// server mounts (ADR 0298); nil leaves the past without feedback.
type FeedbackHistoryWriter func(ctx context.Context, schoolID int64, entries []PastFeedback) (int, error)

// seedFeedbackHistoryStep fills the Feedbackhistorie of the children
// (#5029): on some of the days a child came, it rated its day when it went
// home, and on some it rated lunch in the Mensa. The days come from the same
// plan as the presence history, so a child never rates a day it missed.
type seedFeedbackHistoryStep struct{ seeder *Seeder }

func (seedFeedbackHistoryStep) Name() string { return "Feedbackverlauf wird angelegt" }

func (s seedFeedbackHistoryStep) Run(ctx context.Context, rt *Runtime) error {
	if string(s.seeder.definition.Settings[profileSettingFeedbackEnabled].Value) != "true" {
		fmt.Println("  Feedback ist für diese Schule aus, der Feedbackverlauf wird übersprungen")
		return nil
	}
	write := feedbackHistoryWriterFor(s.seeder.options, rt)
	if write == nil {
		fmt.Println("  Ohne Datenbank bleibt der Feedbackverlauf leer")
		return nil
	}
	today, err := rt.historyToday()
	if err != nil {
		return err
	}
	from, until := feedbackHistoryRange(today)
	if !from.Before(today) {
		return nil
	}
	days, err := s.presenceDays(rt, from, today)
	if err != nil {
		return err
	}
	entries := planFeedbackHistory(days, from)
	if len(entries) == 0 {
		return nil
	}
	existing, err := pastFeedbackOf(rt, int64(entries[0].StudentID), from, until)
	if err != nil {
		return err
	}
	if existing > 0 {
		// The batch commits as a whole, so one present rating means the
		// whole history is there.
		fmt.Println("  Der Feedbackverlauf ist schon angelegt")
		return nil
	}
	written, err := write(ctx, rt.Bootstrap.SchoolID, entries)
	if err != nil {
		return fmt.Errorf("seed past feedback: %w", err)
	}
	if written != len(entries) {
		return fmt.Errorf("seed past feedback: created %d of %d entries", written, len(entries))
	}
	mensa := 0
	for _, entry := range entries {
		if entry.IsMensaFeedback {
			mensa++
		}
	}
	fmt.Printf("  %d vergangene Feedbacks, davon %d zum Mittagessen\n", len(entries), mensa)
	return nil
}

// pastFeedbackOf counts the ratings of one child between from and until in
// its Feedbackhistorie, as the child's page reads them.
func pastFeedbackOf(rt *Runtime, studentID int64, from, until calendar.Date) (int, error) {
	var history struct {
		Data []struct {
			Day string `json:"day"`
		} `json:"data"`
	}
	if err := getSeedJSON(rt, fmt.Sprintf("/api/feedback/student/%d", studentID), &history); err != nil {
		return 0, fmt.Errorf("read past feedback: %w", err)
	}
	count := 0
	for _, entry := range history.Data {
		if entry.Day >= from.String() && entry.Day <= until.String() {
			count++
		}
	}
	return count, nil
}

// feedbackHistoryWriterFor picks the bound writer, else the demo's operator
// route when the options ask for it; nil seeds the past without feedback.
func feedbackHistoryWriterFor(options SeedOptions, rt *Runtime) FeedbackHistoryWriter {
	if options.FeedbackHistory != nil {
		return options.FeedbackHistory
	}
	if options.PresenceHistoryRoute {
		return operatorFeedbackHistoryWriter(rt)
	}
	return nil
}

// operatorFeedbackHistoryWriter records the past ratings through the
// operator route the server mounts in the public demo only (ADR 0298).
func operatorFeedbackHistoryWriter(rt *Runtime) FeedbackHistoryWriter {
	return func(_ context.Context, schoolID int64, entries []PastFeedback) (int, error) {
		path := fmt.Sprintf("/operator/schools/%d/demo-feedback-history", schoolID)
		raw, err := rt.Client.PostWithAuth(rt.OperatorAuth, path, map[string]any{"entries": entries})
		if err != nil {
			return 0, err
		}
		var response struct {
			Data struct {
				Written int `json:"written"`
			} `json:"data"`
		}
		if err := parseJSON(raw, &response); err != nil {
			return 0, fmt.Errorf("read recorded feedback history: %w", err)
		}
		return response.Data.Written, nil
	}
}

func (s seedFeedbackHistoryStep) presenceDays(rt *Runtime, from, today calendar.Date) ([]PastPresenceDay, error) {
	if s.seeder.options.PresenceHistoryRoute {
		return rt.demoPresenceDays, nil
	}
	input, err := pastCareInputFrom(rt, s.seeder.definition, today, from)
	if err != nil {
		return nil, err
	}
	return planPresenceHistory(input).days, nil
}

// feedbackHistoryRange covers every past day in the current calendar month,
// matching the Feedbackhistorie's "Diesen Monat" filter, and retains the
// previous 14 days for its default "Letzte 7 Tage" filter. At most 30 days
// are seeded, safely inside the 90-day feedback retention period.
func feedbackHistoryRange(today calendar.Date) (calendar.Date, calendar.Date) {
	from := today.AddDays(-14)
	if monthStart := calendar.NewDate(today.Year(), today.Month(), 1); monthStart.Before(from) {
		from = monthStart
	}
	return from, today.AddDays(-1)
}

// planFeedbackHistory decides the ratings from a fixed hash of child and day.
// About two in five days a child rates its day at check-out; about one in
// four it rates lunch half an hour to an hour after it arrived. Most ratings
// are good, some neutral, few bad.
func planFeedbackHistory(days []PastPresenceDay, from calendar.Date) []PastFeedback {
	var entries []PastFeedback
	for _, day := range days {
		if day.Date.Before(from) {
			continue
		}
		roll := func(decision string) uint32 { return feedbackRoll(day.StudentID, day.Date, decision) }
		if roll("mensa")%100 < 25 {
			at := day.CheckIn.Add(time.Duration(30+roll("mensa-time")%31) * time.Minute)
			entries = append(entries, PastFeedbackAt(day, at, roll("mensa-value"), true))
		}
		if roll("day")%100 < 40 {
			entries = append(entries, PastFeedbackAt(day, day.CheckOut, roll("day-value"), false))
		}
	}
	return entries
}

func PastFeedbackAt(day PastPresenceDay, at time.Time, valueRoll uint32, mensa bool) PastFeedback {
	return PastFeedback{
		Value:           feedbackHistoryValue(valueRoll % 100),
		Day:             day.Date.String(),
		Time:            at.In(seedBerlinLocation()).Format("15:04:05"),
		StudentID:       apiID(day.StudentID),
		IsMensaFeedback: mensa,
	}
}

func feedbackHistoryValue(roll uint32) string {
	switch {
	case roll < 60:
		return "positive"
	case roll < 88:
		return "neutral"
	default:
		return "negative"
	}
}

func feedbackRoll(studentID int64, day calendar.Date, decision string) uint32 {
	return presenceRoll(studentID, day, "feedback-"+decision)
}
