package parentbillinghttp

import (
	"net/http"
	"slices"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The lists of the export page as files (#4718): the released runs with
// their last files and the protocol of every file that left moto. Neither
// names a family; the protocol leaves out who downloaded a file.

var financeFileKinds = map[string]string{
	capability.ExportFormatSollstellung: "Sollstellung", capability.ExportFormatPain008: "Lastschrift", capability.ExportFormatDatev: "DATEV",
}

// exportRuns answers GET /traeger/finance-exports/runs/export: every
// released run, not one page.
func (rs *FinanceExportResource) exportRuns(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	runs, err := rs.exports.ExportRuns(r.Context(), reviewer, capability.ExportPage{All: true})
	if err != nil {
		renderExportError(w, r, err)
		return
	}
	table := newListTable("Dateien je Lauf", "exportlaeufe", false,
		column("run", "Lauf"), column("issued", "Ausgestellt am"), column("invoices", "Rechnungen"), column("total", "Summe"),
		column("sollstellung", "Letzte Sollstellung"), column("datev", "DATEV-Datei"), column("files", "Dateien"))
	for _, run := range runs.Runs {
		table.Rows = append(table.Rows, []string{
			run.Label, dateText(run.IssuedOn), strconv.Itoa(run.InvoiceCount), euroText(run.TotalCents),
			lastFileText(run.LastSollstellung), lastFileText(run.LastDatev), strconv.Itoa(run.Exports),
		})
	}
	if len(runs.Runs) < runs.Total {
		table.Filters = append(slices.Clone(table.Filters), common.ListCutNote(capability.MaxExportListRows))
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// lastFileText is „Nr. 12 vom 09.11.2026 15:34“, „–“ before the first.
func lastFileText(entry *capability.ExportProtocolEntry) string {
	if entry == nil {
		return "–"
	}
	return "Nr. " + strconv.FormatInt(entry.FileNumber, 10) + " vom " + instantText(&entry.ExportedAt)
}

// exportFiles answers GET /traeger/finance-exports/files/export: the whole
// protocol, of one run with run_kind and run_id like the list.
func (rs *FinanceExportResource) exportFiles(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	kind, runID, ok := protocolRun(w, r)
	if !ok {
		return
	}
	files, err := rs.exports.ExportProtocol(r.Context(), reviewer, kind, runID, capability.ExportPage{All: true})
	if err != nil {
		renderExportError(w, r, err)
		return
	}
	table := newListTable("Exportprotokoll", "exportprotokoll", false,
		column("number", "Nr."), column("file", "Datei"), column("run", "Lauf"), column("kind", "Art"),
		column("invoices", "Rechnungen"), column("total", "Summe"), column("exported", "Heruntergeladen"))
	for _, file := range files.Files {
		if runID > 0 {
			table.Subtitle = file.RunLabel
		}
		table.Rows = append(table.Rows, []string{
			strconv.FormatInt(file.FileNumber, 10), file.FileName, file.RunLabel, financeFileKinds[file.Format],
			strconv.Itoa(file.InvoiceCount), euroText(file.TotalCents), instantText(&file.ExportedAt),
		})
	}
	if len(files.Files) < files.Total {
		table.Filters = append(slices.Clone(table.Filters), common.ListCutNote(capability.MaxExportListRows))
	}
	common.WriteList(w, r, rs.lists, format, table)
}
