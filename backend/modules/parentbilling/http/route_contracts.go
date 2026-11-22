package parentbillinghttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// BillingFamilyRouteContracts registers the typed contract of the billing
// families (ADR 0270), with patterns relative to the
// /traeger/billing-families mount.
func BillingFamilyRouteContracts() []common.RouteContract {
	return append(billingFamilyListRouteContracts(), common.RouteContract{
		Method: "GET", Pattern: "/debtor-number-format",
		Portals:  []common.PortalScope{common.PortalTraeger},
		Response: debtorNumberSettings{},
		Enums: []common.EnumContract{{
			Name: "DebtorNumberScope", Fields: []string{"debtorNumberSettings.scope"},
			Values: []string{capability.DebtorNumberScopePayer, capability.DebtorNumberScopeChild},
		}},
	})
}

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// importUploadBytes bounds an import upload: the file and the form around
// it, as importFileOf reads them.
const importUploadBytes = capability.MaxImportFileBytes + importFormOverhead

// listExport is the query of a list export: its format (common.ListFormatOf).
var listExport = []common.QueryParam{common.ListFormatQuery}

// runExport is the query of a run's own export, which requires a format.
var runExport = []common.QueryParam{{
	Name: "format", Kind: common.QueryString,
	Values: []string{capability.ExportPDF, capability.ExportXLSX, capability.ExportCSV},
}}

// printOnly is the query of a print of letters: only those without e-mail.
var printOnly = []common.QueryParam{{Name: "only", Kind: common.QueryString, Values: []string{capability.CareLetterPrintWithoutEmail}}}

// letterPreviewBodyBytes bounds the JSON body of a letter preview: the date,
// the notes and the emergency numbers.
const letterPreviewBodyBytes = 64 * 1024

// billingFamilyListRouteContracts registers the families, their children
// and debtor numbers. The exports answer files (#2352).
func billingFamilyListRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.BillingFamily{}},
		{Method: "GET", Pattern: "/children", Portals: traegerPortal, Response: []capability.FamilyChildNumbers{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: capability.BillingFamilyDetail{}},
		{Method: "GET", Pattern: "/{id}/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "PUT", Pattern: "/debtor-number", Portals: traegerPortal, Request: FamilyDebtorNumberRequest{}, Response: capability.FamilyDebtorNumber{}},
		{Method: "PUT", Pattern: "/child-debtor-number", Portals: traegerPortal, Request: ChildDebtorNumberRequest{}, Response: capability.FamilyChild{}},
	}
}

// BillingRunRouteContracts registers the holiday billing runs (#4668),
// relative to /traeger/billing-runs. The exports, letters, preview and print
// answer files (#2352).
func BillingRunRouteContracts() []common.RouteContract {
	period := append([]common.QueryParam{{Name: "holiday_period_id", Kind: common.QueryID}}, listExport...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.BillingRun{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: BillingRunRequest{}, Response: capability.BillingRun{}},
		{Method: "GET", Pattern: "/periods", Portals: traegerPortal, Response: []capability.HolidayBillingPeriod{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: period, File: true},
		{Method: "GET", Pattern: "/{id}/export", Portals: traegerPortal, Query: runExport, File: true},
		{Method: "GET", Pattern: "/{id}/cost-takeovers/{costBearerId}/export", Portals: traegerPortal, Query: runExport, File: true},
		{Method: "POST", Pattern: "/{id}/letters/preview", Portals: traegerPortal, Request: BillingLettersRequest{}, MaxBodyBytes: letterPreviewBodyBytes, File: true},
		{Method: "GET", Pattern: "/{id}/documents/{documentID}/letter", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/{id}/letters/print", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: capability.BillingRunDetail{}},
		{Method: "POST", Pattern: "/{id}/corrections", Portals: traegerPortal, Request: BillingCorrectionRequest{}, Response: capability.BillingRunDetail{}},
		{Method: "POST", Pattern: "/{id}/release", Portals: traegerPortal, Request: BillingReleaseRequest{}, Response: capability.BillingRunDetail{}},
		{Method: "POST", Pattern: "/{id}/discard", Portals: traegerPortal, Response: capability.BillingRunDetail{}},
		{Method: "PUT", Pattern: "/{id}/carried-corrections/{positionID}", Portals: traegerPortal, Request: BillingCarriedCorrectionRequest{}, Response: capability.BillingRunDetail{}},
		{Method: "DELETE", Pattern: "/{id}/carried-corrections/{positionID}", Portals: traegerPortal, Response: capability.BillingRunDetail{}},
		{Method: "POST", Pattern: "/{id}/letters", Portals: traegerPortal, Request: BillingLettersRequest{}, Response: capability.BillingLetters{}},
		{Method: "GET", Pattern: "/{id}/mailings", Portals: traegerPortal, Response: capability.BillingLetterMailings{}},
		{Method: "POST", Pattern: "/{id}/mailings", Portals: traegerPortal, Response: capability.BillingLetterSeries{}},
		{Method: "POST", Pattern: "/{id}/documents/{documentID}/mailings", Portals: traegerPortal, Response: capability.BillingLetterMailing{}},
		{Method: "POST", Pattern: "/{id}/documents/{documentID}/cancellation", Portals: traegerPortal, Request: BillingCancellationRequest{}, Response: capability.BillingDocument{}},
		{Method: "POST", Pattern: "/{id}/documents/{documentID}/credits", Portals: traegerPortal, Request: BillingCreditRequest{}, Response: capability.BillingDocument{}},
	}
}

// NumberRangeRouteContracts registers the number ranges, relative to
// /traeger/number-ranges.
func NumberRangeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.NumberRange{}},
		{Method: "PUT", Pattern: "/{service}", Portals: traegerPortal, Request: NumberRangeRequest{}, Response: capability.NumberRange{}},
		{Method: "PUT", Pattern: "/{service}/start", Portals: traegerPortal, Request: NumberRangeStartRequest{}, Response: capability.NumberRange{}},
	}
}

// DocumentKindRouteContracts registers the kind of document of each
// service, relative to /traeger/billing-document-kinds.
func DocumentKindRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.DocumentKindOverview{}},
		{Method: "PUT", Pattern: "/{service}", Portals: traegerPortal, Request: DocumentKindRequest{}, Response: capability.DocumentKindOverview{}},
	}
}

// ContributionRuleRouteContracts registers the contribution rules of the
// holiday care, relative to /traeger/contribution-rules.
func ContributionRuleRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.ContributionRule{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: ContributionRuleRequest{}, Response: capability.ContributionRule{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: ContributionRuleRequest{}, Response: capability.ContributionRule{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, NoData: true},
	}
}

// CostBearerRouteContracts registers the cost bearers, relative to
// /traeger/cost-bearers.
func CostBearerRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.CostBearer{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CostBearerRequest{}, Response: capability.CostBearer{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: CostBearerRequest{}, Response: capability.CostBearer{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, NoData: true},
	}
}

// CareTariffRouteContracts registers the monthly care prices, relative to
// /traeger/care-tariffs.
func CareTariffRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareTariffs{}},
		{Method: "PUT", Pattern: "/", Portals: traegerPortal, Request: CarePriceListRequest{}, Response: capability.CareTariffs{}},
		{Method: "DELETE", Pattern: "/{schoolID}/{validFrom}", Portals: traegerPortal, Response: capability.CareTariffs{}},
	}
}

// CareMealTariffRouteContracts registers the Mensa prices, relative to
// /traeger/care-meal-tariffs.
func CareMealTariffRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareMealTariffs{}},
		{Method: "PUT", Pattern: "/", Portals: traegerPortal, Request: CareMealPriceRequest{}, Response: capability.CareMealTariffs{}},
		{Method: "DELETE", Pattern: "/{schoolID}/{validFrom}", Portals: traegerPortal, Response: capability.CareMealTariffs{}},
	}
}

// CareRunRouteContracts registers the monthly care billing runs, relative
// to /traeger/care-billing-runs. The exports, letters, preview and print
// answer files (#2352).
func CareRunRouteContracts() []common.RouteContract {
	kind := []common.QueryParam{{Name: "kind", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareRunList{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CareRunRequest{}, Response: capability.CareRun{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}/invoices/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}/review-export", Portals: traegerPortal, Query: runExport, File: true},
		{Method: "GET", Pattern: "/{id}/cost-shares/{costBearerID}/export", Portals: traegerPortal, Query: runExport, File: true},
		{Method: "POST", Pattern: "/{id}/letters/preview", Portals: traegerPortal, Request: CareLetterRequest{}, MaxBodyBytes: letterPreviewBodyBytes, File: true},
		{Method: "GET", Pattern: "/{id}/letters/print", Portals: traegerPortal, Query: printOnly, File: true},
		{Method: "GET", Pattern: "/{id}/invoices/{invoiceID}/letter", Portals: traegerPortal, Query: kind, File: true},
		{Method: "GET", Pattern: "/schools", Portals: traegerPortal, Query: []common.QueryParam{{Name: "month", Kind: common.QueryDate}}, Response: []capability.CareRunSchool{}},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: capability.CareRunDetail{}},
		{Method: "POST", Pattern: "/{id}/release", Portals: traegerPortal, Request: CareReleaseRequest{}, Response: capability.CareRunDetail{}},
		{Method: "POST", Pattern: "/{id}/discard", Portals: traegerPortal, Response: capability.CareRunDetail{}},
		{Method: "PUT", Pattern: "/{id}/invoice-date", Portals: traegerPortal, Request: CareInvoiceDateRequest{}, Response: capability.CareRunDetail{}},
		{Method: "POST", Pattern: "/{id}/exclusions", Portals: traegerPortal, Request: CareExclusionRequest{}, Response: capability.CareRunDetail{}},
		{Method: "POST", Pattern: "/{id}/inclusions", Portals: traegerPortal, Request: CareInclusionRequest{}, Response: capability.CareRunDetail{}},
		{Method: "POST", Pattern: "/{id}/amendments", Portals: traegerPortal, Request: CareAmendmentRequest{}, Response: capability.CareRunDetail{}},
		{Method: "GET", Pattern: "/{id}/letters", Portals: traegerPortal, Response: capability.CareLetters{}},
		{Method: "POST", Pattern: "/{id}/letters", Portals: traegerPortal, Request: CareLetterRequest{}, Response: capability.CareLetters{}},
		{Method: "POST", Pattern: "/{id}/letters/mail", Portals: traegerPortal, Response: capability.BillingLetterSeries{}},
		{Method: "POST", Pattern: "/{id}/invoices/{invoiceID}/mail", Portals: traegerPortal, Query: kind, Response: capability.CareLetterMailing{}},
		{Method: "POST", Pattern: "/{id}/invoices/{invoiceID}/cancellation", Portals: traegerPortal, Request: CareCancellationRequest{}, Response: capability.CareLetters{}},
	}
}

// CareNoticeRunRouteContracts registers the Jahresbescheide (#6219),
// relative to /traeger/care-notice-runs. The exports, PDFs and the print
// answer files (#2352).
func CareNoticeRunRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareNoticeRunList{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CareNoticeRunRequest{}, Response: capability.CareNoticeRun{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}/letters/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/{id}/letters/print", Portals: traegerPortal, Query: printOnly, File: true},
		{Method: "GET", Pattern: "/{id}/notices/{contractID}/pdf", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: capability.CareNoticeRunDetail{}},
		{Method: "POST", Pattern: "/{id}/release", Portals: traegerPortal, Request: CareReleaseRequest{}, Response: capability.CareNoticeRunDetail{}},
		{Method: "POST", Pattern: "/{id}/discard", Portals: traegerPortal, Response: capability.CareNoticeRunDetail{}},
		{Method: "GET", Pattern: "/{id}/letters", Portals: traegerPortal, Response: capability.CareNoticeLetters{}},
		{Method: "POST", Pattern: "/{id}/letters", Portals: traegerPortal, Response: capability.CareNoticeLetters{}},
		{Method: "POST", Pattern: "/{id}/letters/mail", Portals: traegerPortal, Response: capability.BillingLetterSeries{}},
		{Method: "GET", Pattern: "/{id}/notices/{contractID}/letter", Portals: traegerPortal, Response: capability.CareNoticeLetter{}},
		{Method: "POST", Pattern: "/{id}/notices/{contractID}/mail", Portals: traegerPortal, Response: capability.CareNoticeMailing{}},
	}
}

// CareRuleRouteContracts registers the rules of the monthly contribution,
// relative to /traeger/care-rules.
func CareRuleRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareRuleSet{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CareRuleRequest{}, Response: capability.CareRuleSet{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: CareRuleRequest{}, Response: capability.CareRuleSet{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, Response: capability.CareRuleSet{}},
	}
}

// CareEvidenceRouteContracts registers the evidences of a reduction,
// relative to /traeger/care-evidences. The export answers a file (#2352).
func CareEvidenceRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareEvidenceSet{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CareEvidenceRequest{}, Response: capability.CareEvidenceSet{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: CareEvidenceRequest{}, Response: capability.CareEvidenceSet{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, Response: capability.CareEvidenceSet{}},
	}
}

// CareCostShareRouteContracts registers the cost shares of the cost bearers,
// relative to /traeger/care-cost-shares. The export answers a file (#2352).
func CareCostShareRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.CareCostShareSet{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CareCostShareRequest{}, Response: capability.CareCostShareSet{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: CareCostShareRequest{}, Response: capability.CareCostShareSet{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, Response: capability.CareCostShareSet{}},
	}
}

// FamilyChildrenRouteContracts registers the children of the families
// (#5918), relative to /traeger/family-children. Imports take uploads and
// the export answers a file through the catalog (#2352).
func FamilyChildrenRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.FamilyChildrenSet{}},
		{Method: "POST", Pattern: "/imports/preview", Portals: traegerPortal, Multipart: true, MaxBodyBytes: importUploadBytes,
			TooLargeCode: common.CodeParentBillingFamilyChildrenImportFileTooLarge, NoCommit: "an import preview checks the file and saves no row of it", Response: capability.FamilyChildrenImport{}},
		{Method: "POST", Pattern: "/imports", Portals: traegerPortal, Multipart: true, MaxBodyBytes: importUploadBytes,
			TooLargeCode: common.CodeParentBillingFamilyChildrenImportFileTooLarge, Response: capability.FamilyChildrenImport{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "PUT", Pattern: "/", Portals: traegerPortal, Request: FamilyChildrenRequest{}, Response: capability.FamilyChildrenSet{}},
		{Method: "DELETE", Pattern: "/{contractId}", Portals: traegerPortal, Response: capability.FamilyChildrenSet{}},
	}
}

// BillingTermsRouteContracts registers the payment terms (#4689), relative
// to /traeger/billing-terms.
func BillingTermsRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: BillingTermsResponse{}},
		{Method: "PUT", Pattern: "/{service}", Portals: traegerPortal, Request: ServiceTermsRequest{}, Response: BillingTermsResponse{}},
	}
}

// FamilyBillingRouteContracts registers the family deviations, relative to
// /traeger/family-billing.
func FamilyBillingRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.FamilyBilling{}},
		{Method: "GET", Pattern: "/contracts/{id}", Portals: traegerPortal, Response: capability.ContractFamilyBilling{}},
		{Method: "PUT", Pattern: "/", Portals: traegerPortal, Request: FamilyBillingRequest{}, Response: FamilyBillingResponse{}},
	}
}

// DueDateRouteContracts registers the due dates of a run, relative to
// /traeger/billing-run-due-dates.
func DueDateRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "PUT", Pattern: "/care/{id}", Portals: traegerPortal, Request: RunDueDatesRequest{}, Response: RunDueDatesResponse{}},
		{Method: "PUT", Pattern: "/holiday/{id}", Portals: traegerPortal, Request: RunDueDatesRequest{}, Response: RunDueDatesResponse{}},
	}
}

// SEPACreditorRouteContracts registers the creditor (#4695), relative to
// /traeger/sepa-creditor.
func SEPACreditorRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: capability.SEPACreditor{}},
		{Method: "PUT", Pattern: "/", Portals: traegerPortal, Request: SEPACreditorRequest{}, Response: capability.SEPACreditor{}},
	}
}

// SEPAMandateRouteContracts registers the mandates, relative to
// /traeger/sepa-mandates. Imports take uploads and the export answers a
// file through the catalog (#2352).
func SEPAMandateRouteContracts() []common.RouteContract {
	contract := []common.QueryParam{{Name: "contract_id", Kind: common.QueryID}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: contract, Response: []capability.SEPAMandate{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: SEPAMandateRequest{}, Response: capability.SEPAMandate{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/imports", Portals: traegerPortal, Response: []capability.SEPAMandateImportEntry{}},
		{Method: "POST", Pattern: "/imports/preview", Portals: traegerPortal, Multipart: true, MaxBodyBytes: importUploadBytes,
			TooLargeCode: common.CodeParentBillingSepaImportFileTooLarge, NoCommit: "an import preview checks the file and saves no row of it", Response: capability.SEPAMandateImport{}},
		{Method: "POST", Pattern: "/imports", Portals: traegerPortal, Multipart: true, MaxBodyBytes: importUploadBytes,
			TooLargeCode: common.CodeParentBillingSepaImportFileTooLarge, Response: capability.SEPAMandateImport{}},
		{Method: "POST", Pattern: "/{id}/revoke", Portals: traegerPortal, Request: SEPAMandateRevokeRequest{}, Response: capability.SEPAMandate{}},
		{Method: "GET", Pattern: "/{id}/history", Portals: traegerPortal, Response: []capability.SEPAMandateEvent{}},
		{Method: "GET", Pattern: "/{id}/collections", Portals: traegerPortal, Response: []capability.SEPADebit{}},
	}
}

// SEPADebitRouteContracts registers the direct debits of a run (#4697),
// relative to /traeger/sepa-debits. The PAIN.008 answers a file (#2352).
func SEPADebitRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{kind}/{id}", Portals: traegerPortal, Response: capability.SEPADebitRun{}},
		{Method: "GET", Pattern: "/{kind}/{id}/file", Portals: traegerPortal, File: true},
		{Method: "POST", Pattern: "/{kind}/{id}/submission", Portals: traegerPortal, Request: SEPADebitSubmissionRequest{}, Response: capability.SEPADebitRun{}},
	}
}

// FinanceExportRouteContracts registers the finance exports and their
// protocol (#4693), relative to /traeger/finance-exports. The files and the
// exports answer files (#2352).
func FinanceExportRouteContracts() []common.RouteContract {
	offset := common.QueryParam{Name: "offset", Kind: common.QueryInt}
	run := []common.QueryParam{{Name: "run_kind", Kind: common.QueryString}, {Name: "run_id", Kind: common.QueryID}}
	files := append([]common.QueryParam{offset}, run...)
	runs := []common.QueryParam{{Name: "care", Kind: common.QueryString}, {Name: "holiday", Kind: common.QueryString}}
	datev := []common.QueryParam{{Name: "mode", Kind: common.QueryString, Values: []string{"new", "all"}}, {Name: "fiscal_year", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/settings", Portals: traegerPortal, Response: capability.ExportSettings{}},
		{Method: "PUT", Pattern: "/settings/sollstellung", Portals: traegerPortal, Request: SollstellungMappingRequest{}, Response: capability.ExportSettings{}},
		{Method: "DELETE", Pattern: "/settings/sollstellung", Portals: traegerPortal, Response: capability.ExportSettings{}},
		{Method: "PUT", Pattern: "/settings/file-number-start", Portals: traegerPortal, Request: FileNumberStartRequest{}, Response: capability.ExportSettings{}},
		{Method: "GET", Pattern: "/runs", Portals: traegerPortal, Query: []common.QueryParam{offset}, Response: capability.ExportRunPage{}},
		{Method: "GET", Pattern: "/datev-runs", Portals: traegerPortal, Query: runs, Response: capability.DatevRunOverviews{}},
		{Method: "GET", Pattern: "/files", Portals: traegerPortal, Query: files, Response: capability.ExportProtocolPage{}},
		{Method: "GET", Pattern: "/runs/export", Portals: traegerPortal, Query: listExport, File: true},
		{Method: "GET", Pattern: "/files/export", Portals: traegerPortal, Query: append(append([]common.QueryParam{}, listExport...), run...), File: true},
		{Method: "GET", Pattern: "/runs/{kind}/{id}/sollstellung", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/runs/{kind}/{id}/datev", Portals: traegerPortal, Query: datev, File: true},
		{Method: "GET", Pattern: "/booking-accounts", Portals: traegerPortal, Response: capability.BookingAccounts{}},
		{Method: "PUT", Pattern: "/booking-accounts/revenue-accounts", Portals: traegerPortal, Request: RevenueAccountRequest{}, Response: capability.BookingAccounts{}},
		{Method: "POST", Pattern: "/booking-accounts/cost-centers", Portals: traegerPortal, Request: CostCenterRequest{}, Response: capability.BookingAccounts{}},
		{Method: "DELETE", Pattern: "/booking-accounts/cost-centers/{id}", Portals: traegerPortal, Response: capability.BookingAccounts{}},
		{Method: "GET", Pattern: "/invoice-history/{kind}/{id}", Portals: traegerPortal, Response: capability.InvoiceHistory{}},
	}
}

// ExportHandoverRouteContracts registers the handover of a run's file to the
// recipient, relative to /traeger/finance-handovers.
func ExportHandoverRouteContracts() []common.RouteContract {
	var routes []common.RouteContract
	for _, format := range []string{"sollstellung", "datev", "pain008"} {
		routes = append(routes, common.RouteContract{Method: "POST", Pattern: "/runs/{kind}/{id}/" + format, Portals: traegerPortal,
			Request: HandoverRequestBody{}, Response: capability.HandoverResult{}})
	}
	return routes
}

// BelegRetentionRouteContracts registers the operator's view and changes of
// the Beleg retention of a Träger (ADR 0270, #2352), with patterns relative
// to the /operator/organizations/{id}/beleg-retention mount.
func BelegRetentionRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "", Portals: operator, Response: capability.BelegRetentionOverview{}},
		{Method: "POST", Pattern: "/instructions", Portals: operator, Request: instructionRequest{}, Response: capability.RetentionInstruction{}},
		{Method: "POST", Pattern: "/suspensions", Portals: operator, Request: suspensionRequest{}, Response: capability.RetentionSuspension{}},
		{Method: "DELETE", Pattern: "/suspensions/{suspensionId}", Portals: operator, NoData: true},
		{Method: "POST", Pattern: "/clarification-reviews", Portals: operator, Request: clarificationReviewRequest{}, Response: capability.BelegClarificationReview{}},
	}
}
