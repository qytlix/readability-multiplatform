import { useEffect, useState } from 'react';
import type {
  AiPreferences,
  TagAgentConfirmMode,
  TagAgentTriggerMode,
} from './aiPreferences';

interface TagAgentSettingsSectionProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
}

export const TagAgentSettingsSection = ({
  preferences,
  onPreferencesChange,
}: TagAgentSettingsSectionProps) => {
  // 草稿只在用户明确保存后写入共享偏好。
  const [tagDraftTriggerMode, setTagDraftTriggerMode] =
    useState<TagAgentTriggerMode>(preferences.tagAgentTriggerMode);
  const [tagDraftConfirmMode, setTagDraftConfirmMode] =
    useState<TagAgentConfirmMode>(preferences.tagAgentConfirmMode);
  const [tagDraftMaxCandidates, setTagDraftMaxCandidates] =
    useState(preferences.tagAgentMaxCandidates);
  const [tagDraftSuggestionMaxCount, setTagDraftSuggestionMaxCount] =
    useState(preferences.tagSuggestionMaxCount);
  const [tagDraftSaved, setTagDraftSaved] = useState(false);

  // 外部偏好变化时同步本地草稿。
  useEffect(() => {
    setTagDraftTriggerMode(preferences.tagAgentTriggerMode);
    setTagDraftConfirmMode(preferences.tagAgentConfirmMode);
    setTagDraftMaxCandidates(preferences.tagAgentMaxCandidates);
    setTagDraftSuggestionMaxCount(preferences.tagSuggestionMaxCount);
  }, [
    preferences.tagAgentTriggerMode,
    preferences.tagAgentConfirmMode,
    preferences.tagAgentMaxCandidates,
    preferences.tagSuggestionMaxCount,
  ]);

  return (
    <section
      id="settings-tag-agent"
      className="settings-section"
      aria-labelledby="tag-agent-settings-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="tag-agent-settings-title" className="settings-section-title">标签生成</h3>
          <p>控制 AI 标签生成的行为。Provider 配置见下方「模型服务」区域。</p>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-fields settings-fields-two-columns">
          <label>
            触发方式
            <select
              value={tagDraftTriggerMode}
              onChange={(event) => {
                setTagDraftTriggerMode(event.target.value as TagAgentTriggerMode);
                setTagDraftSaved(false);
              }}
            >
              <option value="manual">手动触发</option>
              <option value="auto">进入文章自动触发</option>
            </select>
          </label>
          <label>
            确认方式
            <select
              value={tagDraftConfirmMode}
              onChange={(event) => {
                setTagDraftConfirmMode(event.target.value as TagAgentConfirmMode);
                setTagDraftSaved(false);
              }}
            >
              <option value="manual">手动确认</option>
              <option value="auto">自动确认</option>
            </select>
          </label>
        </div>
        <div className="settings-fields settings-fields-two-columns">
          <label>
            max 候选数
            <input
              type="number"
              min={1}
              max={50}
              value={tagDraftMaxCandidates}
              onChange={(event) => {
                setTagDraftMaxCandidates(
                  Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                );
                setTagDraftSaved(false);
              }}
            />
          </label>
          <label>
            建议显示数
            <input
              type="number"
              min={1}
              max={50}
              value={tagDraftSuggestionMaxCount}
              onChange={(event) => {
                setTagDraftSuggestionMaxCount(
                  Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                );
                setTagDraftSaved(false);
              }}
            />
          </label>
        </div>
        <div className="settings-card-actions">
          <button
            type="button"
            className="settings-save-btn"
            onClick={() => {
              onPreferencesChange({
                ...preferences,
                tagAgentTriggerMode: tagDraftTriggerMode,
                tagAgentConfirmMode: tagDraftConfirmMode,
                tagAgentMaxCandidates: tagDraftMaxCandidates,
                tagSuggestionMaxCount: tagDraftSuggestionMaxCount,
              });
              setTagDraftSaved(true);
            }}
          >
            {tagDraftSaved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>
    </section>
  );
};
