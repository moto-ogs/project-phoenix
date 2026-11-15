package parentbillinghttp

import (
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The lists of the children of the monthly care name children and their
// families (#4718). Each export reads through the list's capability, which
// records the read in the trail of every contract, notice or run it shows;
// a failed read rolls back.

var (
	noticeKindLabels = map[string]string{capability.NoticeKindInitial: "Bescheid", capability.NoticeKindChange: "Änderungsbescheid"}
	costShareKinds   = map[string]string{
		capability.CostShareEducationParticipation: "Bildung und Teilhabe", capability.CostShareYouthOffice: "Jugendamt",
		capability.CostShareOtherSubsidy: "Sonstiger Zuschuss",
	}
	// A share without a scope covers the care, as every share did before
	// the Mensa.
	costShareScopes = map[string]string{
		"": "Betreuung", capability.CostShareScopeCare: "Betreuung", capability.CostShareScopeMeal: "Mensa", capability.CostShareScopeBoth: "Betreuung und Mensa",
	}
	costShareStates = map[string]string{
		capability.CostShareUpcoming: "Gilt später", capability.CostShareActive: "Gilt jetzt",
		capability.CostShareExpiring: "Endet bald", capability.CostShareExpired: "Abgelaufen",
	}
	evidenceKinds = map[string]string{capability.EvidenceIncomeLevel: "Einkommensstufe", capability.EvidenceSingleParent: "Alleinerziehend"}
	mailStates    = map[string]string{
		capability.LetterMailNotSent: "Nicht gesendet", capability.LetterMailQueued: "Wird gesendet", capability.LetterMailSent: "Gesendet",
		capability.LetterMailFailed: "Nicht angekommen", capability.LetterMailUnknown: "Ergebnis unbekannt",
	}
)

// exportNotices answers GET /traeger/care-notice-runs/{id}/export: the
// notices of a run, one row per child.
func (rs *CareNoticeResource) exportNotices(w http.ResponseWriter, r *http.Request) {
	reviewer, runID, ok := runKey(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	detail, err := rs.notices.CareNoticeRun(r.Context(), reviewer, runID)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderNoticeError(w, r, err)
		return
	}
	year := strconv.Itoa(detail.Year)
	table := newListTable("Jahresbescheide "+year, "jahresbescheide-"+year, true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("school", "Schule"),
		column("kind", "Art"), column("number", "Bescheid-Nr."), column("period", "Zeitraum"),
		column("installments", "Raten"), column("total", "Gesamtbetrag"), column("delta", "Zu-/Abgang"))
	table.Subtitle = periodText(detail.PeriodFrom, detail.PeriodUntil)
	for _, notice := range detail.Notices {
		number, delta := notice.Number, "–"
		if number == "" {
			number = "–"
		}
		if notice.Kind == capability.NoticeKindChange {
			delta = euroText(notice.DeltaCents)
		}
		table.Rows = append(table.Rows, []string{
			notice.ChildLastName, notice.ChildFirstName, notice.SchoolName, noticeKindLabels[notice.Kind], number,
			periodText(notice.PeriodFrom, notice.PeriodUntil), strconv.Itoa(len(notice.Installments)),
			euroText(notice.TotalCents), delta,
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// exportNoticeLetters answers GET /traeger/care-notice-runs/{id}/letters/export:
// the mail of every notice of a released run to its family.
func (rs *CareNoticeResource) exportNoticeLetters(w http.ResponseWriter, r *http.Request) {
	reviewer, runID, ok := runKey(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	letters, err := rs.letters.CareNoticeLetters(r.Context(), reviewer, runID)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderNoticeError(w, r, err)
		return
	}
	table := newListTable("Versand der Jahresbescheide", "bescheid-versand-"+strconv.FormatInt(runID, 10), true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("school", "Schule"),
		column("kind", "Art"), column("number", "Bescheid-Nr."), column("recipient", "Empfänger"), column("email", "E-Mail"),
		column("total", "Gesamtbetrag"), column("letter", "Original"), column("status", "An die Familie"), column("sent", "Gesendet am"))
	for _, notice := range letters.Notices {
		letter, status := "Noch nicht gespeichert", mailStates[notice.Status]
		if notice.HasLetter {
			letter = "Gespeichert"
		}
		if notice.Status == capability.LetterMailNotSent && notice.RecipientEmail == "" {
			status = "Ohne E-Mail"
		}
		table.Rows = append(table.Rows, []string{
			notice.ChildLastName, notice.ChildFirstName, notice.SchoolName, noticeKindLabels[notice.Kind], notice.Number,
			personName(notice.RecipientFirstName, notice.RecipientLastName), notice.RecipientEmail,
			euroText(notice.TotalCents), letter, status, instantText(notice.SentAt),
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// exportCostShares answers GET /traeger/care-cost-shares/export: one row per
// share of a contract in force, a contract without a share with empty
// share columns.
func (rs *CareReductionResource) exportCostShares(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	set, err := rs.reductions.CareCostShares(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderCostShareError(w, r, err)
		return
	}
	table := newListTable("Anteile der Kostenträger", "kostentraeger-anteile", true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("school", "Schule"),
		column("bearer", "Kostenträger"), column("kind", "Art"), column("scope", "Gilt für"), column("share", "Anteil"),
		column("valid", "Gültig"), column("reference", "Aktenzeichen"), column("checked", "Geprüft am"), column("status", "Stand"))
	for _, contract := range set.Contracts {
		child := []string{contract.ChildLastName, contract.ChildFirstName, contract.SchoolName}
		if len(contract.Shares) == 0 {
			table.Rows = append(table.Rows, append(child, "", "", "", "", "", "", "", "Kein Anteil"))
		}
		for _, share := range contract.Shares {
			table.Rows = append(table.Rows, append(append([]string{}, child...),
				share.CostBearerName, costShareKinds[share.Kind], costShareScopes[share.Scope], shareText(share),
				periodText(share.ValidFrom, share.ValidUntil), share.Reference, dateText(share.CheckedOn), costShareStates[share.Status]))
		}
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// shareText is „50 %“ or „12,00 € im Monat“.
func shareText(share capability.CareCostShare) string {
	switch {
	case share.ShareBasisPoints != nil:
		points := *share.ShareBasisPoints
		text := strconv.Itoa(points / 100)
		if points%100 != 0 {
			text += "," + strconv.Itoa(points%100/10)
			if points%10 != 0 {
				text += strconv.Itoa(points % 10)
			}
		}
		return text + " %"
	case share.ShareCents != nil:
		return euroText(*share.ShareCents) + " im Monat"
	default:
		return ""
	}
}

// exportEvidences answers GET /traeger/care-evidences/export: one row per
// evidence of a contract in force, a contract without one with empty
// evidence columns.
func (rs *CareReductionResource) exportEvidences(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	set, err := rs.reductions.CareEvidences(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderCareReductionError(w, r, err, common.CodeParentBillingCareEvidenceInvalid)
		return
	}
	levels := make(map[int64]string, len(set.Levels))
	for _, level := range set.Levels {
		levels[level.ID] = level.Name
	}
	table := newListTable("Nachweise für Ermäßigungen", "nachweise-ermaessigung", true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("school", "Schule"),
		column("kind", "Nachweis"), column("level", "Einkommensstufe"), column("valid", "Gültig"),
		column("evidence", "Beleg"), column("checked", "Geprüft am"))
	for _, contract := range set.Contracts {
		child := []string{contract.ChildLastName, contract.ChildFirstName, contract.SchoolName}
		if len(contract.Evidences) == 0 {
			table.Rows = append(table.Rows, append(child, "Kein Nachweis", "", "", "", ""))
		}
		for _, evidence := range contract.Evidences {
			level, valid := "", "ab "+dateText(evidence.ValidFrom)
			if evidence.RuleID != nil {
				level = levels[*evidence.RuleID]
			}
			if evidence.ValidUntil != nil {
				valid = periodText(evidence.ValidFrom, *evidence.ValidUntil)
			}
			table.Rows = append(table.Rows, append(append([]string{}, child...),
				evidenceKinds[evidence.Kind], level, valid, evidence.Evidence, dateText(evidence.CheckedOn)))
		}
	}
	common.WriteList(w, r, rs.lists, format, table)
}
