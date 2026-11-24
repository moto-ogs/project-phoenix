package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerCareContractSignaturesStep signs the demo care contracts
// (#4679, ADR 0155) the way families and the Träger-Büro do: a parent with
// an account signs a contract sent to them in the parents portal, and the
// Träger-Büro records one draft the parents signed on paper. The contract
// list then shows signed, sent and draft contracts side by side. Both steps
// are idempotent: a signed contract is no longer sent, a paper contract no
// longer a draft.
type seedTraegerCareContractSignaturesStep struct{}

func (seedTraegerCareContractSignaturesStep) Name() string {
	return "Signing the Träger care contracts"
}

// seedPaperContractPDF stands in for the scan of a signed paper contract.
var seedPaperContractPDF = seedTraegerDocumentPDF([]string{
	"Betreuungsvertrag", "Beispiel aus der moto-Demo",
	"Unterschrift auf Papier im Träger-Büro erfasst.",
})

func (seedTraegerCareContractSignaturesStep) Run(ctx context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger care contract signature seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	paper, err := seedPaperContracts(rt.Client, auth, rt.Bootstrap.SchoolID, 1)
	if err != nil {
		return err
	}
	for _, schoolID := range rt.demoNeighbourIDs {
		count, err := seedPaperContracts(rt.Client, auth, schoolID, 2)
		if err != nil {
			return err
		}
		paper += count
	}
	if err := seedSendContractsToParents(rt, auth); err != nil {
		return err
	}
	signed, err := seedParentContractSignatures(ctx, rt)
	if err != nil {
		return err
	}
	fmt.Printf("  Träger care contract signatures: %d on paper, %d in the parents portal\n", paper, signed)
	return nil
}

// seedPaperContracts records signatures on the school's drafts until it
// has enough active examples. Both reads are scoped to that school (#6621).
func seedPaperContracts(client *Client, auth AuthRef, school int64, minimum int) (int, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/?status=aktiv&school_id=%d", school))
	if err != nil {
		return 0, fmt.Errorf("read the active contracts: %w", err)
	}
	// The counts of the list are the Träger's; the contracts are the school's.
	var active struct {
		Data struct {
			Contracts []json.RawMessage `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &active); err != nil {
		return 0, fmt.Errorf("read the active contracts: %w", err)
	}
	missing := minimum - len(active.Data.Contracts)
	if missing <= 0 {
		return 0, nil
	}
	raw, err = client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/?status=entwurf&school_id=%d", school))
	if err != nil {
		return 0, fmt.Errorf("read the drafts: %w", err)
	}
	var drafts struct {
		Data struct {
			Contracts []struct {
				ID        ident.ID `json:"id"`
				PartyName string   `json:"party_name"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &drafts); err != nil {
		return 0, fmt.Errorf("read the drafts: %w", err)
	}
	count := min(missing, len(drafts.Data.Contracts))
	for _, draft := range drafts.Data.Contracts[len(drafts.Data.Contracts)-count:] {
		if err := seedPaperContractSignature(client, auth, int64(draft.ID), draft.PartyName, calendar.TodayDate()); err != nil {
			return 0, err
		}
	}
	return count, nil
}

// seedPaperContractSignature records the paper signature of contract id,
// signed on signedOn. The server concludes the contract on its own clock
// whatever day the paper names, and refuses a signing day after its today.
func seedPaperContractSignature(client *Client, auth AuthRef, id int64, signer string, signedOn calendar.Date) error {
	if signer == "" {
		signer = "Erika Muster"
	}
	path := fmt.Sprintf("/traeger/contracts/%d/paper-signature", id)
	if _, err := client.PostFileWithAuthAndFields(auth, path, "file", "vertrag-unterschrieben.pdf", seedPaperContractPDF,
		map[string]string{"signer_name": signer, "signed_on": signedOn.String()}); err != nil {
		return fmt.Errorf("record the paper contract %d: %w", id, err)
	}
	return nil
}

// seedParentContractSignatures lets the first parent whose inbox holds a
// contract waiting for its signature sign it with a drawn signature.
func seedParentContractSignatures(ctx context.Context, rt *Runtime) (int, error) {
	for _, parent := range rt.Parents {
		auth, err := rt.Adapter.LoginParent(ctx, parent.Email, parent.Password)
		if err != nil {
			return 0, fmt.Errorf("log in parent %s: %w", parent.Email, err)
		}
		raw, err := rt.Client.GetWithAuth(auth, "/parent/me/documents/contracts")
		if err != nil {
			// A parent without the inbox right has no contracts to sign.
			fmt.Printf("    parent %s has no contract inbox: %v\n", parent.Email, err)
			continue
		}
		var inbox struct {
			Data []struct {
				ID             string `json:"id"`
				OrganizationID string `json:"organization_id"`
				ContractStatus string `json:"contract_status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &inbox); err != nil {
			return 0, fmt.Errorf("read the contracts of parent %s: %w", parent.Email, err)
		}
		for _, contract := range inbox.Data {
			if contract.ContractStatus != "versendet" {
				continue
			}
			path := fmt.Sprintf("/parent/me/documents/%s/contracts/%s/sign", contract.OrganizationID, contract.ID)
			if _, err := rt.Client.PostWithAuth(auth, path, map[string]any{
				"method": "drawn", "image_png": demoSignaturePNG(parent.Email),
				"withdrawal_notice_acknowledged": true, "early_start_requested": true,
			}); err != nil {
				// The relationship may grant reading but not signing.
				fmt.Printf("    parent %s cannot sign contract %s: %v\n", parent.Email, contract.ID, err)
				continue
			}
			return 1, nil
		}
	}
	return 0, nil
}

// seedSendContractsToParents sends the drafts addressed to the demo parents,
// so one of them finds a contract to sign in the parents portal. It reads the
// drafts of the seeded school: a page of the whole Träger's drafts can miss
// them (#6621).
func seedSendContractsToParents(rt *Runtime, auth AuthRef) error {
	emails := map[string]bool{}
	for _, parent := range rt.Parents {
		emails[strings.ToLower(parent.Email)] = true
	}
	raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/?status=entwurf&school_id=%d&limit=100", rt.Bootstrap.SchoolID))
	if err != nil {
		return fmt.Errorf("read the drafts: %w", err)
	}
	var drafts struct {
		Data struct {
			Contracts []struct {
				ID         ident.ID `json:"id"`
				PartyEmail string   `json:"party_email"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &drafts); err != nil {
		return fmt.Errorf("read the drafts: %w", err)
	}
	ids := []int64{}
	for _, draft := range drafts.Data.Contracts {
		if emails[strings.ToLower(draft.PartyEmail)] {
			ids = append(ids, int64(draft.ID))
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if _, err := rt.Client.PostWithAuth(auth, "/traeger/contracts/send", map[string]any{"contract_ids": ids}); err != nil {
		return fmt.Errorf("send the contracts of the demo parents: %w", err)
	}
	return nil
}
