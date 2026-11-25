package config

import "testing"

func TestLoadUploadLimits(t *testing.T) {
	t.Setenv("ORBIT_DATA_DIR", t.TempDir())
	t.Setenv("ORBIT_LAN_MAX_MB", "")
	t.Setenv("ORBIT_TS_MAX_MB", "")
	t.Setenv("ORBIT_WAN_MAX_MB", "")
	t.Setenv("ORBIT_MAX_STORAGE_MB", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() default failed: %v", err)
	}
	if cfg.LANMaxMB != 0 {
		t.Fatalf("default LANMaxMB = %d, want 0 (unlimited)", cfg.LANMaxMB)
	}
	if cfg.TSMaxMB != 2048 || cfg.WANMaxMB != 100 || cfg.MaxStorageMB != 20480 {
		t.Fatalf("unexpected defaults: ts=%d wan=%d storage=%d", cfg.TSMaxMB, cfg.WANMaxMB, cfg.MaxStorageMB)
	}

	t.Setenv("ORBIT_LAN_MAX_MB", "512")
	t.Setenv("ORBIT_TS_MAX_MB", "0")
	t.Setenv("ORBIT_WAN_MAX_MB", "unlimited")
	t.Setenv("ORBIT_MAX_STORAGE_MB", "-1")

	cfg2, err := Load()
	if err != nil {
		t.Fatalf("Load() custom failed: %v", err)
	}
	if cfg2.LANMaxMB != 512 {
		t.Fatalf("custom LANMaxMB = %d, want 512", cfg2.LANMaxMB)
	}
	if cfg2.TSMaxMB != 0 || cfg2.WANMaxMB != 0 || cfg2.MaxStorageMB != 0 {
		t.Fatalf("explicit unlimited failed: ts=%d wan=%d storage=%d", cfg2.TSMaxMB, cfg2.WANMaxMB, cfg2.MaxStorageMB)
	}
}
