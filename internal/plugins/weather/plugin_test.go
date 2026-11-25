package weather

import "testing"

func TestStripChineseAdminSuffix(t *testing.T) {
	cases := map[string]string{
		"浦东新区": "浦东",
		"余杭区":  "余杭",
		"深圳市":  "深圳",
		"上海":   "上海",
		"西区":   "西区",
	}
	for in, want := range cases {
		if got := stripChineseAdminSuffix(in); got != want {
			t.Fatalf("stripChineseAdminSuffix(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseCMALocation(t *testing.T) {
	loc := parseCMALocation("59493", "深圳", "中国, 广东, 深圳", 22.54, 114.0)
	if loc.Name != "深圳" || loc.StationID != "59493" || loc.Admin != "广东" {
		t.Fatalf("unexpected location: %+v", loc)
	}
	if loc.DisplayName != "深圳 · 广东" {
		t.Fatalf("DisplayName = %q, want %q", loc.DisplayName, "深圳 · 广东")
	}
}

func TestMapCaiyunAndCMACodes(t *testing.T) {
	cond, kind, isDay := mapCaiyunSkycon("CLEAR_DAY")
	if cond != "晴朗" || kind != "clear" || !isDay {
		t.Fatalf("unexpected CLEAR_DAY: %q %q %v", cond, kind, isDay)
	}
	cond, kind, _ = mapCaiyunSkycon("STORM_RAIN")
	if kind != "storm" || cond == "" {
		t.Fatalf("unexpected STORM_RAIN: %q %q", cond, kind)
	}
	cCond, cKind, cPP := mapCMACode(7, "小雨")
	if cCond != "小雨" || cKind != "rain" || cPP < 50 {
		t.Fatalf("unexpected CMA code 7: %q %q %d", cCond, cKind, cPP)
	}
	if cmaNameMatches("上海", "上党", "Shangdang") {
		t.Fatalf("上海 must not match 上党")
	}
	if !cmaNameMatches("余杭", "余杭", "Yuhang") {
		t.Fatalf("余杭 must match 余杭")
	}
	if loc, ok := lookupMajorCMA("上海"); !ok || loc.StationID != "58367" {
		t.Fatalf("expected major station 58367 for 上海, got %+v ok=%v", loc, ok)
	}
}
