package splits

import (
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights using the
// largest-remainder method so sum(shares) == netPayout with no fils lost to rounding.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	if len(children) == 0 {
		return nil
	}
	var sumWeight int64
	for _, c := range children {
		sumWeight += c.WeightBps
	}
	if sumWeight == 0 {
		return make([]money.Fils, len(children))
	}

	bases := make([]int64, len(children))
	remainders := make([]int64, len(children))
	var allocated int64
	total := int64(netPayout)

	for i, c := range children {
		prod := total * c.WeightBps
		base := prod / sumWeight
		rem := prod % sumWeight
		bases[i] = base
		remainders[i] = rem
		allocated += base
	}

	leftover := total - allocated
	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool {
		a, b := order[i], order[j]
		if remainders[a] != remainders[b] {
			return remainders[a] > remainders[b]
		}
		return a < b
	})

	for k := 0; k < len(order) && leftover > 0; k++ {
		idx := order[k]
		bases[idx]++
		leftover--
	}

	out := make([]money.Fils, len(children))
	for i, b := range bases {
		out[i] = money.Fils(b)
	}
	return out
}
