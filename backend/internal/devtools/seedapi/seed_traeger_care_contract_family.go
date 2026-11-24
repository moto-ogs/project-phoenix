package api

import (
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedContractFamilies is what the seed reads of the families of the
// contracts without a mail address (#7161).
type seedContractFamilies struct {
	Data struct {
		Version   string `json:"version"`
		Contracts []struct {
			ContractID       ident.ID `json:"contract_id"`
			FamilyContractID ident.ID `json:"family_contract_id"`
			ChildLastName    string   `json:"child_last_name"`
		} `json:"contracts"`
	} `json:"data"`
}

// seedContractFamily joins the imported siblings of one last name, whose
// contracts have no mail address, to one family like the office (#7161,
// ADR 0319): it reads the families and joins the contracts under the first
// of them on the version it read. The Yilmaz siblings stay apart, so the
// demo shows both. A repeated seed finds them joined and changes nothing.
func seedContractFamily(client *Client, auth AuthRef, lastName string) (int, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/contract-families/")
	if err != nil {
		return 0, fmt.Errorf("read the families of the contracts without a mail address: %w", err)
	}
	var families seedContractFamilies
	if err := json.Unmarshal(raw, &families); err != nil {
		return 0, fmt.Errorf("read the families of the contracts without a mail address: %w", err)
	}
	var siblings []string
	var lead ident.ID
	joined := true
	for _, contract := range families.Data.Contracts {
		if contract.ChildLastName != lastName {
			continue
		}
		if len(siblings) == 0 {
			lead = contract.ContractID
		}
		siblings = append(siblings, fmt.Sprint(int64(contract.ContractID)))
		joined = joined && contract.FamilyContractID == lead
	}
	if len(siblings) < 2 || joined {
		return 0, nil
	}
	if _, err := client.PostWithAuth(auth, "/traeger/contract-families/", map[string]any{
		"contract_ids": siblings, "family_contract_id": siblings[0], "expected_version": families.Data.Version,
	}); err != nil {
		return 0, fmt.Errorf("join the contracts of the %s siblings: %w", lastName, err)
	}
	return len(siblings), nil
}
