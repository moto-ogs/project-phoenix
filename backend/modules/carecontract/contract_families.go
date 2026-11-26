package carecontract

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The family of contracts without a mail address (#7161, ADR 0319). The
// mail address of a contract's party names its family (ADR 0164 point 4);
// a contract whose parties have none, such as one imported from a file
// without addresses, is a family of its own (ADR 0232 point 7). The
// Träger-Büro states that the parents of such contracts are the same: it
// joins them to one family under a leading contract.
//
// Invariants:
//   - Only the office joins, by hand: moto proposes nothing and joins
//     nothing on suspicion.
//   - Only a contract of the Träger that is no draft and whose parties have
//     no mail address joins. A mail address names the family by itself.
//   - A family has one leading contract, which leads nothing else and is
//     led by none: no chain. Joining a contract of a family brings the whole
//     family along.
//   - Leaving gives the contract its own family back; what is stored under
//     it was never moved (ADR 0319 point 4). The leading contract leaves
//     last, when it is alone.
//   - Every join and leave stands in the trail of the contract, with the
//     leading contract before and after it; a write carries the state the
//     office read (ADR 0311).

// Actions of the trail of a family.
const (
	FamilyActionJoin  = "join_family"
	FamilyActionLeave = "leave_family"
)

// FamilyRefusedCode is the registered wire code of a FamilyRefusal.
const FamilyRefusedCode = "care_contract.family_refused"

// Why contracts are not joined or a contract does not leave.
const (
	// FamilyRefusedHasEmail: a party of the contract has a mail address.
	FamilyRefusedHasEmail = "has_email"
	// FamilyRefusedDraft: the contract is a draft.
	FamilyRefusedDraft = "draft"
	// FamilyRefusedNotJoined: the contract leaves a family it is not led in.
	FamilyRefusedNotJoined = "not_joined"
	// FamilyRefusedLeads: the leading contract leaves while it leads others.
	FamilyRefusedLeads = "leads"
)

// FamilyRefusal refuses a join or a leave the contracts do not allow. It is
// a business rejection: the API answers 409 with FamilyRefusedCode, the
// reason and the contract.
type FamilyRefusal struct {
	Reason     string
	ContractID int64
}

func (e *FamilyRefusal) Error() string {
	return "the family of the contracts cannot be changed: " + e.Reason
}

// ErrorCode is the registered wire code of the refusal.
func (*FamilyRefusal) ErrorCode() string { return FamilyRefusedCode }

// ErrorDetails names the reason and the contract.
func (e *FamilyRefusal) ErrorDetails() any {
	return FamilyRefusalDetails{Reason: e.Reason, ContractID: ident.ID(e.ContractID)}
}

type FamilyRefusalDetails struct {
	Reason     string   `json:"reason"`
	ContractID ident.ID `json:"contract_id"`
}

// FamilyMember is a contract without a mail address with its family.
// FamilyContractID is the leading contract of its family: the contract
// itself when it is alone or leads.
type FamilyMember struct {
	ContractID       ident.ID       `json:"contract_id"`
	FamilyContractID ident.ID       `json:"family_contract_id"`
	Status           string         `json:"status"`
	SchoolID         ident.ID       `json:"school_id"`
	SchoolName       string         `json:"school_name"`
	ChildFirstName   string         `json:"child_first_name"`
	ChildLastName    string         `json:"child_last_name"`
	ChildBirthDate   *calendar.Date `json:"child_birth_date"`
	// PartyName names the parties as the contract does; empty without one.
	PartyName     string         `json:"party_name"`
	EffectiveFrom calendar.Date  `json:"effective_from"`
	EndsOn        *calendar.Date `json:"ends_on"`
}

// FamilyEvent is one join or leave of the trail. FamilyContractID is the
// leading contract after the change, PreviousFamilyContractID the one
// before; each is the contract itself when it was alone.
type FamilyEvent struct {
	ID                       ident.ID  `json:"id"`
	Action                   string    `json:"action"`
	ContractID               ident.ID  `json:"contract_id"`
	FamilyContractID         ident.ID  `json:"family_contract_id"`
	PreviousFamilyContractID ident.ID  `json:"previous_family_contract_id"`
	ChildFirstName           string    `json:"child_first_name"`
	ChildLastName            string    `json:"child_last_name"`
	AccountID                *ident.ID `json:"account_id"`
	At                       time.Time `json:"at"`
}

// ContractFamilySet is every contract of the Träger without a mail address
// with its family, the newest changes of the families first, and the
// version of the families the office read (ADR 0311).
type ContractFamilySet struct {
	Version   string         `json:"version"`
	Contracts []FamilyMember `json:"contracts"`
	Events    []FamilyEvent  `json:"events"`
}

// FamilyEventLimit is how many changes of the families the set shows.
const FamilyEventLimit = 100

// FamilyJoinInput joins the contracts to one family led by
// FamilyContractID, one of them, on the version the office read.
type FamilyJoinInput struct {
	ContractIDs      []ident.ID `json:"contract_ids"`
	FamilyContractID ident.ID   `json:"family_contract_id"`
	ExpectedVersion  string     `json:"expected_version"`
}
