package parentbillinghttp

type BillingIssuerDetails struct {
	IssuerKey  string `json:"issuer_key"`
	IssuerName string `json:"issuer_name"`
}

type NumberRangeMissingDetails struct {
	BillingIssuerDetails
	Service string `json:"service"`
}

type NumberRangeTakenDetails struct {
	LastNumber   string `json:"last_number"`
	LastSequence int64  `json:"last_sequence" contract:"number"`
}

type PaymentTextDebtorDetails struct {
	Count          int      `json:"count"`
	InvoiceNumbers []string `json:"invoice_numbers"`
}
