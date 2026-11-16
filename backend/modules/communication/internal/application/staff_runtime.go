package application

import (
	"context"
	"log/slog"
)

// Runtime identifies the school of the ambient transaction.
type Runtime interface {
	TenantID(context.Context) int64
}

// NewService wires the staff announcement service.
func NewService(cfg ServiceConfig, runtime Runtime, policy ParentDeliveryPolicy) StaffService {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := cfg.Now
	if now == nil {
		panic("staff announcements: the composition's clock is required")
	}
	return &service{
		now:            now,
		deliveryPolicy: policy,
		runtime:        runtime,
		repo:           cfg.Repo,
		settings:       cfg.Settings,
		outbox:         cfg.Outbox,
		pushOutbox:     cfg.PushOutbox,
		notifier:       cfg.Notifier,
		series:         cfg.Series,
		preferences:    cfg.Preferences,
		deliveries:     cfg.Deliveries,
		fingerprints:   cfg.Fingerprints,
		signatures:     cfg.Signatures,
		attachments:    cfg.Attachments,
		parentsURL:     cfg.ParentsURL,
		letters:        cfg.Letters,
		logger:         logger,
	}
}
