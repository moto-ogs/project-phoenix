package parentbillinghttp

type NumberRangeTakenDetails struct {
	LastNumber   string `json:"last_number"`
	LastSequence int64  `json:"last_sequence" contract:"number"`
}

type PaymentTextDebtorDetails struct {
	Count          int      `json:"count"`
	InvoiceNumbers []string `json:"invoice_numbers"`
}
