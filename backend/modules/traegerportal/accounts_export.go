package traegerportal

import (
	"net/http"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The lists of the page „Mitglieder und Rollen“ as PDF, Excel or CSV
// (#4718): the people of the Träger-Büro with the open invitations, and the
// history of its changes. Both name addresses, so both files carry the
// personal data note.

// traegerRoleLabels name the Träger roles as the page does.
var traegerRoleLabels = map[string]string{
	identityaccess.TraegerRoleLeadership: "Leitung", identityaccess.TraegerRoleAdministration: "Verwaltung",
	identityaccess.TraegerRoleDocuments: "Dokumente", identityaccess.TraegerRoleSchoolAccess: "Schulzugang",
	identityaccess.TraegerRoleBilling: "Abrechnung", identityaccess.TraegerRolePersonnel: "Personal",
	identityaccess.TraegerRoleReadOnly: "Nur lesen",
}

// traegerAccountActionLabels name a change of the history as the page does.
var traegerAccountActionLabels = map[string]string{
	identityaccess.TraegerAccountInvitationCreated:  "Eingeladen",
	identityaccess.TraegerAccountInvitationRevoked:  "Einladung zurückgenommen",
	identityaccess.TraegerAccountInvitationAccepted: "Einladung angenommen",
	identityaccess.TraegerAccountRolesChanged:       "Rollen geändert",
	identityaccess.TraegerAccountMemberRemoved:      "Entfernt",
	identityaccess.TraegerAccountNameChanged:        "Name geändert",
}

// roleNames is „Leitung, Verwaltung“, or none for no role.
func roleNames(roles []string, none string) string {
	names := make([]string, 0, len(roles))
	for _, role := range roles {
		if label, ok := traegerRoleLabels[role]; ok {
			names = append(names, label)
		} else {
			names = append(names, role)
		}
	}
	if len(names) == 0 {
		return none
	}
	return strings.Join(names, ", ")
}

// berlinInstant is „04.01.2027, 08:15“ in Berlin time.
func berlinInstant(at time.Time) string {
	return at.In(calendar.Berlin).Format("02.01.2006, 15:04")
}

// exportAccounts answers GET /traeger/accounts/export: the people of the
// Träger-Büro, then the open invitations. It reads what the list reads, so
// the export is written to the ledger like the list.
func (rs *Resource) exportAccounts(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	actor, ok := rs.actor(w, r)
	if !ok {
		return
	}
	buero, err := rs.accounts.ListTraegerBuero(r.Context(), actor)
	if err != nil {
		common.RenderError(w, r, renderAccountError(err))
		return
	}
	rows := make([][]string, 0, len(buero.Members)+len(buero.Invitations))
	for _, member := range buero.Members {
		rows = append(rows, []string{"Mitglied", member.Name, member.Email, roleNames(member.Roles, ""), ""})
	}
	for _, invitation := range buero.Invitations {
		rows = append(rows, []string{"Einladung", "", invitation.Email, roleNames(invitation.Roles, ""), berlinInstant(invitation.ExpiresAt)})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Mitglieder und Rollen",
		Columns: []common.ListColumn{
			{ID: "kind", Label: "Art"}, {ID: "name", Label: "Name"}, {ID: "email", Label: "E-Mail"},
			{ID: "roles", Label: "Rolle"}, {ID: "expires", Label: "Link gilt bis"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "mitglieder",
	})
}

// exportHistory answers GET /traeger/accounts/history/export: every change
// of the Träger-Büro, newest first, up to
// identityaccess.TraegerAccountHistoryExportLimit entries. Like the list it
// is not written to the ledger: the history is the ledger itself.
func (rs *Resource) exportHistory(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	actor, ok := rs.actor(w, r)
	if !ok {
		return
	}
	history, err := rs.accounts.ListTraegerAccountHistory(r.Context(), actor, identityaccess.TraegerAccountHistoryQuery{All: true})
	if err != nil {
		common.RenderError(w, r, renderAccountError(err))
		return
	}
	rows := make([][]string, 0, len(history.Entries))
	for _, entry := range history.Entries {
		actorEmail := entry.ActorEmail
		if actorEmail == "" {
			actorEmail = "Gelöschtes Konto"
		}
		rows = append(rows, []string{
			berlinInstant(entry.OccurredAt), traegerAccountActionLabels[entry.Action], historyDetail(entry), entry.TargetEmail, actorEmail,
		})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Verlauf des Träger-Büros",
		Columns: []common.ListColumn{
			{ID: "occurred", Label: "Zeitpunkt"}, {ID: "action", Label: "Was"}, {ID: "detail", Label: "Angaben"},
			{ID: "target", Label: "Betrifft"}, {ID: "actor", Label: "Von"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "verlauf-traeger-buero",
	})
}

// historyDetail names the roles or the name of a change, as the page does.
func historyDetail(entry identityaccess.TraegerAccountHistoryEntry) string {
	switch entry.Action {
	case identityaccess.TraegerAccountNameChanged:
		name := entry.TargetName
		if name == "" {
			name = "–"
		}
		return "Neuer Name: " + name + "."
	case identityaccess.TraegerAccountRolesChanged:
		return "Vorher: " + roleNames(entry.RolesBefore, "keine") + ". Jetzt: " + roleNames(entry.RolesAfter, "keine") + "."
	case identityaccess.TraegerAccountMemberRemoved:
		return "Bisher: " + roleNames(entry.RolesBefore, "keine") + "."
	case identityaccess.TraegerAccountInvitationRevoked:
		return "Rolle der Einladung: " + roleNames(entry.RolesBefore, "keine") + "."
	default:
		return "Rolle: " + roleNames(entry.RolesAfter, "keine") + "."
	}
}
