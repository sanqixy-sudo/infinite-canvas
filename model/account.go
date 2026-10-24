package model

// AccountCreditLog 仅包含本人可以查看的算力点流水信息。
type AccountCreditLog struct {
	ID        string        `json:"id"`
	Type      CreditLogType `json:"type"`
	Amount    float64       `json:"amount"`
	Balance   float64       `json:"balance"`
	RelatedID string        `json:"relatedId"`
	Model     string        `json:"model"`
	Remark    string        `json:"remark"`
	CreatedAt string        `json:"createdAt"`
}

type AccountCreditLogList struct {
	Items []AccountCreditLog `json:"items"`
	Total int                `json:"total"`
}
