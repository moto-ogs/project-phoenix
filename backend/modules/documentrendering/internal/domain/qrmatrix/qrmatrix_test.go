package qrmatrix

import (
	"image"
	"image/color"
	"testing"

	"github.com/makiuchi-d/gozxing"
	gozxingqr "github.com/makiuchi-d/gozxing/qrcode"
)

const samplePayload = "BCD\n002\n1\nSCT\nBYLADEM1001\nFörderverein Ganztag e.V.\nDE02120300000000202051\nEUR92.50\n\n\nFE-2026-0007 Buchungszeichen 5.0311.000123.4"

// The modules decode to the payload byte for byte, the umlauts of the
// name included, with error correction M, and the reader needs no hint on
// the character set: a banking app reads what the letter carries.
func TestModulesDecodeToThePayload(t *testing.T) {
	t.Parallel()

	modules, err := Modules(samplePayload)
	if err != nil {
		t.Fatal(err)
	}
	const scale, quiet = 4, 4
	size := (len(modules) + 2*quiet) * scale
	img := image.NewGray(image.Rect(0, 0, size, size))
	for i := range img.Pix {
		img.Pix[i] = 0xFF
	}
	for row, line := range modules {
		for col, dark := range line {
			if !dark {
				continue
			}
			for dy := range scale {
				for dx := range scale {
					img.Set((col+quiet)*scale+dx, (row+quiet)*scale+dy, color.Black)
				}
			}
		}
	}
	bitmap, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		t.Fatal(err)
	}
	result, err := gozxingqr.NewQRCodeReader().Decode(bitmap, nil)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.GetText() != samplePayload {
		t.Fatalf("decoded\n%q\nwant\n%q", result.GetText(), samplePayload)
	}
	level, _ := result.GetResultMetadata()[gozxing.ResultMetadataType_ERROR_CORRECTION_LEVEL].(string)
	if level != "M" {
		t.Fatalf("error correction %q, want M as EPC069-12 asks", level)
	}
}

// A payload too long for a QR code is refused.
func TestModulesRefuseAnUnencodablePayload(t *testing.T) {
	t.Parallel()

	if _, err := Modules(string(make([]byte, 3000))); err == nil {
		t.Fatal("encoded 3000 bytes")
	}
}
