package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The kind of document per service (#4688, ADR 0119 addendum 2026-11-08).
// The Abrechnung chooses it; the release of a run freezes it on every
// document it issues and refuses fee notices while the template of the fee
// notice has no legal remedy.

// DocumentKindStore keeps the kind of document of every issuer and service
// of a Träger in its Träger transaction (#8040).
type DocumentKindStore interface {
	// DocumentKinds reads the chosen kind of every issuer and service that
	// has one, by issuer key and service, with the time of the choice.
	DocumentKinds(ctx context.Context, organizationID int64) (map[string]map[string]parentbilling.ServiceDocumentKind, error)
	SetDocumentKind(ctx context.Context, organizationID int64, issuerKey, service, documentKind string) error
}

// documentKindServices are the services in the order the Abrechnung sees
// them.
var documentKindServices = []string{parentbilling.ServiceHoliday, parentbilling.ServiceCare}

// DocumentKinds serves parentbilling.BillingDocumentKinds.
type DocumentKinds struct {
	gate documentKindGate
}

var _ parentbilling.BillingDocumentKinds = (*DocumentKinds)(nil)

// NewDocumentKinds builds the choice of the kinds of document over the
// templates the root binds.
func NewDocumentKinds(store DocumentKindStore, templates parentbilling.BillingDocumentTemplates) *DocumentKinds {
	return &DocumentKinds{gate: newDocumentKindGate(store, templates)}
}

// ListDocumentKinds reads the kind of every service of the Träger, its
// choices and whether the template of the fee notice has its legal remedy.
// The kinds of the bodies that bill a school of the Träger stand in their
// state (BillingIssuerStatuses, #8040). It reads no personal data.
func (d *DocumentKinds) ListDocumentKinds(ctx context.Context, organizationID int64) (parentbilling.DocumentKindOverview, error) {
	if organizationID <= 0 {
		return parentbilling.DocumentKindOverview{}, errTraegerRequired
	}
	chosen, err := d.gate.store.DocumentKinds(ctx, organizationID)
	if err != nil {
		return parentbilling.DocumentKindOverview{}, fmt.Errorf("parent billing: read document kinds: %w", err)
	}
	overview := parentbilling.DocumentKindOverview{Services: make([]parentbilling.ServiceDocumentKind, 0, len(documentKindServices))}
	for _, service := range documentKindServices {
		current, ok := chosen[""][service]
		if !ok || !parentbilling.ValidDocumentKind(service, current.DocumentKind) {
			current = parentbilling.ServiceDocumentKind{DocumentKind: parentbilling.DefaultDocumentKind(service)}
		}
		current.Service, current.Choices = service, parentbilling.DocumentKindChoices(service)
		overview.Services = append(overview.Services, current)
	}
	template, err := d.gate.templates.DocumentTemplate(ctx, organizationID, parentbilling.DocumentKindFeeNotice)
	if err != nil {
		return parentbilling.DocumentKindOverview{}, fmt.Errorf("parent billing: read the template of the fee notice: %w", err)
	}
	overview.LegalRemedySet = !templates.LacksLegalRemedy(templates.KindFeeNotice, letterTemplate(template, templates.KindFeeNotice, letterAddressee{}))
	overview.FeeNoticeTemplateVersion = template.Version
	return overview, nil
}

// SetDocumentKind chooses the kind a service of an issuer issues from the
// next release on. Issued documents keep theirs. Choosing the fee notice is
// allowed before its legal remedy is written; the release refuses until
// then. The issuer is the Träger or a body that bills a school of the Träger
// now.
func (d *DocumentKinds) SetDocumentKind(ctx context.Context, organizationID int64, issuerKey, service, documentKind string) (parentbilling.DocumentKindOverview, error) {
	if organizationID <= 0 {
		return parentbilling.DocumentKindOverview{}, errTraegerRequired
	}
	issuerKey, service, documentKind = strings.TrimSpace(issuerKey), strings.TrimSpace(service), strings.TrimSpace(documentKind)
	switch {
	case parentbilling.DocumentKindChoices(service) == nil:
		return parentbilling.DocumentKindOverview{}, validation.Errors{"service": errors.New("unknown service")}
	case !parentbilling.ValidDocumentKind(service, documentKind):
		return parentbilling.DocumentKindOverview{}, validation.Errors{"document_kind": parentbilling.ErrDocumentKindInvalid}
	}
	issuers, err := d.gate.issuers(ctx, organizationID)
	if err != nil {
		return parentbilling.DocumentKindOverview{}, err
	}
	if !slices.ContainsFunc(issuers, func(issuer parentbilling.BillingIssuer) bool { return issuer.Key == issuerKey }) {
		return parentbilling.DocumentKindOverview{}, validation.Errors{"issuer_key": errors.New("is no issuer of the Träger")}
	}
	if err := d.gate.store.SetDocumentKind(ctx, organizationID, issuerKey, service, documentKind); err != nil {
		return parentbilling.DocumentKindOverview{}, fmt.Errorf("parent billing: set document kind: %w", err)
	}
	return d.ListDocumentKinds(ctx, organizationID)
}

// documentKindGate reads the kind each issuer issues for a service now and
// checks before a release that a fee notice has its legal remedy. The
// holiday and the monthly runs share it.
type documentKindGate struct {
	store     DocumentKindStore
	templates parentbilling.BillingDocumentTemplates
}

func newDocumentKindGate(store DocumentKindStore, templates parentbilling.BillingDocumentTemplates) documentKindGate {
	if store == nil || templates == nil {
		panic("parent billing: the document kind store and the document templates are required")
	}
	return documentKindGate{store: store, templates: templates}
}

// issuers lists the Träger and every body that bills a school of the Träger
// now (#8040).
func (g documentKindGate) issuers(ctx context.Context, organizationID int64) ([]parentbilling.BillingIssuer, error) {
	schools, err := schoolIssuers(ctx, g.templates, organizationID)
	if err != nil {
		return nil, err
	}
	return parentbilling.DistinctIssuers(schools), nil
}

// issuerKinds is the kind of document each issuer of a run issues now
// (#8040), whether a release would refuse one of them for a missing legal
// remedy, and what the review shows of the legal remedy: the version and the
// text of the template of the fee notice, empty while no issuer issues one.
// The fingerprint of the review covers both (#4688), so a kind or a legal
// remedy changed between review and release makes the release refuse.
type issuerKinds struct {
	kinds       map[string]string
	keys        []string
	missing     bool
	legalRemedy string
}

// of is the kind the issuer issues.
func (k issuerKinds) of(issuerKey string) string { return k.kinds[issuerKey] }

// state is the kind of the run as one value: the kind of its first issuer,
// with whether the release refuses a fee notice.
func (k issuerKinds) state() parentbilling.DocumentKindState {
	state := parentbilling.DocumentKindState{LegalRemedyMissing: k.missing}
	if len(k.keys) > 0 {
		state.DocumentKind = k.kinds[k.keys[0]]
	}
	return state
}

// fingerprint names the kinds for the fingerprint of a review: the kind of
// the first issuer alone while only the Träger issues, so a run without a
// body keeps the fingerprint it had before #8040.
func (k issuerKinds) fingerprint() string {
	text := k.state().DocumentKind
	for _, key := range k.keys {
		if key != "" {
			text += ";" + key + "=" + k.kinds[key]
		}
	}
	return text
}

// reviewed reads the kind each issuer issues for the service now. keys are
// the issuers of the run in the order of its documents; without one it reads
// the Träger's.
func (g documentKindGate) reviewed(ctx context.Context, organizationID int64, service string, keys []string) (issuerKinds, error) {
	chosen, err := g.store.DocumentKinds(ctx, organizationID)
	if err != nil {
		return issuerKinds{}, fmt.Errorf("parent billing: read document kinds: %w", err)
	}
	if len(keys) == 0 {
		keys = []string{""}
	}
	result := issuerKinds{kinds: make(map[string]string, len(keys)), keys: keys}
	feeNotice := false
	for _, key := range keys {
		kind := chosenKind(chosen, key, service)
		result.kinds[key] = kind
		feeNotice = feeNotice || kind == parentbilling.DocumentKindFeeNotice
	}
	if !feeNotice {
		return result, nil
	}
	template, err := g.templates.DocumentTemplate(ctx, organizationID, parentbilling.DocumentKindFeeNotice)
	if err != nil {
		return issuerKinds{}, fmt.Errorf("parent billing: read the template of the fee notice: %w", err)
	}
	result.missing = templates.LacksLegalRemedy(templates.KindFeeNotice, letterTemplate(template, templates.KindFeeNotice, letterAddressee{}))
	result.legalRemedy = fmt.Sprintf("%d:%s", template.Version, template.LegalRemedy)
	return result, nil
}

// chosenKind is the kind the issuer chose for the service, else its
// default.
func chosenKind(chosen map[string]map[string]parentbilling.ServiceDocumentKind, issuerKey, service string) string {
	if choice, ok := chosen[issuerKey][service]; ok && parentbilling.ValidDocumentKind(service, choice.DocumentKind) {
		return choice.DocumentKind
	}
	return parentbilling.DefaultIssuerDocumentKind(issuerKey, service)
}

// issuerKeys lists the issuers of documents once each, in their order.
func issuerKeys[T any](documents []T, keyOf func(T) string) []string {
	keys := []string{}
	for _, document := range documents {
		if key := keyOf(document); !slices.Contains(keys, key) {
			keys = append(keys, key)
		}
	}
	return keys
}
