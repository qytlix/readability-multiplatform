import type {
  ChatMessage,
  ChatState,
  ChatStreamEvent,
} from '../../../shared/contracts/chat.types';

const updateMessage = (
  messages: ChatMessage[],
  messageId: number,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] => messages.map((message) => (
  message.id === messageId ? update(message) : message
));

const eventMatchesRunningState = (
  state: ChatState,
  entryId: number,
  event: ChatStreamEvent,
): state is Extract<ChatState, { state: 'running' }> => (
  state.state === 'running'
  && event.entryId === entryId
  && event.runId === state.run.id
  && event.threadId === state.thread.id
  && event.messageId === state.run.assistantMessageId
);

export const applyChatStreamEvent = (
  state: ChatState,
  entryId: number,
  event: ChatStreamEvent,
): ChatState => {
  if (!eventMatchesRunningState(state, entryId, event)) return state;

  if (event.type === 'started') {
    return {
      ...state,
      run: {
        ...state.run,
        contextMode: event.contextMode,
      },
      messages: updateMessage(
        state.messages,
        event.messageId,
        (message) => ({
          ...message,
          articleContextMode: event.contextMode,
        }),
      ),
    };
  }

  if (event.type === 'delta') {
    return {
      ...state,
      messages: updateMessage(
        state.messages,
        event.messageId,
        (message) => ({
          ...message,
          content: `${message.content}${event.text}`,
          status: 'running',
        }),
      ),
    };
  }

  if (event.type === 'completed') {
    return {
      state: 'idle',
      thread: state.thread,
      messages: updateMessage(
        state.messages,
        event.messageId,
        () => event.message,
      ),
    };
  }

  const terminalStatus = event.type === 'failed' ? 'failed' : 'interrupted';
  return {
    state: terminalStatus,
    thread: state.thread,
    messages: updateMessage(
      state.messages,
      event.messageId,
      (message) => ({
        ...message,
        status: terminalStatus,
      }),
    ),
    run: {
      ...state.run,
      status: terminalStatus,
      error: event.error,
    },
  };
};
