package application

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// ErrOrderNotFound: the school has no such order.
var ErrOrderNotFound = errors.New("meal order not found")

// catererOrderView shares the date, supply-start and provisional-order
// rules. Only a detail read needs named rows.
func (s *Service) catererOrderView(ctx context.Context, since time.Time, from, to mealplan.Date, details bool) (domain.OrderView, error) {
	start, end, err := readWindow(from, to)
	if err != nil {
		return domain.OrderView{}, err
	}
	var view domain.OrderView
	err = s.run(ctx, "read_caterer_orders", func(txCtx context.Context) (domain.OperationStats, error) {
		rules, err := s.requireRegistration(txCtx)
		if err != nil {
			return domain.OperationStats{}, err
		}
		var stats domain.OperationStats
		view, stats, err = s.provisionalOrders(txCtx, rules, start, end, details)
		return stats, err
	})
	if err != nil {
		return domain.OrderView{}, mapPublicError(err)
	}
	view.Days = daysSince(view.Days, since)
	return view, nil
}

func (s *Service) CatererOrders(ctx context.Context, since time.Time, from, to mealplan.Date) (mealplan.OrderWeek, error) {
	view, err := s.catererOrderView(ctx, since, from, to, true)
	if err != nil {
		return mealplan.OrderWeek{}, err
	}
	return catererWeek(publicOrderWeek(view), view.Rules), nil
}

func (s *Service) CatererOrderSummary(ctx context.Context, since time.Time, from, to mealplan.Date) (mealplan.OrderSummary, error) {
	view, err := s.catererOrderView(ctx, since, from, to, false)
	if err != nil {
		return mealplan.OrderSummary{}, err
	}
	summary := mealplan.OrderSummary{Names: view.Rules.CatererNames, ByClass: view.Rules.Detail == domain.DetailByClass, Days: make([]mealplan.OrderDaySummary, 0, len(view.Days))}
	for _, day := range view.Days {
		header := orderDayHeader(day)
		row := mealplan.OrderDaySummary{Date: day.Date, Closed: day.Closed, Deadline: day.Deadline, Status: header.Status, OrderID: header.OrderID, Total: header.Total}
		for _, change := range day.Changes {
			if change.Delta > 0 {
				row.Added += change.Delta
			} else {
				row.Removed -= change.Delta
			}
		}
		summary.Days = append(summary.Days, row)
	}
	return summary, nil
}

// daysSince keeps the delivery days from the start of the supply on (ADR
// 0077): a caterer never reads a day its predecessor delivered, but reads
// every day it delivers, even one whose order was fixed before it started.
// A confirmation from before the start is its predecessor's and does not
// count for it.
func daysSince(days []domain.OrderDay, start time.Time) []domain.OrderDay {
	first := domain.DateFromInstant(start)
	kept := days[:0:0]
	for _, day := range days {
		if day.Date.Before(first) {
			continue
		}
		if day.Order != nil && day.Order.ConfirmedAt != nil && day.Order.ConfirmedAt.Before(start) {
			order := *day.Order
			order.ConfirmedAt = nil
			day.Order = &order
		}
		kept = append(kept, day)
	}
	return kept
}

// confirmOrder records that the caterer received a fixed order with a day of
// its supply. It is the caterer's only write (ADR 0077); confirming twice
// keeps the first, a predecessor's confirmation gives way to the caterer's
// own. A due order the worker has not stored yet has no ID, so it cannot be
// confirmed before it is stored: confirming never fixes an order.
func (s *Service) confirmOrder(ctx context.Context, orderID int64, since time.Time, accountID int64) error {
	return mapPublicError(s.run(ctx, "confirm_order", func(txCtx context.Context) (domain.OperationStats, error) {
		found, stats, err := s.store.ConfirmOrder(txCtx, orderID, accountID, domain.DateFromInstant(since), since, s.now())
		if err == nil && !found {
			err = ErrOrderNotFound
		}
		return stats, err
	}))
}

// catererWeek cuts the school's view down to what its caterer may read
// (ADR 0077): no child's ID, class numbers only when the school orders by
// class, and names only while the school shows them to the caterer.
func catererWeek(week mealplan.OrderWeek, rules domain.OrderingRules) mealplan.OrderWeek {
	byClass := rules.Detail == domain.DetailByClass
	for index := range week.Days {
		day := &week.Days[index]
		if !byClass {
			day.Classes = nil
		}
		if rules.CatererNames {
			day.Children = catererChildren(day.Children, byClass)
		} else {
			day.Children = nil
		}
		for change := range day.Changes {
			child := &day.Changes[change].Child
			*child = catererChild(*child, rules.CatererNames, byClass)
		}
	}
	return week
}

func catererChildren(children []mealplan.OrderChild, byClass bool) []mealplan.OrderChild {
	result := make([]mealplan.OrderChild, 0, len(children))
	for _, child := range children {
		result = append(result, catererChild(child, true, byClass))
	}
	return result
}

func catererChild(child mealplan.OrderChild, named, byClass bool) mealplan.OrderChild {
	result := mealplan.OrderChild{}
	if named {
		result.FirstName, result.LastName = child.FirstName, child.LastName
	}
	if byClass {
		result.SchoolClass = child.SchoolClass
	}
	return result
}
