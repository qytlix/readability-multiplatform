import { describe, expect, it } from 'vitest';
import {
  getEntryAIViewState,
  updateEntryAIViewState,
  type EntryAIViewStates,
} from '../../../src/renderer/features/feeds/entryAIViewState';

describe('entry AI view state', () => {
  it('does not open saved AI results on the first visit', () => {
    expect(getEntryAIViewState({}, 42)).toEqual({
      summaryVisible: false,
      translationVisible: false,
    });
  });

  it('remembers summary and translation visibility independently per article', () => {
    let states: EntryAIViewStates = {};

    states = updateEntryAIViewState(states, 42, { translationVisible: true });
    states = updateEntryAIViewState(states, 42, { summaryVisible: true });
    states = updateEntryAIViewState(states, 7, { summaryVisible: true });

    expect(getEntryAIViewState(states, 42)).toEqual({
      summaryVisible: true,
      translationVisible: true,
    });
    expect(getEntryAIViewState(states, 7)).toEqual({
      summaryVisible: true,
      translationVisible: false,
    });
  });

  it('remembers when a previously visible result was hidden before leaving', () => {
    let states: EntryAIViewStates = {};
    states = updateEntryAIViewState(states, 42, {
      summaryVisible: true,
      translationVisible: true,
    });
    states = updateEntryAIViewState(states, 42, {
      summaryVisible: false,
      translationVisible: false,
    });

    expect(getEntryAIViewState(states, 42)).toEqual({
      summaryVisible: false,
      translationVisible: false,
    });
  });
});
