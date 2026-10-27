package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tigerowo/infinite-canvas/gateway/handler"
	"github.com/tigerowo/infinite-canvas/gateway/repository"
	"github.com/tigerowo/infinite-canvas/gateway/service"
)

func env(key, fallback string) string { if value := os.Getenv(key); value != "" { return value }; return fallback }

func run() error {
	store,err := repository.Open(env("GATEWAY_DATABASE","/data/model-gateway.db")); if err != nil { return err }; defer store.Close()
	s,err := service.New(store,os.Getenv("GATEWAY_API_TOKEN"),os.Getenv("GATEWAY_ADMIN_TOKEN"),os.Getenv("GATEWAY_ENCRYPTION_KEY")); if err != nil { return err }
	ctx,cancel := signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM); defer cancel()
	done := make(chan struct{}); go func(){ defer close(done); s.Run(ctx) }()
	server := &http.Server{Addr:env("GATEWAY_LISTEN",":8088"),Handler:handler.Router(s),ReadHeaderTimeout:10*time.Second,ReadTimeout:20*time.Second,WriteTimeout:65*time.Second,IdleTimeout:60*time.Second,MaxHeaderBytes:32*1024}
	errorsCh := make(chan error,1)
	go func(){ log.Printf("model gateway listening on %s",server.Addr); errorsCh <- server.ListenAndServe() }()
	select { case <-ctx.Done(): case err = <-errorsCh: cancel() }
	shutdownCtx,stop := context.WithTimeout(context.Background(),60*time.Second); defer stop()
	shutdownErr := server.Shutdown(shutdownCtx)
	<-done
	if err != nil && !errors.Is(err,http.ErrServerClosed) { return err }
	return shutdownErr
}

func main(){ if err := run(); err != nil { log.Fatal(err) } }
