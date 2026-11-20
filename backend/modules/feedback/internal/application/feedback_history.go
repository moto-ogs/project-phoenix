package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/feedback"
	"github.com/moto-ogs/project-phoenix/modules/feedback/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/feedback/internal/ports"
)

// FeedbackHistory writes the past ratings of the demo seed (ADR 0298). It
// shares the store and the transaction with Service, but not the operation
// observer or the switch of the school: the seed fills the history of a
// school whose feedback it switched on itself.
type FeedbackHistory struct {
	store ports.Store
	tx    ports.Transaction
	today func() domain.Date
}

func NewFeedbackHistory(store ports.Store, tx ports.Transaction, today func() domain.Date) *FeedbackHistory {
	if store == nil || tx == nil || today == nil {
		panic("feedback application: all feedback history dependencies are required")
	}
	return &FeedbackHistory{store: store, tx: tx, today: today}
}

func (h *FeedbackHistory) RecordFeedbackHistory(ctx context.Context, inputs []feedback.CreateEntry) (int, error) {
	if len(inputs) == 0 {
		return 0, nil
	}
	values, err := h.pastEntries(inputs)
	if err != nil {
		return 0, err
	}
	written := 0
	err = h.tx.Run(ctx, func(txCtx context.Context) error {
		entries, _, err := h.store.CreateBatch(txCtx, values)
		written = len(entries)
		return err
	})
	if err != nil {
		return 0, err
	}
	return written, nil
}

// pastEntries validates every rating like a submitted one and requires a day
// before today.
func (h *FeedbackHistory) pastEntries(inputs []feedback.CreateEntry) ([]domain.Entry, error) {
	today := h.today()
	values := make([]domain.Entry, 0, len(inputs))
	var failures []error
	for _, input := range inputs {
		entry, err := validateEntry(input)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		value := toDomainInput(entry)
		if !value.Day.Before(today) {
			failures = append(failures, &feedback.InvalidEntryDataError{Err: errors.New("history day must be before today")})
			continue
		}
		values = append(values, value)
	}
	if len(failures) > 0 {
		return nil, &feedback.BatchOperationError{Errors: failures}
	}
	return values, nil
}
