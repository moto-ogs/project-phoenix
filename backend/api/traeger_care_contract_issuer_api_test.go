// Router-level tests for the body that concludes the care contracts of a
// school (#4811): the responsibility "Verträge" names the Träger, the
// Schulträger or the Gemeinde; the named body is contract party and sender
// of new contracts; a contract whose PDF is frozen keeps its body when the
// responsibility changes; no setting reaches the contracts of another
// Träger.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// contractIssuerFacts is what the parents read about who issued a contract:
// the name in the mail, and on the signing page the name and the addressee
// of the withdrawal notice.
type contractIssuerFacts struct {
	mailName   string
	pageName   string
	withdrawal string
	frozen     *string
}

func contractIssuerFactsOf(t *testing.T, f careContractFixture, contractID int64, link string) contractIssuerFacts {
	t.Helper()
	ctx := context.Background()
	var payload string
	require.NoError(t, f.db.NewRaw(`SELECT payload::text FROM platform.email_outbox WHERE organization_id = ? AND kind = 'care_contract'
		AND related_entity_id = ? ORDER BY id DESC LIMIT 1`, f.office.organization, contractID).Scan(ctx, &payload))
	var mail struct {
		TraegerName string `json:"traeger_name"`
	}
	require.NoError(t, json.Unmarshal([]byte(payload), &mail))
	rec := publicSigning(t, f.traeger, http.MethodGet, link, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	view := decodeSchoolPortalData[struct {
		TraegerName      string   `json:"traeger_name"`
		WithdrawalNotice []string `json:"withdrawal_notice"`
	}](t, rec.Body.Bytes())
	require.Greater(t, len(view.WithdrawalNotice), 1)
	facts := contractIssuerFacts{mailName: mail.TraegerName, pageName: view.TraegerName, withdrawal: view.WithdrawalNotice[1]}
	require.NoError(t, f.db.NewRaw(`SELECT issuer->>'sender_text' FROM care_contract.contract_documents
		WHERE organization_id = ? AND contract_id = ?`, f.office.organization, contractID).Scan(ctx, &facts.frozen))
	return facts
}

func TestCareContractNamesTheBodyResponsibleAtItsSchool(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Vertrag Zuständigkeit")
	testpkg.OwnTraegerMasterData(t, f.db, f.office.organization)
	// The conditions name no contract party: the responsible body is it.
	conditions := map[string]any{}
	for key, value := range careContractTemplate {
		conditions[key] = value
	}
	conditions["contract_partner"] = ""
	require.Equal(t, http.StatusOK, putTemplate(t, f.traeger, f.office.token, f.school, f.offering, conditions).Code)
	second := careContractApplication(t, f.db, f.school, f.phase, f.offering, "Mats", "mats.muster@example.org")
	third := careContractApplication(t, f.db, f.school, f.phase, f.offering, "Nele", "nele.muster@example.org")

	// The Gemeinde concludes the contracts of this school; without its
	// master data the Träger stays the party.
	setTraegerResponsibility(t, f.traeger, f.office.token, "responsibility.contracts", "gemeinde")
	firstID, firstLink := sentCareContract(t, f, f.child)
	byTraeger := contractIssuerFactsOf(t, f, firstID, firstLink)
	assert.Equal(t, "Ganztag im Quartier e.V.", byTraeger.mailName, "a Gemeinde without master data concludes nothing")
	assert.Nil(t, byTraeger.frozen)

	// With its master data the Gemeinde is party and sender of the next
	// contract: name, address and contact in the mail, on the signing page
	// and frozen with the PDF.
	saveSchoolParty(t, f.traeger, f.office.token, f.school, "gemeinde", gemeindeHardt)
	secondID, secondLink := sentCareContract(t, f, second)
	byGemeinde := contractIssuerFactsOf(t, f, secondID, secondLink)
	assert.Equal(t, "Gemeinde Hardt", byGemeinde.mailName)
	assert.Equal(t, "Gemeinde Hardt", byGemeinde.pageName)
	assert.Contains(t, byGemeinde.withdrawal, "Gemeinde Hardt, Rathausplatz 1, 41749 Viersen")
	assert.Contains(t, byGemeinde.withdrawal, "Telefon: 02162 1010, E-Mail: kasse@hardt.example")
	assert.NotContains(t, byGemeinde.withdrawal, "Ganztag im Quartier")
	require.NotNil(t, byGemeinde.frozen)
	assert.Equal(t, "Gemeinde Hardt\nRathausplatz 1\n41749 Viersen", *byGemeinde.frozen)
	assert.Equal(t, byTraeger, contractIssuerFactsOf(t, f, firstID, firstLink), "the contract sent before keeps the Träger")

	// The Träger takes the contracts back: the issued contract keeps the
	// Gemeinde, a new one names the Träger again.
	setTraegerResponsibility(t, f.traeger, f.office.token, "responsibility.contracts", "traeger")
	assert.Equal(t, byGemeinde, contractIssuerFactsOf(t, f, secondID, secondLink), "a change of the responsibility changes no issued contract")
	thirdID, thirdLink := sentCareContract(t, f, third)
	again := contractIssuerFactsOf(t, f, thirdID, thirdLink)
	assert.Equal(t, "Ganztag im Quartier e.V.", again.mailName)
	assert.Contains(t, again.withdrawal, "Ganztag im Quartier e.V., Am Markt 4, 49143 Bissendorf")
	assert.Nil(t, again.frozen)
}

// TestContractConditionsNameTheBodyOfEachSchool pins that the withdrawal
// text the school copies into its enrollment form takes the address and
// the contact of the body that concludes the contracts of that school, and
// that the school's own value wins over the Träger's. The conditions name
// the contract party themselves: that text binds the accepted application.
func TestContractConditionsNameTheBodyOfEachSchool(t *testing.T) {
	t.Parallel()
	f := newCareContractFixture(t, "Träger Bedingungen Zuständigkeit")
	testpkg.OwnTraegerMasterData(t, f.db, f.office.organization)
	require.Equal(t, http.StatusOK, putTemplate(t, f.traeger, f.office.token, f.school, f.offering, careContractTemplate).Code)
	withdrawalText := func() string {
		t.Helper()
		rec := traegerJSON(t, f.traeger, f.office.token, http.MethodGet, "/traeger/contract-templates", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		for _, offering := range decodeSchoolPortalData[[]struct {
			SchoolID       wireID `json:"school_id"`
			OfferingID     wireID `json:"offering_id"`
			WithdrawalText string `json:"withdrawal_text"`
		}](t, rec.Body.Bytes()) {
			if int64(offering.SchoolID) == f.school && int64(offering.OfferingID) == f.offering {
				return offering.WithdrawalText
			}
		}
		require.Fail(t, "the offering has no conditions")
		return ""
	}
	assert.True(t, strings.Contains(withdrawalText(), "(Träger Vertrag, Ganztag im Quartier e.V., Am Markt 4, 49143 Bissendorf)"), "the Träger's address stands behind the party")

	// The school names its Schulträger itself; the Träger value stays.
	saveSchoolParty(t, f.traeger, f.office.token, f.school, "schultraeger", schoolPartyBody{Name: "Stadt Viersen", Street: "Bahnhofstraße 23", PostalCode: "41747", City: "Viersen",
		ContactPhone: "02162 1010"})
	setSchoolResponsibility(t, f.db, f.school, "responsibility.contracts", "schultraeger")
	text := withdrawalText()
	assert.True(t, strings.Contains(text, "(Träger Vertrag, Stadt Viersen, Bahnhofstraße 23, 41747 Viersen, Telefon: 02162 1010)"),
		"the conditions name the party, the Schulträger gives address and contact")
	assert.False(t, strings.Contains(text, "Am Markt 4"), "the Träger's address is gone")
}
