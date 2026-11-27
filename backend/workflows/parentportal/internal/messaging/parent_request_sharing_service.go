package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/workflows/parentportal/internal/care"
)

const (
	RequestShareMasterData   = care.RequestShareMasterData
	RequestShareCareSchedule = care.RequestShareCareSchedule
	RequestSharePickupChange = care.RequestSharePickupChange
	RequestShareOffering     = care.RequestShareOffering
	RequestShareExcused      = care.RequestShareExcused
)

var (
	ErrRequestSharingInvalid   = errors.New("parent: invalid request sharing choice")
	ErrRequestSharingForbidden = errors.New("parent: request sharing is forbidden")
	ErrRequestSharingNotFound  = errors.New("parent: request not found")
)

type RequestSharingRecipient struct {
	GuardianProfileID int64
	FirstName         string
	LastName          string
	Selected          bool
	accountID         int64
}

type RequestSharingState struct {
	FamilyProtected bool
	Recipients      []RequestSharingRecipient
	// Version is the read-state token of one request's sharing (ADR 0311);
	// empty for the options of a request not yet created.
	Version string
}

type RequestSharingService interface {
	GetRequestSharingOptions(context.Context, int64, int64) (*RequestSharingState, error)
	GetRequestSharing(context.Context, int64, int64, string, int64) (*RequestSharingState, error)
	SetRequestSharing(context.Context, int64, int64, string, int64, []int64, string) (*RequestSharingState, error)
}

func (s *Service) GetRequestSharingOptions(
	ctx context.Context, accountID, studentID int64,
) (*RequestSharingState, error) {
	if !s.requestSharingConfigured() {
		return nil, errors.New("parent: request sharing service is not configured")
	}
	var state *RequestSharingState
	err := s.withOwnedChild(ctx, accountID, studentID, nil, func(txCtx context.Context, _ *Child) error {
		protected, _, loadErr := s.ledger().currentFamilyProtection(txCtx, studentID)
		if loadErr == nil {
			var recipients []RequestSharingRecipient
			recipients, _, loadErr = s.shareRecipients(txCtx, accountID, studentID, nil, false)
			state = &RequestSharingState{FamilyProtected: protected, Recipients: recipients}
		}
		if loadErr != nil {
			return fmt.Errorf("parent: get request sharing options: %w", loadErr)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return state, nil
}

type requestShareKey struct {
	typ string
	id  int64
}

func (s *Service) GetRequestSharing(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
) (*RequestSharingState, error) {
	if !s.requestSharingConfigured() {
		return nil, errors.New("parent: request sharing service is not configured")
	}
	var state *RequestSharingState
	err := s.withOwnedChild(ctx, accountID, studentID, nil, func(txCtx context.Context, _ *Child) error {
		var readErr error
		state, readErr = s.readRequestSharingInTx(txCtx, accountID, studentID, requestType, requestID)
		if readErr != nil {
			return fmt.Errorf("parent: change request sharing: %w", readErr)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return state, nil
}

// SetRequestSharing changes who sees an open request. Changing it is an edit
// of the request, so it needs the permission that submitting the request
// needs: a guardian whose submit permission the school withdrew can no longer
// widen or narrow who sees the request. The configuration and the request
// type are checked before any unit starts; the child check and the change run
// in one transaction (ADR 0161, #5862). The choice replaces the whole
// recipient set, so it is refused with readstate.ErrChanged unless
// expectedVersion is the version of the sharing the guardian read (ADR 0311).
func (s *Service) SetRequestSharing(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
	recipientGuardianProfileIDs []int64, expectedVersion string,
) (*RequestSharingState, error) {
	if !s.requestSharingConfigured() {
		return nil, errors.New("parent: request sharing service is not configured")
	}
	permission, ok := requestSubmitPermission(requestType)
	if !ok {
		return nil, ErrRequestSharingInvalid
	}
	var state *RequestSharingState
	err := s.Children.WithPermittedChildForWrite(ctx, accountID, studentID, permission, nil, func(txCtx context.Context, _ *Child) error {
		var changeErr error
		state, changeErr = s.changeRequestSharingInTx(txCtx, accountID, studentID, requestType, requestID, recipientGuardianProfileIDs, expectedVersion)
		if changeErr != nil {
			return fmt.Errorf("parent: change request sharing: %w", changeErr)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return state, nil
}

// requestSubmitPermission names the permission each shareable request type's
// submit and edit flows resolve the child with.
func requestSubmitPermission(requestType string) (string, bool) {
	switch requestType {
	case RequestShareMasterData:
		return care.GuardianPermissionMasterDataRequest, true
	case RequestShareCareSchedule, RequestShareOffering:
		return care.GuardianPermissionRequestSubmit, true
	case RequestSharePickupChange:
		return care.GuardianPermissionPickupManage, true
	case RequestShareExcused:
		return care.GuardianPermissionSickNoteSubmit, true
	default:
		return "", false
	}
}

func (s *Service) requestSharingConfigured() bool {
	return s.ParentRequestShares != nil && s.FamilyProtectionEvents != nil && s.StudentRepo != nil &&
		s.StudentGuardianRepo != nil && s.GuardianProfileRepo != nil
}

// requestSharingFacts is what a request's sharing rests on: the family
// protection and the recipients of the caller's own request.
type requestSharingFacts struct {
	protected   bool
	protectedAt time.Time
	recipients  []RequestSharingRecipient
	accountIDs  []int64
}

func (s *Service) loadRequestSharingFacts(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
	profileIDs []int64, write bool,
) (requestSharingFacts, error) {
	var facts requestSharingFacts
	if _, err := s.StudentRepo.FindByIDForUpdate(ctx, studentID); err != nil {
		return facts, err
	}
	if err := s.requireOwnedShareableRequest(ctx, accountID, studentID, requestType, requestID); err != nil {
		return facts, err
	}
	var err error
	facts.protected, facts.protectedAt, err = s.ledger().currentFamilyProtection(ctx, studentID)
	if err != nil {
		return facts, err
	}
	facts.recipients, facts.accountIDs, err = s.shareRecipients(ctx, accountID, studentID, profileIDs, write)
	return facts, err
}

// readRequestSharingInTx reads who sees the caller's open request.
func (s *Service) readRequestSharingInTx(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
) (*RequestSharingState, error) {
	facts, err := s.loadRequestSharingFacts(ctx, accountID, studentID, requestType, requestID, nil, false)
	if err != nil {
		return nil, err
	}
	return s.requestSharingState(ctx, studentID, requestType, requestID, facts.protected, facts.protectedAt, facts.recipients)
}

// changeRequestSharingInTx records who sees the caller's open request. The
// child's row lock taken by loadRequestSharingFacts serializes it with every
// other change of the request's sharing, so the version compared here is the
// one the write replaces.
func (s *Service) changeRequestSharingInTx(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64, profileIDs []int64,
	expectedVersion string,
) (*RequestSharingState, error) {
	facts, err := s.loadRequestSharingFacts(ctx, accountID, studentID, requestType, requestID, profileIDs, true)
	if err != nil {
		return nil, err
	}
	stored, err := s.requestSharingState(ctx, studentID, requestType, requestID, facts.protected, facts.protectedAt, facts.recipients)
	if err != nil {
		return nil, err
	}
	if err := readstate.Check(expectedVersion, stored.Version); err != nil {
		return nil, err
	}
	if facts.protected && len(facts.accountIDs) > 0 {
		return nil, ErrRequestSharingForbidden
	}
	if err := s.createRequestShare(ctx, accountID, studentID, requestType, requestID, facts.accountIDs); err != nil {
		return nil, err
	}
	return s.requestSharingState(ctx, studentID, requestType, requestID, facts.protected, facts.protectedAt, facts.recipients)
}

// ShareRequestInTx writes the guardian's recipient choice for a request that
// was just created, inside the SAME transaction as the request row (#2267,
// finding 4). Sharing at creation used to be a second HTTP call, so a rejected
// or dropped share left the request visible to nobody the family had picked;
// here a refused share rolls the request back with it and the family sees one
// clean failure instead of a half-done submission.
//
// An empty recipient list writes no share event at all — "shared with nobody"
// is the default state, not something to record.
func (s *Service) ShareRequestInTx(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64, recipientProfileIDs []int64,
) error {
	if len(recipientProfileIDs) == 0 {
		return nil
	}
	if !s.requestSharingConfigured() {
		return errors.New("parent: request sharing service is not configured")
	}
	protected, _, err := s.ledger().currentFamilyProtection(ctx, studentID)
	if err != nil {
		return err
	}
	// shareRecipients validates that every id is a co-guardian of THIS child
	// with portal access — a forged id is refused here, before the share.
	_, accountIDs, err := s.shareRecipients(ctx, accountID, studentID, recipientProfileIDs, true)
	if err != nil {
		return err
	}
	if protected && len(accountIDs) > 0 {
		return ErrRequestSharingForbidden
	}
	if len(accountIDs) == 0 {
		return nil
	}
	return s.createRequestShare(ctx, accountID, studentID, requestType, requestID, accountIDs)
}

func (s *Service) createRequestShare(ctx context.Context, accountID, studentID int64, requestType string, requestID int64, recipients []int64) error {
	event := &ParentRequestShareEvent{
		StudentID: studentID, RequestType: requestType, RequestID: requestID,
		AuthorAccountID: accountID, RecipientAccountIDs: recipients,
	}
	if err := s.ParentRequestShares.Create(ctx, event); err != nil {
		return err
	}
	// The ledger records WHETHER a request was shared and with how many
	// co-guardians. The recipient account ids stay in the share event itself,
	// which is the row the visibility rules read.
	// The count is an integer, so this typed JSON object cannot fail encoding.
	payload, _ := json.Marshal(map[string]int{"recipient_count": len(recipients)})
	return care.RecordRequestEvent(ctx, s.ParentRequestEvents, care.RequestLedgerEntry{
		StudentID:      studentID,
		RequestType:    requestType,
		RequestID:      requestID,
		EventType:      ParentRequestEventShared,
		ActorAccountID: accountID,
		Payload:        payload,
	})
}

func (s *Service) requestSharingState(
	ctx context.Context, studentID int64, requestType string, requestID int64,
	protected bool, protectedAt time.Time, recipients []RequestSharingRecipient,
) (*RequestSharingState, error) {
	shares, err := s.ledger().currentRequestShares(ctx, []int64{studentID})
	if err != nil {
		return nil, err
	}
	current := shares[studentID]
	selected := effectiveRecipientSet(s.SharePolicy, current[requestShareKey{typ: requestType, id: requestID}], protected, protectedAt)
	for i := range recipients {
		recipients[i].Selected = selected[recipients[i].accountID]
	}
	return &RequestSharingState{FamilyProtected: protected, Recipients: recipients, Version: requestSharingVersion(protected, recipients)}, nil
}

// requestSharingVersion is the read-state token of one request's sharing:
// whether the family protection holds, who may be chosen and who is chosen.
// Names stay out; renaming a guardian changes no choice.
func requestSharingVersion(protected bool, recipients []RequestSharingRecipient) string {
	type choice struct {
		GuardianProfileID int64 `json:"g"`
		Selected          bool  `json:"s"`
	}
	choices := make([]choice, 0, len(recipients))
	for _, recipient := range recipients {
		choices = append(choices, choice{GuardianProfileID: recipient.GuardianProfileID, Selected: recipient.Selected})
	}
	sort.Slice(choices, func(i, j int) bool { return choices[i].GuardianProfileID < choices[j].GuardianProfileID })
	return readstate.Fingerprint(struct {
		Protected bool     `json:"p"`
		Choices   []choice `json:"c"`
	}{Protected: protected, Choices: choices})
}

// RequestSharePolicy reads the meaning of the two People Directory ledgers.
type RequestSharePolicy interface {
	EffectiveRecipientSet(time.Time, []int64, bool, time.Time) map[int64]bool
}

// effectiveRecipientSet answers who may currently see one request. A share is
// effective only while the child is unprotected AND the share is newer than the
// newest protection event: protection voids every earlier share permanently,
// and after protection is switched off the guardian must share again. Nothing
// here revives a voided share.
// Pinned by TestRequestSharingIsNamedAndFamilyProtectionDoesNotReviveOldShares.
func effectiveRecipientSet(policy RequestSharePolicy, event *ParentRequestShareEvent, protected bool, protectedAt time.Time) map[int64]bool {
	if event == nil {
		return map[int64]bool{}
	}
	return policy.EffectiveRecipientSet(event.CreatedAt, event.RecipientAccountIDs, protected, protectedAt)
}

// shareLedger reads the request-sharing ledger and the family protection the
// share visibility is derived from. A nil reader reads as empty.
type shareLedger struct {
	shares     RequestShareRecords
	protection FamilyProtectionReads
	policy     RequestSharePolicy
}

func (s *Service) ledger() shareLedger {
	return shareLedger{shares: s.ParentRequestShares, protection: s.FamilyProtectionEvents, policy: s.SharePolicy}
}

// currentRequestShares reads the effective share of every request of the
// children in one statement, keyed by child. A child without a share has no
// entry; reading a missing entry yields the empty share set.
func (l shareLedger) currentRequestShares(ctx context.Context, studentIDs []int64) (map[int64]map[requestShareKey]*ParentRequestShareEvent, error) {
	result := make(map[int64]map[requestShareKey]*ParentRequestShareEvent, len(studentIDs))
	if l.shares == nil || len(studentIDs) == 0 {
		return result, nil
	}
	rows, err := l.shares.CurrentForStudents(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if result[row.StudentID] == nil {
			result[row.StudentID] = map[requestShareKey]*ParentRequestShareEvent{}
		}
		result[row.StudentID][requestShareKey{typ: row.RequestType, id: row.RequestID}] = row
	}
	return result, nil
}

// currentFamilyProtection returns whether the child is protected right now and
// the timestamp of the newest protection event, which is the cut-off date for
// shares.
//
// Familienschutz voids every earlier share PERMANENTLY. Switching it off does
// not bring those shares back — the guardian has to share again, deliberately.
// That is why the timestamp travels even when protection is off: the disable
// event is the newest event, so every share older than it stays void.
// Pinned by TestRequestSharingIsNamedAndFamilyProtectionDoesNotReviveOldShares.
func (l shareLedger) currentFamilyProtection(ctx context.Context, studentID int64) (bool, time.Time, error) {
	if l.protection == nil {
		return false, time.Time{}, nil
	}
	current, err := l.protection.CurrentForStudents(ctx, []int64{studentID})
	if err != nil {
		return false, time.Time{}, err
	}
	event := current[studentID]
	if event == nil {
		return false, time.Time{}, nil
	}
	return event.Enabled, event.CreatedAt, nil
}

func (s *Service) shareRecipients(
	ctx context.Context, authorAccountID, studentID int64, selectedProfileIDs []int64, validate bool,
) ([]RequestSharingRecipient, []int64, error) {
	links, err := s.StudentGuardianRepo.FindByStudentID(ctx, studentID)
	if err != nil {
		return nil, nil, err
	}
	profiles := portalGuardianProfileIDs(links, s.GuardianPolicy.PermissionGrantedJSON)
	profileRows, err := s.GuardianProfileRepo.FindActivePortalProfilesByIDs(ctx, profiles)
	if err != nil {
		return nil, nil, err
	}
	selected, err := selectedGuardianProfiles(selectedProfileIDs)
	if err != nil {
		return nil, nil, err
	}
	recipients, accountIDs := buildSharingRecipients(profileRows, authorAccountID, selected)
	if validate && len(selected) > 0 {
		return nil, nil, ErrRequestSharingInvalid
	}
	sortSharingRecipients(recipients, accountIDs)
	return recipients, accountIDs, nil
}

func portalGuardianProfileIDs(links []*care.GuardianRelationship, granted func(json.RawMessage, string) bool) []int64 {
	profiles := make([]int64, 0, len(links))
	for _, link := range links {
		if link != nil && granted(link.Permissions, care.GuardianPermissionPortalAccess) {
			profiles = append(profiles, link.GuardianProfileID)
		}
	}
	return profiles
}

func selectedGuardianProfiles(profileIDs []int64) (map[int64]struct{}, error) {
	selected := make(map[int64]struct{}, len(profileIDs))
	for _, id := range profileIDs {
		if id <= 0 {
			return nil, ErrRequestSharingInvalid
		}
		if _, duplicate := selected[id]; duplicate {
			return nil, ErrRequestSharingInvalid
		}
		selected[id] = struct{}{}
	}
	return selected, nil
}

func buildSharingRecipients(
	profiles map[int64]*care.GuardianProfile, authorAccountID int64, selected map[int64]struct{},
) ([]RequestSharingRecipient, []int64) {
	recipients := make([]RequestSharingRecipient, 0, len(profiles))
	accountIDs := make([]int64, 0, len(selected))
	for profileID, profile := range profiles {
		if profile == nil || profile.AccountID == nil || *profile.AccountID == authorAccountID {
			continue
		}
		recipients = append(recipients, RequestSharingRecipient{
			GuardianProfileID: profileID, FirstName: profile.FirstName, LastName: profile.LastName,
			accountID: *profile.AccountID,
		})
		if _, ok := selected[profileID]; ok {
			accountIDs = append(accountIDs, *profile.AccountID)
			delete(selected, profileID)
		}
	}
	return recipients, accountIDs
}

func sortSharingRecipients(recipients []RequestSharingRecipient, accountIDs []int64) {
	sort.Slice(recipients, func(i, j int) bool {
		return collation.CompareGermanNames(recipients[i].LastName, recipients[i].FirstName, recipients[j].LastName, recipients[j].FirstName) < 0
	})
	sort.Slice(accountIDs, func(i, j int) bool { return accountIDs[i] < accountIDs[j] })
}

// ParentRequestEventView is one line of a request's history as the parents
// portal shows it ("Geändert am …"). Deliberately narrow: no actor, no
// payload — a co-guardian's name or a staff reason belongs to the pill, not
// to this list.
type ParentRequestEventView struct {
	EventType string    `json:"event_type"`
	CreatedAt time.Time `json:"created_at"`
	Version   string    `json:"version"`
}

// ListRequestEvents returns the ledger of one request, for the guardian who
// submitted it. Anyone else — including a co-guardian the request was shared
// with — gets the same not-found the sharing surface returns, so a request id
// cannot be probed.
func (s *Service) ListRequestEvents(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
) ([]ParentRequestEventView, error) {
	var out []ParentRequestEventView
	txErr := s.withOwnedChild(ctx, accountID, studentID, func(*Child) error {
		if s.ParentRequestEvents == nil {
			return errors.New("parent: request event ledger is not configured")
		}
		return nil
	}, func(txCtx context.Context, _ *Child) error {
		if err := s.requireOwnedShareableRequest(txCtx, accountID, studentID, requestType, requestID); err != nil {
			return err
		}
		rows, listErr := s.ParentRequestEvents.ListForRequest(txCtx, requestType, requestID)
		if listErr != nil {
			return listErr
		}
		out = make([]ParentRequestEventView, 0, len(rows))
		for _, row := range rows {
			out = append(out, ParentRequestEventView{
				EventType: row.EventType,
				CreatedAt: row.CreatedAt,
				Version:   row.Version,
			})
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return out, nil
}

func (s *Service) requireOwnedShareableRequest(
	ctx context.Context, accountID, studentID int64, requestType string, requestID int64,
) error {
	if requestID <= 0 {
		return ErrRequestSharingInvalid
	}
	owner, child, kind, err := s.shareableRequestIdentity(ctx, requestType, requestID)
	if err != nil {
		return err
	}
	if owner != accountID || child != studentID || kind != requestType {
		return ErrRequestSharingNotFound
	}
	return nil
}

func (s *Service) shareableRequestIdentity(ctx context.Context, requestType string, requestID int64) (int64, int64, string, error) {
	switch requestType {
	case RequestShareMasterData:
		return s.masterDataShareIdentity(ctx, requestID)
	case RequestShareCareSchedule, RequestSharePickupChange:
		return s.careRequestShareIdentity(ctx, requestType, requestID)
	case RequestShareOffering:
		return s.offeringShareIdentity(ctx, requestID)
	case RequestShareExcused:
		return s.excusedShareIdentity(ctx, requestID)
	default:
		return 0, 0, "", ErrRequestSharingInvalid
	}
}

func (s *Service) masterDataShareIdentity(ctx context.Context, requestID int64) (int64, int64, string, error) {
	row, err := s.ChangeRequestRepo.FindByID(ctx, requestID)
	if err != nil || row == nil {
		return 0, 0, "", requestLookupError(err)
	}
	return row.SubmittedBy, row.StudentID, RequestShareMasterData, nil
}

func (s *Service) careRequestShareIdentity(ctx context.Context, requestType string, requestID int64) (int64, int64, string, error) {
	submittedBy, studentID, kind, err := s.CareRequestRepo.FindIdentity(ctx, requestID)
	if err != nil {
		return 0, 0, "", err
	}
	expected := "weekly_schedule"
	if requestType == RequestSharePickupChange {
		expected = "pickup_change"
	}
	if kind != expected {
		return 0, 0, "", ErrRequestSharingNotFound
	}
	return submittedBy, studentID, requestType, nil
}

func (s *Service) offeringShareIdentity(ctx context.Context, requestID int64) (int64, int64, string, error) {
	row, err := s.OfferingChangeRequestRepo.FindByID(ctx, requestID)
	if err != nil || row == nil {
		return 0, 0, "", requestLookupError(err)
	}
	return row.SubmittedBy, row.StudentID, RequestShareOffering, nil
}

func (s *Service) excusedShareIdentity(ctx context.Context, requestID int64) (int64, int64, string, error) {
	submittedBy, studentID, err := s.ExcusedRequestRepo.FindIdentity(ctx, requestID)
	if err != nil {
		return 0, 0, "", requestLookupError(err)
	}
	return submittedBy, studentID, RequestShareExcused, nil
}

// requestLookupError answers a missing request with the sharing not-found.
// The bindings report a missing row as ErrRequestSharingNotFound; the
// master-data read reports the workflow's own not-found.
func requestLookupError(err error) error {
	if err == nil || errors.Is(err, care.ErrMasterDataRequestNotFound) {
		return ErrRequestSharingNotFound
	}
	return err
}

type RequestShareVisibility struct {
	policy      RequestSharePolicy
	current     map[requestShareKey]*ParentRequestShareEvent
	protected   bool
	protectedAt time.Time
}

func (s *Service) LoadRequestShareVisibility(ctx context.Context, studentID int64) (*RequestShareVisibility, error) {
	return s.ledger().visibility(ctx, studentID)
}

// LoadRequestShareVisibilities reads the share visibility of several children
// of one school with two statements, whatever their number. Each child keeps
// its own shares and its own Familienschutz.
func (s *Service) LoadRequestShareVisibilities(ctx context.Context, studentIDs []int64) (map[int64]*RequestShareVisibility, error) {
	return s.ledger().visibilities(ctx, studentIDs)
}

func (l shareLedger) visibility(ctx context.Context, studentID int64) (*RequestShareVisibility, error) {
	visibilities, err := l.visibilities(ctx, []int64{studentID})
	if err != nil {
		return nil, err
	}
	return visibilities[studentID], nil
}

func (l shareLedger) visibilities(ctx context.Context, studentIDs []int64) (map[int64]*RequestShareVisibility, error) {
	current, err := l.currentRequestShares(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	protection := map[int64]*FamilyProtectionEvent{}
	if l.protection != nil && len(studentIDs) > 0 {
		if protection, err = l.protection.CurrentForStudents(ctx, studentIDs); err != nil {
			return nil, err
		}
	}
	out := make(map[int64]*RequestShareVisibility, len(studentIDs))
	for _, studentID := range studentIDs {
		visibility := &RequestShareVisibility{current: current[studentID], policy: l.policy}
		if event := protection[studentID]; event != nil {
			visibility.protected, visibility.protectedAt = event.Enabled, event.CreatedAt
		}
		out[studentID] = visibility
	}
	return out, nil
}

func (v *RequestShareVisibility) Allows(requestType string, requestID, accountID, submittedBy int64) bool {
	if submittedBy == accountID {
		return true
	}
	event := v.current[requestShareKey{typ: requestType, id: requestID}]
	return effectiveRecipientSet(v.policy, event, v.protected, v.protectedAt)[accountID]
}

// SharedRecipientAccountIDs names the guardians the submitting parent
// explicitly shared ONE request with (#2267, story 47). It exists so the staff
// decide services can give those recipients the full decision pill while every
// other co-guardian gets only the neutral „Betreuungsstand geändert“ line —
// without the schedule, absence and enrollment domains having to import this
// package or re-derive sharing rules they do not own.
//
// Familienschutz is honoured by construction: effectiveRecipientSet returns an
// empty set while the child is protected, and also voids any share chosen
// before protection was switched on. A protected child therefore has no full
// recipients at all, only neutral ones.
//
// Call it inside the caller's tenant transaction.
func (s *Service) SharedRecipientAccountIDs(
	ctx context.Context,
	studentID int64,
	requestType string,
	requestID int64,
) ([]int64, error) {
	return s.ledger().sharedRecipientAccountIDs(ctx, studentID, requestType, requestID)
}

func (l shareLedger) sharedRecipientAccountIDs(ctx context.Context, studentID int64, requestType string, requestID int64) ([]int64, error) {
	visibility, err := l.visibility(ctx, studentID)
	if err != nil {
		return nil, err
	}
	recipients := effectiveRecipientSet(l.policy,
		visibility.current[requestShareKey{typ: requestType, id: requestID}],
		visibility.protected, visibility.protectedAt,
	)
	accountIDs := make([]int64, 0, len(recipients))
	for accountID := range recipients {
		if accountID > 0 {
			accountIDs = append(accountIDs, accountID)
		}
	}
	sort.Slice(accountIDs, func(i, j int) bool { return accountIDs[i] < accountIDs[j] })
	return accountIDs, nil
}

// ChildFlowSharing serves the child flows' request-sharing port from this
// ledger.
func (s *Service) ChildFlowSharing() care.RequestSharer { return childFlowSharing{Service: s} }

type childFlowSharing struct{ *Service }

func (c childFlowSharing) LoadRequestShareVisibility(ctx context.Context, studentID int64) (care.RequestShareVisibility, error) {
	visibility, err := c.Service.LoadRequestShareVisibility(ctx, studentID)
	if err != nil || visibility == nil {
		return nil, err
	}
	return visibility, nil
}

func (c childFlowSharing) LoadRequestShareVisibilities(ctx context.Context, studentIDs []int64) (map[int64]care.RequestShareVisibility, error) {
	visibilities, err := c.Service.LoadRequestShareVisibilities(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]care.RequestShareVisibility, len(visibilities))
	for studentID, visibility := range visibilities {
		out[studentID] = visibility
	}
	return out, nil
}
