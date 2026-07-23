import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { PaneLayoutPreference } from './paneLayoutModel';
import {
  loadPaneLayoutPreference,
  savePaneLayoutPreference,
} from './paneLayoutStorage';

type BeforePreferenceSave = () => void;

interface PanePreferenceState {
  preference: PaneLayoutPreference;
  preferenceRef: MutableRefObject<PaneLayoutPreference>;
  commitPreferenceState: (
    nextPreference: PaneLayoutPreference,
    beforeSave: BeforePreferenceSave,
  ) => void;
}

export const usePanePreferenceState = (): PanePreferenceState => {
  const initialPreferenceRef = useRef<PaneLayoutPreference | null>(null);
  if (initialPreferenceRef.current === null) {
    initialPreferenceRef.current = loadPaneLayoutPreference();
  }

  const initialPreference = initialPreferenceRef.current;
  const [preference, setPreference] = useState<PaneLayoutPreference>(initialPreference);
  const preferenceRef = useRef<PaneLayoutPreference>(initialPreference);

  const commitPreferenceState = useCallback((
    nextPreference: PaneLayoutPreference,
    beforeSave: BeforePreferenceSave,
  ) => {
    preferenceRef.current = nextPreference;
    setPreference(nextPreference);
    beforeSave();
    savePaneLayoutPreference(nextPreference);
  }, []);

  return {
    preference,
    preferenceRef,
    commitPreferenceState,
  };
};
