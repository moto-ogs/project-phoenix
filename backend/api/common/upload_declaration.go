package common

import (
	"errors"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/go-chi/render"
)

// UploadParser reads and checks the file of a multipart upload: field name,
// advertised file cap and body cap. The caller closes UploadedFile.File.
type UploadParser func(w http.ResponseWriter, r *http.Request, fieldName string, maxFileSize, maxBodySize int64) (*UploadedFile, error)

// The MIME types a browser may declare for a file part (#2352). The content
// check decides what the file is; the declaration is checked on top of it,
// as the frontend server did before these uploads went straight to the
// backend. An empty or generic type is what some browsers send for a valid
// PDF or scan, and browsers without the OOXML mapping label an Office file
// as a plain ZIP; the extension and the content still decide those.
var (
	DeclaredImageTypes    = declaredTypes("image/jpeg", "image/jpg", "image/png", "image/webp")
	DeclaredPDFTypes      = declaredTypes("application/pdf")
	DeclaredScanTypes     = declaredTypes("", "application/octet-stream", "application/pdf", "image/png", "image/jpeg", "image/jpg")
	DeclaredDocumentTypes = mergeDeclaredTypes(DeclaredScanTypes,
		declaredTypes(DocxContentType, "application/zip", "application/x-zip-compressed"))
	DeclaredOfficeTypes = mergeDeclaredTypes(DeclaredDocumentTypes, declaredTypes(XlsxContentType, PptxContentType))
)

func declaredTypes(types ...string) map[string]bool {
	out := make(map[string]bool, len(types))
	for _, t := range types {
		out[t] = true
	}
	return out
}

func mergeDeclaredTypes(sets ...map[string]bool) map[string]bool {
	out := map[string]bool{}
	for _, set := range sets {
		for t := range set {
			out[t] = true
		}
	}
	return out
}

// Declared wraps parse so it also refuses a file whose declared MIME type is
// not in allowed, whose name the browser sent with a path (`..`, `/`, `\`),
// or whose extension does not name its detected content. The parser checks
// size and content first. A refused file is closed.
func Declared(parse UploadParser, allowed map[string]bool) UploadParser {
	return func(w http.ResponseWriter, r *http.Request, fieldName string, maxFileSize, maxBodySize int64) (*UploadedFile, error) {
		uploaded, err := parse(w, r, fieldName, maxFileSize, maxBodySize)
		if err != nil {
			return nil, err
		}
		if err := checkDeclaration(uploaded, allowed); err != nil {
			CloseFile(uploaded.File)
			return nil, err
		}
		return uploaded, nil
	}
}

func checkDeclaration(uploaded *UploadedFile, allowed map[string]bool) error {
	if !allowed[uploaded.DeclaredType] {
		return uploadRefusal{code: CodeFilesFileTypeNotAllowed, text: "declared file type " + uploaded.DeclaredType + " is not allowed"}
	}
	if !ExtensionMatchesContent(uploaded.Filename, uploaded.ContentType) {
		return uploadRefusal{code: CodeFilesFileTypeNotAllowed, text: "file extension does not match the file content"}
	}
	name := uploaded.ClientFilename
	if strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return uploadRefusal{code: CodeFilesFileNameInvalid, text: "invalid filename"}
	}
	return nil
}

// declaredType is the part's Content-Type as the browser sent it, lower case
// and without parameters; "" when it sent none.
func declaredType(header *multipart.FileHeader) string {
	raw := strings.TrimSpace(header.Header.Get("Content-Type"))
	if raw == "" {
		return ""
	}
	mediaType, _, err := mime.ParseMediaType(raw)
	if err != nil {
		return strings.ToLower(raw)
	}
	return mediaType
}

// clientFilename is the file name as the browser sent it. FileHeader.Filename
// drops a directory part, so a name with a path would pass unseen.
func clientFilename(header *multipart.FileHeader) string {
	_, params, err := mime.ParseMediaType(header.Header.Get("Content-Disposition"))
	if err != nil {
		return header.Filename
	}
	return params["filename"]
}

// UploadRefusalCode is the code of a refused upload, "" for any other error.
func UploadRefusalCode(err error) string {
	var refusal uploadRefusal
	if errors.As(err, &refusal) {
		return refusal.code
	}
	return ""
}

// UploadRefusalRenderer renders a refused upload with its code and, for the
// size refusal, the limit the parser ran into. ok is false for other errors.
func UploadRefusalRenderer(err error) (render.Renderer, bool) {
	var refusal uploadRefusal
	if !errors.As(err, &refusal) {
		return nil, false
	}
	return ErrorUpload(err, refusal.maxFile), true
}
