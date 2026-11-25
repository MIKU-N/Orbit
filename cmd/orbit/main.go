package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"orbit/internal/config"
	"orbit/internal/db"
	"orbit/internal/kernel"
	"orbit/internal/plugin"
	"orbit/internal/plugins/bookmarks"
	"orbit/internal/plugins/clipboard"
	"orbit/internal/plugins/clock"
	"orbit/internal/plugins/hitokoto"
	"orbit/internal/plugins/monitor"
	"orbit/internal/plugins/search"
	"orbit/internal/plugins/transfer"
	"orbit/internal/plugins/weather"
)

// tunedTCPListener optimizes TCP socket buffers & TCP_NODELAY for high-bandwidth LAN transfers.
type tunedTCPListener struct {
	*net.TCPListener
}

func (l tunedTCPListener) Accept() (net.Conn, error) {
	tc, err := l.AcceptTCP()
	if err != nil {
		return nil, err
	}
	_ = tc.SetKeepAlive(true)
	_ = tc.SetKeepAlivePeriod(2 * time.Minute)
	_ = tc.SetNoDelay(true)
	_ = tc.SetReadBuffer(4 << 20)
	_ = tc.SetWriteBuffer(4 << 20)
	return tc, nil
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	conn, err := db.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer conn.Close()

	k := kernel.New(conn, cfg)
	if err := k.EnsureEnvAdmin(); err != nil {
		log.Fatalf("ensure env admin: %v", err)
	}

	builtins := []plugin.Plugin{
		clock.New(),
		search.New(),
		weather.New(),
		hitokoto.New(),
		bookmarks.New(),
		monitor.New(),
		clipboard.New(),
		transfer.New(),
	}
	for _, p := range builtins {
		if err := k.Register(p); err != nil {
			log.Fatalf("register plugin %s: %v", p.Manifest().ID, err)
		}
	}
	if err := k.LoadExternalPlugins(); err != nil {
		log.Printf("load external plugins warning: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	k.Start(ctx)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           k.Routes(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	rawLn, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		log.Fatalf("listen %s: %v", cfg.Addr, err)
	}
	var ln net.Listener = rawLn
	if tcpLn, ok := rawLn.(*net.TCPListener); ok {
		ln = tunedTCPListener{TCPListener: tcpLn}
	}

	go func() {
		log.Printf("Orbit (星轨) v%s Kernel listening on %s (data: %s)", config.Version, cfg.Addr, cfg.DataDir)
		if err := httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	k.Shutdown(shutdownCtx)
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}
