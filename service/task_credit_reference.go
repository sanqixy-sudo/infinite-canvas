package service

import "context"

type taskCreditContextKey struct{}
type taskCreditLimitKey struct{}
func WithTaskCreditLimit(ctx context.Context, limit *float64) context.Context { if limit==nil{return ctx};return context.WithValue(ctx,taskCreditLimitKey{},*limit) }
func TaskCreditWithinLimit(ctx context.Context, credits float64) bool { limit,ok:=ctx.Value(taskCreditLimitKey{}).(float64);return !ok||credits<=limit+0.000001 }
type TaskCreditReference struct { ID string; Kind string }

func (ref TaskCreditReference) LedgerID() string {
	if ref.ID == "" { return "" }
	return ref.Kind + ":" + ref.ID
}

func WithTaskCreditReference(ctx context.Context, kind, id string) context.Context {
	return context.WithValue(ctx, taskCreditContextKey{}, TaskCreditReference{ID: id, Kind: kind})
}

func TaskCreditFromContext(ctx context.Context) TaskCreditReference {
	value, _ := ctx.Value(taskCreditContextKey{}).(TaskCreditReference)
	return value
}
