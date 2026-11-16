// Package qrmatrix encodes a text as the modules of a QR code (#4818). It
// is the one package of Document Rendering that holds the QR library; the
// letter layout draws the modules it returns.
package qrmatrix

import (
	"fmt"

	"github.com/boombuler/barcode/qr"
)

// Modules encodes payload as UTF-8 bytes with error correction M, the
// level EPC069-12 asks for, and returns its dark modules row by row,
// without the quiet zone. A payload too long for a QR code is an error.
func Modules(payload string) ([][]bool, error) {
	code, err := qr.Encode(payload, qr.M, qr.Unicode)
	if err != nil {
		return nil, fmt.Errorf("qr code: %w", err)
	}
	size := code.Bounds().Dx()
	modules := make([][]bool, size)
	for y := range size {
		modules[y] = make([]bool, size)
		for x := range size {
			r, _, _, _ := code.At(x, y).RGBA()
			modules[y][x] = r < 0x8000
		}
	}
	return modules, nil
}
