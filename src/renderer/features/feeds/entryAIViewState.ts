export interface EntryAIViewState {
  summaryVisible: boolean;
  translationVisible: boolean;
}

export type EntryAIViewStates = Readonly<Record<number, EntryAIViewState>>;

const DEFAULT_ENTRY_AI_VIEW_STATE: EntryAIViewState = {
  summaryVisible: false,
  translationVisible: false,
};

export function getEntryAIViewState(
  states: EntryAIViewStates,
  entryId: number | null,
): EntryAIViewState {
  if (entryId === null) return DEFAULT_ENTRY_AI_VIEW_STATE;
  return states[entryId] ?? DEFAULT_ENTRY_AI_VIEW_STATE;
}

export function updateEntryAIViewState(
  states: EntryAIViewStates,
  entryId: number,
  change: Partial<EntryAIViewState>,
): EntryAIViewStates {
  const current = getEntryAIViewState(states, entryId);
  const next = { ...current, ...change };
  if (
    next.summaryVisible === current.summaryVisible
    && next.translationVisible === current.translationVisible
  ) {
    return states;
  }
  return {
    ...states,
    [entryId]: next,
  };
}
