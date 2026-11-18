package enrollment

import "strings"

// Rules of the legal blocks decided in #2787; docs/reference/rechtstexte-der-anmeldung.md
// explains them for each block kind.

const (
	// PrivacyNoticeLabel introduces the Datenschutzinformation. The parent
	// ticks nothing: the information is provided, and the request's legal
	// snapshot proves which wording the form showed (Art. 12, 13 DSGVO;
	// DSK-Beschluss vom 05.09.2018).
	PrivacyNoticeLabel = "Hier findest du die Datenschutzinformation der Schule."
	// legacyPrivacyNoticeLabel is the checkbox sentence the standard block
	// carried until #2787; stored templates still hold it.
	legacyPrivacyNoticeLabel = "Ich habe die Datenschutzinformation der Schule zur Kenntnis genommen."

	// GuardianAgreementLabel is what a parent also declares by ticking a
	// consent block with GuardianAgreement.
	GuardianAgreementLabel = "Ich handle dabei im Einvernehmen mit allen anderen sorgeberechtigten Personen meines Kindes."
)

// privacyNoticeLabel replaces the old checkbox sentence of a privacy notice
// and keeps every wording a school wrote itself.
func privacyNoticeLabel(label string) string {
	if strings.TrimSpace(label) == legacyPrivacyNoticeLabel {
		return PrivacyNoticeLabel
	}
	return label
}

// normalizeDecidedRules applies #2787 to a template block on save: a privacy
// notice has no checkbox, and only a consent asks for the custodians'
// agreement.
func (b *FormLegalBlock) normalizeDecidedRules() {
	if b.Kind == LegalBlockKindPrivacyNotice {
		b.Required = false
		b.Label = privacyNoticeLabel(b.Label)
	}
	if b.Kind != LegalBlockKindConsent {
		b.GuardianAgreement = false
	}
}

// PublicLegalBlock applies the same rules to a block a form shows, so
// template versions saved before #2787 render and validate like new ones.
func PublicLegalBlock(block LegalBlock) LegalBlock {
	if block.Kind == LegalBlockKindPrivacyNotice {
		block.Required = false
		block.Label = privacyNoticeLabel(block.Label)
	}
	if block.Kind != LegalBlockKindConsent {
		block.GuardianAgreement = false
	}
	return block
}

// healthConsentSortOrder places the health consent after the photo
// consent and before the e-mail notice and most own blocks.
const healthConsentSortOrder = 35

// HealthConsentBlock is the consent moto adds to a form that asks for
// health information. Health data are a special category (Art. 9 Abs. 1
// DSGVO); neither the care contract nor the privacy notice is a basis for
// them, so the parent consents explicitly and voluntarily (Art. 9 Abs. 2
// lit. a, Art. 7 Abs. 4 DSGVO): without the tick the enrollment still goes
// through, only the health answers must stay empty.
func HealthConsentBlock() LegalBlock {
	return LegalBlock{
		Key:   ConsentKeyHealthData,
		Kind:  LegalBlockKindConsent,
		Title: "Gesundheitsangaben",
		Label: "Die Schule darf die Gesundheitsangaben meines Kindes speichern, damit die Betreuungskräfte es sicher betreuen. " +
			"Die Einwilligung ist freiwillig. Ich kann sie jederzeit widerrufen.",
		Text: "Gesundheitsangaben sind zum Beispiel Allergien, Unverträglichkeiten oder Erkrankungen, die bei der Betreuung wichtig sind.\n\n" +
			"Du musst sie nicht angeben. Ohne Einwilligung lässt du die Felder für Gesundheitsangaben leer. Die Anmeldung geht trotzdem.\n\n" +
			"Wenn du die Einwilligung widerrufst, löscht die Schule die Gesundheitsangaben.\n\n" +
			"Soll dein Kind in der Schule Medikamente bekommen, braucht die Schule dafür eine eigene schriftliche Vereinbarung mit dir.",
		SortOrder: healthConsentSortOrder,
		Source:    LegalBlockSourceStandard,
	}
}

// AsksForHealthInformation reports whether the form has a field that
// writes the child's health information.
func (s *FormSchema) AsksForHealthInformation() bool {
	if s == nil {
		return false
	}
	for i := range s.Fields {
		if s.Fields[i].Target == TargetStudentHealthInfo {
			return true
		}
	}
	return false
}
