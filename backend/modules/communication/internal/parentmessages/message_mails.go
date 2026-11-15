package messaging

import (
	"context"
	"fmt"

	deliveryPorts "github.com/moto-ogs/project-phoenix/modules/communication/internal/application"
)

// ParentMessageThreadMails reports what became of the e-mail of each OGS
// message in a conversation (#7058). It checks access like GetThread and
// advances no read state, so the chat can poll it while it stays open.
func (s *Service) ParentMessageThreadMails(ctx context.Context, threadID int64) (map[int64]string, error) {
	thread, err := s.loadAuthorizedThread(ctx, threadID)
	if err != nil {
		// The HTTP surface reads the public contract's errors, as through the
		// conversation's facade.
		return nil, deliveryPorts.MapParentMessagingError(err, NativeFacadeErrors())
	}
	if s.Mails == nil {
		return map[int64]string{}, nil
	}
	messages, err := s.MessageRepo.ListByThread(ctx, thread.ID, 0)
	if err != nil {
		return nil, fmt.Errorf("messaging: list messages for mail status: %w", err)
	}
	ids := make([]int64, 0, len(messages))
	for _, message := range messages {
		if message.SenderKind == ParentMessageSenderStaff {
			ids = append(ids, message.ID)
		}
	}
	if len(ids) == 0 {
		return map[int64]string{}, nil
	}
	outcomes, err := s.Mails.ParentMessageMailOutcomes(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("messaging: read message mail status: %w", err)
	}
	return outcomes, nil
}

// ParentGroupThreadMails counts what became of the e-mails of each message of
// a group thread, one mail per family (#7058). Only the OGS writes there.
func (s *Service) ParentGroupThreadMails(ctx context.Context, groupThreadID int64) (map[int64]map[string]int, error) {
	thread, err := s.loadGroupThread(ctx, groupThreadID, false)
	if err != nil {
		return nil, err
	}
	if s.Mails == nil {
		return map[int64]map[string]int{}, nil
	}
	messages, err := s.GroupThreads.ListMessages(ctx, thread.ID)
	if err != nil {
		return nil, fmt.Errorf("messaging: list group messages for mail status: %w", err)
	}
	if len(messages) == 0 {
		return map[int64]map[string]int{}, nil
	}
	ids := make([]int64, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	outcomes, err := s.Mails.ParentGroupMessageMailOutcomes(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("messaging: read group message mail status: %w", err)
	}
	return outcomes, nil
}
