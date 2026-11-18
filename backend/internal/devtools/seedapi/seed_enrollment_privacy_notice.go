package api

import (
	"encoding/json"
	"fmt"
)

// seedEnrollmentPrivacyNotice is the demo school's privacy notice on the
// public enrollment form. Without one the form cannot be switched on (#7176).
const seedEnrollmentPrivacyNotice = "## Datenschutzinformation zur Anmeldung\n\n" +
	"Die Schule verarbeitet Ihre Angaben, um die Betreuung Ihres Kindes zu planen (Art. 6 Abs. 1 lit. e DSGVO).\n\n" +
	"- **Verantwortlich:** Demo-Schule, Schulweg 1, 12345 Musterstadt\n" +
	"- **Datenschutzbeauftragte Person:** datenschutz@example.test\n" +
	"- **Speicherdauer:** bis zum Ende der Betreuung, abgelehnte Anmeldungen nach 90 Tagen\n\n" +
	"Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Beschwerde bei der Aufsichtsbehörde."

var seedEnrollmentPrivacyNoticeJSON = func() json.RawMessage {
	raw, err := json.Marshal(seedEnrollmentPrivacyNotice)
	if err != nil {
		panic(err)
	}
	return raw
}()

// enrollmentPrivacyNoticeProfileSettings are the profile settings that put
// the privacy notice in place; profiles with online enrollment carry them.
func enrollmentPrivacyNoticeProfileSettings() map[string]SeedSetting {
	return map[string]SeedSetting{
		profileSettingEnrollmentDSGVOOn:   {Value: json.RawMessage(`true`), ManagedBy: SettingManagedByTenant},
		profileSettingEnrollmentDSGVOText: {Value: seedEnrollmentPrivacyNoticeJSON, ManagedBy: SettingManagedByTenant},
	}
}

// seedEnrollmentPrivacyNoticeSettings writes the notice text, then its switch.
func seedEnrollmentPrivacyNoticeSettings(rt *Runtime, auth AuthRef) error {
	for _, setting := range []struct {
		key   string
		value any
	}{
		{profileSettingEnrollmentDSGVOText, seedEnrollmentPrivacyNotice},
		{profileSettingEnrollmentDSGVOOn, true},
	} {
		if _, err := rt.Client.PutWithAuth(auth, "/api/settings/values/"+setting.key, map[string]any{"value": setting.value}); err != nil {
			return fmt.Errorf("set setting %s: %w", setting.key, err)
		}
	}
	return nil
}

// seedSettings switches on the parent features of the demo school. The
// privacy notice comes first: enrollment.enabled is refused without it.
func (s parentEnrollmentSeedStep) seedSettings(rt *Runtime, auth AuthRef) (map[string]any, error) {
	// The privacy notice goes first: enrollment.enabled is refused without it.
	if err := seedEnrollmentPrivacyNoticeSettings(rt, auth); err != nil {
		return nil, err
	}
	settings := map[string]any{
		"enrollment.enabled":                            true,
		"operations.parent_sick_note_enabled":           true,
		"operations.parent_notes_enabled":               true,
		"operations.parent_pickup_change_enabled":       true,
		"operations.parent_guardian_management_enabled": true,
		"guardians.parent_invite_mode":                  "direct",
		"guardians.parent_can_remove":                   true,
		"enrollment.require_captcha":                    false,
		"enrollment.offering_changes_enabled":           true,
		"enrollment.parent_course_requests_enabled":     true,
	}
	for key, value := range settings {
		if _, err := rt.Client.PutWithAuth(auth, "/api/settings/values/"+key, map[string]any{"value": value}); err != nil {
			return nil, fmt.Errorf("set setting %s: %w", key, err)
		}
	}
	return settings, nil
}
