package transfer_test

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"orbit/internal/config"
	"orbit/internal/db"
	"orbit/internal/kernel"
	"orbit/internal/plugins/transfer"
)

func TestParallelChunkedUploadAndIntegrity(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Config{
		Addr:         "127.0.0.1:0",
		DataDir:      dir,
		JWTSecret:    []byte("test-secret-0123456789abcdef0123456789"),
		LANMaxMB:     0,
		TSMaxMB:      2048,
		WANMaxMB:     100,
		MaxStorageMB: 0,
	}
	conn, err := db.Open(dir)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer conn.Close()

	k := kernel.New(conn, &cfg)
	if err := k.Register(transfer.New()); err != nil {
		t.Fatalf("register transfer: %v", err)
	}
	h := k.Routes()

	// Setup admin
	setupBody := bytes.NewBufferString(`{"username":"admin","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", setupBody)
	req.RemoteAddr = "192.168.1.20:54321"
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup failed: %d %s", rr.Code, rr.Body.String())
	}
	cookies := rr.Result().Cookies()

	// Prepare a 5 MB random payload and upload in 4 parallel out-of-order chunks
	const totalSize = 5 * 1024 * 1024
	rawData := make([]byte, totalSize)
	if _, err := rand.Read(rawData); err != nil {
		t.Fatalf("rand read: %v", err)
	}
	wantHash := sha256.Sum256(rawData)

	initPayload, _ := json.Marshal(map[string]any{
		"file_name": "big-lan-test.bin",
		"size":      totalSize,
		"mime_type": "application/octet-stream",
		"ttl_hours": 24,
	})
	initReq := httptest.NewRequest(http.MethodPost, "/api/files/upload/init", bytes.NewReader(initPayload))
	initReq.RemoteAddr = "192.168.1.20:54321"
	initReq.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		initReq.AddCookie(c)
	}
	initRR := httptest.NewRecorder()
	h.ServeHTTP(initRR, initReq)
	if initRR.Code != http.StatusOK {
		t.Fatalf("init failed: %d %s", initRR.Code, initRR.Body.String())
	}
	var initRes struct {
		UploadID  string `json:"upload_id"`
		ChunkSize int64  `json:"chunk_size"`
	}
	_ = json.Unmarshal(initRR.Body.Bytes(), &initRes)
	if initRes.UploadID == "" || initRes.ChunkSize <= 0 {
		t.Fatalf("unexpected init res: %+v", initRes)
	}

	// Upload 4 concurrent slices out-of-order
	partSize := totalSize / 4
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 3; i >= 0; i-- {
		offset := i * partSize
		end := offset + partSize
		if i == 3 {
			end = totalSize
		}
		wg.Add(1)
		go func(off, en int) {
			defer wg.Done()
			cReq := httptest.NewRequest(
				http.MethodPut,
				fmt.Sprintf("/api/files/upload/%s/chunk?offset=%d", initRes.UploadID, off),
				bytes.NewReader(rawData[off:en]),
			)
			cReq.RemoteAddr = "192.168.1.20:54321"
			cReq.Header.Set("Content-Type", "application/octet-stream")
			for _, c := range cookies {
				cReq.AddCookie(c)
			}
			cRR := httptest.NewRecorder()
			h.ServeHTTP(cRR, cReq)
			if cRR.Code != http.StatusOK {
				errs <- fmt.Errorf("chunk off=%d status=%d body=%s", off, cRR.Code, cRR.Body.String())
			}
		}(offset, end)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}

	// Complete upload
	compReq := httptest.NewRequest(http.MethodPost, "/api/files/upload/"+initRes.UploadID+"/complete", nil)
	compReq.RemoteAddr = "192.168.1.20:54321"
	for _, c := range cookies {
		compReq.AddCookie(c)
	}
	compRR := httptest.NewRecorder()
	h.ServeHTTP(compRR, compReq)
	if compRR.Code != http.StatusCreated {
		t.Fatalf("complete failed: %d %s", compRR.Code, compRR.Body.String())
	}
	var compRes struct {
		File struct {
			ID        int64  `json:"id"`
			OrigName  string `json:"orig_name"`
			SizeBytes int64  `json:"size_bytes"`
		} `json:"file"`
	}
	_ = json.Unmarshal(compRR.Body.Bytes(), &compRes)
	if compRes.File.ID == 0 || compRes.File.SizeBytes != totalSize || compRes.File.OrigName != "big-lan-test.bin" {
		t.Fatalf("unexpected completed file: %+v", compRes.File)
	}

	// Download back and verify exact SHA-256 byte integrity
	dlReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/files/%d/download", compRes.File.ID), nil)
	dlReq.RemoteAddr = "192.168.1.20:54321"
	for _, c := range cookies {
		dlReq.AddCookie(c)
	}
	dlRR := httptest.NewRecorder()
	h.ServeHTTP(dlRR, dlReq)
	if dlRR.Code != http.StatusOK {
		t.Fatalf("download failed: %d", dlRR.Code)
	}
	gotHash := sha256.Sum256(dlRR.Body.Bytes())
	if gotHash != wantHash {
		t.Fatalf("sha256 mismatch after parallel chunked upload")
	}
}
