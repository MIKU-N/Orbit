package monitor

import (
	"bufio"
	"context"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"orbit/internal/plugin"
)

type DiskInfo struct {
	Mount      string  `json:"mount"`
	Device     string  `json:"device"`
	TotalBytes uint64  `json:"total_bytes"`
	UsedBytes  uint64  `json:"used_bytes"`
	Percent    float64 `json:"percent"`
}

type SystemMetrics struct {
	CPUPercent    float64    `json:"cpu_percent"`
	CPUHistory    []float64  `json:"cpu_history"`
	CPUCores      int        `json:"cpu_cores"`
	CPUModel      string     `json:"cpu_model"`
	CPUTempC      *float64   `json:"cpu_temp_c"`
	RAMUsedBytes  uint64     `json:"ram_used_bytes"`
	RAMTotalBytes uint64     `json:"ram_total_bytes"`
	RAMPercent    float64    `json:"ram_percent"`
	SwapUsedBytes uint64     `json:"swap_used_bytes"`
	SwapTotal     uint64     `json:"swap_total_bytes"`
	SwapPercent   float64    `json:"swap_percent"`
	DiskUsedBytes uint64     `json:"disk_used_bytes"`
	DiskTotal     uint64     `json:"disk_total_bytes"`
	DiskPercent   float64    `json:"disk_percent"`
	DiskMount     string     `json:"disk_mount"`
	Mounts        []DiskInfo `json:"mounts"`
	NetUpBPS      float64    `json:"net_up_bps"`
	NetDownBPS    float64    `json:"net_down_bps"`
	NetRxTotal    uint64     `json:"net_rx_total_bytes"`
	NetTxTotal    uint64     `json:"net_tx_total_bytes"`
	Load1         float64    `json:"load1"`
	Load5         float64    `json:"load5"`
	Load15        float64    `json:"load15"`
	UptimeSeconds uint64     `json:"uptime_seconds"`
	Processes     int        `json:"processes"`
	OSName        string     `json:"os_name"`
	Kernel        string     `json:"kernel"`
	Arch          string     `json:"arch"`
	LANIP         string     `json:"lan_ip"`
	TailscaleIP   string     `json:"tailscale_ip"`
	OrbitAllocMB  float64    `json:"orbit_alloc_mb"`
	OrbitSysMB    float64    `json:"orbit_sys_mb"`
	Hostname      string     `json:"hostname"`
}

type Plugin struct {
	host      plugin.Host
	dataDir   string
	cpuModel  string
	osName    string
	kernel    string
	mu        sync.RWMutex
	latest    SystemMetrics
	prevTotal uint64
	prevIdle  uint64
	prevRx    uint64
	prevTx    uint64
	prevAt    time.Time
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.monitor",
		Name:           "节点监控",
		Version:        "1.0.0",
		Description:    "宿主机 CPU、内存、Swap、多盘挂载点、温度与网络吞吐实时遥测",
		Icon:           "cpu",
		Tier:           "core",
		Source:         "official",
		DefaultEnabled: true,
		Style: &plugin.StyleSpec{
			Managed:          true,
			SupportsCardless: true,
		},
		Access: plugin.AccessSpec{
			MinRole: "user",
			Guest:   plugin.GuestSpec{Mode: "hidden"},
			Sharing: &plugin.SharingSpec{
				Shareable:     true,
				ScopeKey:      "monitor",
				Label:         "监控",
				DefaultShared: false,
				Mode:          "readonly",
			},
			Permissions: []string{"sys:metrics"},
		},
		Contributes: plugin.ContributesSpec{
			Widgets: []plugin.WidgetContrib{
				{
					ID:             "main",
					LayoutKey:      "monitor",
					Label:          "监控",
					MinW:           300,
					DefaultW:       540,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
			Settings: &plugin.SettingsContrib{
				TabID:          "monitor",
				Label:          "系统监控",
				Icon:           "cpu",
				SearchKeywords: []string{"监控", "系统", "磁盘", "挂载点", "cpu", "内存", "swap", "负载", "温度", "网速", "ip"},
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	p.dataDir = host.Config().DataDir
	hostName, _ := os.Hostname()
	if hostName == "" {
		hostName = "Orbit-Node"
	}
	p.cpuModel = readCPUModel()
	p.osName = readOSName()
	p.kernel = readKernelRelease()
	p.latest = SystemMetrics{
		Hostname:   hostName,
		CPUCores:   runtime.NumCPU(),
		CPUModel:   p.cpuModel,
		OSName:     p.osName,
		Kernel:     p.kernel,
		Arch:       runtime.GOARCH,
		CPUHistory: make([]float64, 0, 16),
	}
	p.sampleOnce()
	host.Schedule(2*time.Second, func(ctx context.Context) {
		p.sampleOnce()
	})
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /metrics", p.handleMetrics)
	r.HandleCompat("GET /api/system/metrics", p.handleMetrics, true)
}

func (p *Plugin) handleMetrics(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	if u != nil && u.Role != "admin" && !p.host.Auth().HasShareScope(u, "monitor") {
		plugin.WriteErr(w, http.StatusForbidden, "未开启系统监控共享权限")
		return
	}
	snap := p.snapshot()
	if reqMount := strings.TrimSpace(r.URL.Query().Get("mount")); reqMount != "" {
		for _, di := range snap.Mounts {
			if di.Mount == reqMount {
				snap.DiskMount = di.Mount
				snap.DiskTotal = di.TotalBytes
				snap.DiskUsedBytes = di.UsedBytes
				snap.DiskPercent = di.Percent
				break
			}
		}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"metrics": snap})
}

func (p *Plugin) snapshot() SystemMetrics {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := p.latest
	out.CPUHistory = append([]float64(nil), p.latest.CPUHistory...)
	out.Mounts = append([]DiskInfo(nil), p.latest.Mounts...)
	return out
}

func (p *Plugin) sampleOnce() {
	now := time.Now()
	totalCPU, idleCPU := readProcCPU()
	rxBytes, txBytes := readProcNet()
	ramTotal, ramUsed, swapTotal, swapUsed := readProcMem()
	mounts := readDiskMounts(p.dataDir)
	diskTotal, diskUsed := readDiskUsage(p.dataDir)
	diskMount := "/"
	if len(mounts) > 0 {
		for _, di := range mounts {
			if di.Mount == "/" {
				diskMount = "/"
				diskTotal, diskUsed = di.TotalBytes, di.UsedBytes
				break
			}
		}
		if diskTotal == 0 {
			diskMount = mounts[0].Mount
			diskTotal, diskUsed = mounts[0].TotalBytes, mounts[0].UsedBytes
		}
	}
	load1, load5, load15 := readLoads()
	uptime := readUptime()
	procs := readProcessCount()
	tempC := readCPUTemp()
	lanIP, tsIP := readHostIPs()

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	p.mu.Lock()
	defer p.mu.Unlock()

	var cpuPct float64
	if p.prevTotal > 0 && totalCPU > p.prevTotal {
		dt := float64(totalCPU - p.prevTotal)
		di := float64(idleCPU - p.prevIdle)
		if dt > 0 {
			cpuPct = math.Min(100, math.Max(0, ((dt-di)/dt)*100))
		}
	}

	var upBPS, downBPS float64
	if !p.prevAt.IsZero() {
		if el := now.Sub(p.prevAt).Seconds(); el > 0.1 {
			if txBytes >= p.prevTx {
				upBPS = float64(txBytes-p.prevTx) / el
			}
			if rxBytes >= p.prevRx {
				downBPS = float64(rxBytes-p.prevRx) / el
			}
		}
	}

	p.prevTotal, p.prevIdle, p.prevRx, p.prevTx, p.prevAt = totalCPU, idleCPU, rxBytes, txBytes, now
	hist := append(p.latest.CPUHistory, round1(cpuPct))
	if len(hist) > 16 {
		hist = hist[len(hist)-16:]
	}

	var ramPct, swapPct, diskPct float64
	if ramTotal > 0 {
		ramPct = float64(ramUsed) / float64(ramTotal) * 100
	}
	if swapTotal > 0 {
		swapPct = float64(swapUsed) / float64(swapTotal) * 100
	}
	if diskTotal > 0 {
		diskPct = float64(diskUsed) / float64(diskTotal) * 100
	}

	p.latest.CPUPercent = round1(cpuPct)
	p.latest.CPUHistory = hist
	p.latest.CPUCores = runtime.NumCPU()
	p.latest.CPUModel = p.cpuModel
	p.latest.CPUTempC = tempC
	p.latest.RAMUsedBytes = ramUsed
	p.latest.RAMTotalBytes = ramTotal
	p.latest.RAMPercent = round1(ramPct)
	p.latest.SwapUsedBytes = swapUsed
	p.latest.SwapTotal = swapTotal
	p.latest.SwapPercent = round1(swapPct)
	p.latest.DiskUsedBytes = diskUsed
	p.latest.DiskTotal = diskTotal
	p.latest.DiskPercent = round1(diskPct)
	p.latest.DiskMount = diskMount
	p.latest.Mounts = mounts
	p.latest.NetUpBPS = upBPS
	p.latest.NetDownBPS = downBPS
	p.latest.NetRxTotal = rxBytes
	p.latest.NetTxTotal = txBytes
	p.latest.Load1, p.latest.Load5, p.latest.Load15 = load1, load5, load15
	p.latest.UptimeSeconds = uptime
	p.latest.Processes = procs
	p.latest.OSName, p.latest.Kernel, p.latest.Arch = p.osName, p.kernel, runtime.GOARCH
	p.latest.LANIP, p.latest.TailscaleIP = lanIP, tsIP
	p.latest.OrbitAllocMB = round1(float64(ms.Alloc) / (1024 * 1024))
	p.latest.OrbitSysMB = round1(float64(ms.Sys) / (1024 * 1024))
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func readProcCPU() (total, idle uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		return 0, 0
	}
	fields := strings.Fields(sc.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0
	}
	for i := 1; i < len(fields); i++ {
		val, _ := strconv.ParseUint(fields[i], 10, 64)
		total += val
		if i == 4 || i == 5 {
			idle += val
		}
	}
	return total, idle
}

func readCPUModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		for _, prefix := range []string{"model name", "Model", "Hardware"} {
			if strings.HasPrefix(line, prefix) {
				if idx := strings.IndexByte(line, ':'); idx >= 0 {
					return strings.TrimSpace(line[idx+1:])
				}
			}
		}
	}
	return ""
}

func readOSName() string {
	b, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return runtime.GOOS
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"'`)
		}
	}
	return runtime.GOOS
}

func readKernelRelease() string {
	b, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readCPUTemp() *float64 {
	var fallback *float64
	if zones, err := filepath.Glob("/sys/class/thermal/thermal_zone*"); err == nil {
		for _, z := range zones {
			raw, err := os.ReadFile(filepath.Join(z, "temp"))
			if err != nil {
				continue
			}
			v, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
			if err != nil || v <= 0 {
				continue
			}
			if v > 200 {
				v /= 1000.0
			}
			if v < 5 || v > 130 {
				continue
			}
			val := round1(v)
			tb, _ := os.ReadFile(filepath.Join(z, "type"))
			tn := strings.ToLower(strings.TrimSpace(string(tb)))
			if strings.Contains(tn, "pkg") || strings.Contains(tn, "cpu") || strings.Contains(tn, "core") || strings.Contains(tn, "soc") {
				return &val
			}
			if fallback == nil {
				fallback = &val
			}
		}
	}
	if inputs, err := filepath.Glob("/sys/class/hwmon/hwmon*/temp*_input"); err == nil {
		for _, inp := range inputs {
			raw, err := os.ReadFile(inp)
			if err != nil {
				continue
			}
			v, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
			if err != nil || v <= 0 {
				continue
			}
			if v > 200 {
				v /= 1000.0
			}
			if v < 5 || v > 130 {
				continue
			}
			val := round1(v)
			nb, _ := os.ReadFile(filepath.Join(filepath.Dir(inp), "name"))
			hn := strings.ToLower(strings.TrimSpace(string(nb)))
			if strings.Contains(hn, "coretemp") || strings.Contains(hn, "k10temp") || strings.Contains(hn, "zenpower") || strings.Contains(hn, "cpu") {
				return &val
			}
			if fallback == nil {
				fallback = &val
			}
		}
	}
	return fallback
}

func readProcMem() (ramTotal, ramUsed, swapTotal, swapUsed uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, 0, 0
	}
	defer f.Close()
	var memAvail, swapFree uint64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(fields[1], 10, 64)
		v *= 1024
		switch fields[0] {
		case "MemTotal:":
			ramTotal = v
		case "MemAvailable:":
			memAvail = v
		case "SwapTotal:":
			swapTotal = v
		case "SwapFree:":
			swapFree = v
		}
	}
	if ramTotal > memAvail {
		ramUsed = ramTotal - memAvail
	}
	if swapTotal > swapFree {
		swapUsed = swapTotal - swapFree
	}
	return ramTotal, ramUsed, swapTotal, swapUsed
}

func readProcNet() (rx, tx uint64) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		iface := strings.TrimSpace(line[:colon])
		if iface == "lo" || strings.HasPrefix(iface, "veth") || strings.HasPrefix(iface, "br-") ||
			strings.HasPrefix(iface, "docker") || strings.HasPrefix(iface, "virbr") {
			continue
		}
		fields := strings.Fields(line[colon+1:])
		if len(fields) < 9 {
			continue
		}
		rVal, _ := strconv.ParseUint(fields[0], 10, 64)
		tVal, _ := strconv.ParseUint(fields[8], 10, 64)
		rx += rVal
		tx += tVal
	}
	return rx, tx
}

func readDiskUsage(path string) (total, used uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	total = st.Blocks * uint64(st.Bsize)
	avail := st.Bavail * uint64(st.Bsize)
	if total > avail {
		used = total - avail
	}
	return total, used
}

var allowedFS = map[string]bool{
	"ext4": true, "ext3": true, "ext2": true, "xfs": true, "btrfs": true,
	"zfs": true, "f2fs": true, "vfat": true, "exfat": true, "ntfs": true,
	"ntfs3": true, "fuseblk": true, "apfs": true, "overlay": true,
}

func readDiskMounts(fallbackPath string) []DiskInfo {
	f, err := os.Open("/proc/mounts")
	var out []DiskInfo
	seenDev := make(map[string]bool)
	seenMount := make(map[string]bool)
	if err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) < 3 {
				continue
			}
			dev, mount, fs := fields[0], fields[1], fields[2]
			if !allowedFS[fs] {
				continue
			}
			if mount != "/" && (strings.HasPrefix(mount, "/boot") || strings.HasPrefix(mount, "/snap") ||
				strings.HasPrefix(mount, "/var/lib/docker") || strings.HasPrefix(mount, "/var/lib/containerd") ||
				strings.HasPrefix(mount, "/run") || strings.HasPrefix(mount, "/sys") ||
				strings.HasPrefix(mount, "/proc") || strings.HasPrefix(mount, "/dev")) {
				continue
			}
			if (dev != "overlay" && seenDev[dev]) || seenMount[mount] {
				continue
			}
			total, used := readDiskUsage(mount)
			if total < 100<<20 {
				continue
			}
			seenDev[dev], seenMount[mount] = true, true
			pct := 0.0
			if total > 0 {
				pct = round1(float64(used) / float64(total) * 100)
			}
			out = append(out, DiskInfo{Mount: mount, Device: dev, TotalBytes: total, UsedBytes: used, Percent: pct})
		}
	}
	if len(out) == 0 && fallbackPath != "" {
		total, used := readDiskUsage(fallbackPath)
		pct := 0.0
		if total > 0 {
			pct = round1(float64(used) / float64(total) * 100)
		}
		out = append(out, DiskInfo{Mount: "/", Device: "local", TotalBytes: total, UsedBytes: used, Percent: pct})
	}
	return out
}

func readLoads() (l1, l5, l15 float64) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}
	fields := strings.Fields(string(b))
	if len(fields) >= 1 {
		l1, _ = strconv.ParseFloat(fields[0], 64)
	}
	if len(fields) >= 2 {
		l5, _ = strconv.ParseFloat(fields[1], 64)
	}
	if len(fields) >= 3 {
		l15, _ = strconv.ParseFloat(fields[2], 64)
	}
	return l1, l5, l15
}

func readUptime() uint64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return uint64(v)
}

func readProcessCount() int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if name := e.Name(); len(name) > 0 && name[0] >= '0' && name[0] <= '9' {
			count++
		}
	}
	return count
}

func readHostIPs() (lanIP, tsIP string) {
	_, tsNet, _ := net.ParseCIDR("100.64.0.0/10")
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if strings.HasPrefix(iface.Name, "docker") || strings.HasPrefix(iface.Name, "br-") ||
			strings.HasPrefix(iface.Name, "veth") || strings.HasPrefix(iface.Name, "virbr") {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			ip4 := ip.To4()
			if ip4 == nil || ip4.IsLoopback() {
				continue
			}
			if tsNet != nil && tsNet.Contains(ip4) {
				if tsIP == "" {
					tsIP = ip4.String()
				}
				continue
			}
			if ip4.IsPrivate() && lanIP == "" {
				lanIP = ip4.String()
			}
		}
	}
	return lanIP, tsIP
}
