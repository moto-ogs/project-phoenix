package config

import (
	"context"
	"fmt"
	"strings"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// validateEnrollmentPrivacyNotice keeps the public enrollment form from going
// online without a privacy notice under Art. 13 DSGVO (#7176). The form shows
// the notice only when its switch is on and its text is not blank
// (buildLegalBlocks in modules/enrollment), so both must hold in their
// effective value, whether the school or its Träger set them.
//
// Only the write that switches enrollment ON is checked. Switching it off
// stays possible at any time, and the legal-text keys themselves carry no
// check: they are `beide` settings, which ADR 0086 §3 keeps out of every
// lock and check over several fields. A later change of the notice is
// therefore not blocked; the settings screen keeps warning the school while
// enrollment runs without one.
//
// No advisory lock is taken, deliberately against the Lock* rule of
// settings-system.md: the notice keys may be written by the Träger in its own
// transaction (ADR 0086 §3), so no school lock could order those writes. The
// check therefore cannot keep a concurrent removal of the notice out; such a
// race ends in the state the warning already covers (enrollment on, notice
// gone), never in an invariant the rest of the system relies on. Flushing the
// request cache only keeps this read from replaying values memoized earlier
// in the same request; it is no barrier against uncommitted writers.
func (s *settingsService) validateEnrollmentPrivacyNotice(ctx context.Context, key string, value any) error {
	enabled, ok := value.(bool)
	if !ok || !enabled {
		// A non-bool value is rejected by validateValue; off is always allowed.
		return nil
	}
	s.flushRequestCacheForLock(ctx)
	text, err := s.ResolveString(ctx, config.KeyEnrollmentLegalDSGVOText)
	if err != nil {
		return fmt.Errorf("resolve enrollment privacy notice text: %w", err)
	}
	if strings.TrimSpace(text) == "" {
		return &config.EnrollmentPrivacyNoticeError{Key: key, Missing: config.EnrollmentPrivacyNoticeTextMissing}
	}
	shown, err := s.ResolveBool(ctx, config.KeyEnrollmentLegalDSGVOEnabled)
	if err != nil {
		return fmt.Errorf("resolve enrollment privacy notice switch: %w", err)
	}
	if !shown {
		return &config.EnrollmentPrivacyNoticeError{Key: key, Missing: config.EnrollmentPrivacyNoticeSwitchOff}
	}
	return nil
}
