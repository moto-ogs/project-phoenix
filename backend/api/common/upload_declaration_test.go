package common

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// declaredUploadRequest sends one file part with the declared type and the
// file name exactly as given; Go's writer would escape a backslash.
func declaredUploadRequest(t *testing.T, fieldName, filename, declared string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	header := map[string][]string{
		"Content-Disposition": {fmt.Sprintf(`form-data; name=%q; filename="%s"`, fieldName, filename)},
	}
	if declared != "" {
		header["Content-Type"] = []string{declared}
	}
	part, err := writer.CreatePart(header)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	req := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func makePNGBytes(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewGray(image.Rect(0, 0, 1, 1))))
	return buf.Bytes()
}

// The uploads that left the frontend server's checks (#2352) refuse what
// that server refused: a declared type outside the route's list, an
// extension that does not name the content, and a file name with a path.
func TestDeclared_RefusesWhatTheFrontendServerRefused(t *testing.T) {
	t.Parallel()

	pngBytes := makePNGBytes(t)
	docx := makeZIP(t, map[string]string{"[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>"})
	cases := []struct {
		name     string
		parse    UploadParser
		filename string
		declared string
		content  []byte
		code     string
	}{
		{"image", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto.png", "image/png", pngBytes, ""},
		{"image declared as html", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto.png", "text/html", pngBytes, CodeFilesFileTypeNotAllowed},
		{"image declared as gif", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto.png", "image/gif", pngBytes, CodeFilesFileTypeNotAllowed},
		{"image without extension", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto", "image/png", pngBytes, CodeFilesFileTypeNotAllowed},
		{"image named html", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto.html", "image/png", pngBytes, CodeFilesFileTypeNotAllowed},
		{"image named jpg", Declared(ParseImageWithLimits, DeclaredImageTypes), "foto.jpg", "image/png", pngBytes, CodeFilesFileTypeNotAllowed},
		{"pdf", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "AGB.PDF", "application/pdf; name=AGB.pdf", makePDFBytes(), ""},
		{"pdf undeclared", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "AGB.pdf", "", makePDFBytes(), CodeFilesFileTypeNotAllowed},
		{"pdf named txt", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "AGB.txt", "application/pdf", makePDFBytes(), CodeFilesFileTypeNotAllowed},
		{"pdf with parent path", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "../AGB.pdf", "application/pdf", makePDFBytes(), CodeFilesFileNameInvalid},
		{"pdf with directory", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "akten/AGB.pdf", "application/pdf", makePDFBytes(), CodeFilesFileNameInvalid},
		{"pdf with backslash", Declared(ParsePDFWithLimits, DeclaredPDFTypes), `akten\AGB.pdf`, "application/pdf", makePDFBytes(), CodeFilesFileNameInvalid},
		{"pdf with two dots", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "AGB..pdf", "application/pdf", makePDFBytes(), CodeFilesFileNameInvalid},
		{"pdf with dotted name", Declared(ParsePDFWithLimits, DeclaredPDFTypes), "AGB.2026.v2.pdf", "application/pdf", makePDFBytes(), ""},
		{"scan undeclared", Declared(ParseScanWithLimits, DeclaredScanTypes), "scan.pdf", "", makePDFBytes(), ""},
		{"scan as octet stream", Declared(ParseScanWithLimits, DeclaredScanTypes), "scan.png", "application/octet-stream", pngBytes, ""},
		{"scan declared as docx", Declared(ParseScanWithLimits, DeclaredScanTypes), "scan.pdf", DocxContentType, makePDFBytes(), CodeFilesFileTypeNotAllowed},
		{"scan is a word file", Declared(ParseScanWithLimits, DeclaredScanTypes), "scan.docx", "application/octet-stream", docx, CodeFilesFileTypeNotAllowed},
		{"document as zip", Declared(ParseDocumentWithLimits, DeclaredDocumentTypes), "brief.docx", "application/zip", docx, ""},
		{"document declared as xlsx", Declared(ParseDocumentWithLimits, DeclaredDocumentTypes), "brief.docx", XlsxContentType, docx, CodeFilesFileTypeNotAllowed},
		{"office declared as xlsx", Declared(ParseOfficeFileWithLimits, DeclaredOfficeTypes), "brief.docx", XlsxContentType, docx, ""},
		{"office declared as html", Declared(ParseOfficeFileWithLimits, DeclaredOfficeTypes), "brief.docx", "text/html", docx, CodeFilesFileTypeNotAllowed},
	}
	for _, tc := range cases {
		req := declaredUploadRequest(t, "file", tc.filename, tc.declared, tc.content)
		uploaded, err := tc.parse(httptest.NewRecorder(), req, "file", 10<<20, 10<<20+4096)
		if tc.code == "" {
			require.NoError(t, err, tc.name)
			CloseFile(uploaded.File)
			continue
		}
		require.Error(t, err, tc.name)
		assert.Equal(t, tc.code, UploadRefusalCode(err), tc.name)
	}
}

// The image and PDF parsers answer their refusals with the upload codes the
// form explains, not with a bare invalid request.
func TestParseImageAndPDF_RefuseWithUploadCodes(t *testing.T) {
	t.Parallel()

	req := declaredUploadRequest(t, "file", "foto.png", "image/png", makePNGBytes(t))
	_, err := ParseImageWithLimits(httptest.NewRecorder(), req, "file", 10, 10<<20)
	assert.Equal(t, CodeFilesFileTooLarge, UploadRefusalCode(err))
	resp, ok := UploadRefusalRenderer(err)
	require.True(t, ok)
	assert.Equal(t, SizeLimitDetails{MaxMB: 1}, resp.(*ErrResponse).Details)

	req = declaredUploadRequest(t, "file", "AGB.pdf", "application/pdf", bytes.Repeat([]byte("%PDF"), 4096))
	_, err = ParsePDFWithLimits(httptest.NewRecorder(), req, "file", 10<<20, 1024)
	assert.Equal(t, CodeFilesFileTooLarge, UploadRefusalCode(err), "a body over its cap is a size refusal")

	req = declaredUploadRequest(t, "other", "AGB.pdf", "application/pdf", makePDFBytes())
	_, err = ParsePDFWithLimits(httptest.NewRecorder(), req, "file", 10<<20, 10<<20)
	assert.Equal(t, CodeFilesFileMissing, UploadRefusalCode(err))

	req = declaredUploadRequest(t, "file", "foto.png", "image/png", makePDFBytes())
	_, err = ParseImageWithLimits(httptest.NewRecorder(), req, "file", 10<<20, 10<<20)
	assert.Equal(t, CodeFilesFileTypeNotAllowed, UploadRefusalCode(err))

	_, ok = UploadRefusalRenderer(assert.AnError)
	assert.False(t, ok)
}
