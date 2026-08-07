import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  SummaryDetailLevel,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import type {
  TranslationSourceLanguage,
  TranslationTargetLanguage,
  TranslationMode,
} from '../../../shared/contracts/translation.types';
import {
  TRANSLATION_TARGET_LANGUAGES,
} from '../../../shared/contracts/translation.types';
import { ProviderSettings } from '../summary/ProviderSettings';
import type { AiPreferences } from './aiPreferences';
import { DiagnosticsSection } from './DiagnosticsSection';
import { ExpertSettingsSection } from './ExpertSettingsSection';
import { ShortcutSettingsSection } from './ShortcutSettingsSection';
import { TagAgentSettingsSection } from './TagAgentSettingsSection';
import { TerminologySettingsSection } from './TerminologySettingsSection';
import { UsageStatisticsSection } from './UsageStatisticsSection';
import {
  DEFAULT_READER_PREFERENCES,
  type ReaderPreferences,
} from './readerPreferences';

const SETTINGS_TRANSLATION_LANGUAGE_LABELS: Record<TranslationTargetLanguage, string> = {
  'zh-CN': '简体中文',
  'zh-HK': '繁体中文（香港）',
  ja: '日语',
  ko: '韩语',
  de: '德语',
  fr: '法语',
  es: '西班牙语',
  en: '英语',
};

const SETTINGS_NAVIGATION = [
  { id: 'settings-reading', label: '阅读' },
  { id: 'settings-summary', label: '摘要' },
  { id: 'settings-translation', label: '翻译' },
  { id: 'settings-terminology', label: '术语库' },
  { id: 'settings-experts', label: 'AI 专家' },
  { id: 'settings-shortcuts', label: '快捷键' },
  { id: 'settings-tag-agent', label: '标签生成' },
  { id: 'settings-provider', label: '模型服务' },
  { id: 'settings-usage', label: '用量统计' },
  { id: 'settings-diagnostics', label: '诊断' },
] as const;

type SettingsSectionId = (typeof SETTINGS_NAVIGATION)[number]['id'];

interface AISettingsPageProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
  readerPreferences?: ReaderPreferences;
  onReaderPreferencesChange?: (preferences: ReaderPreferences) => void;
  onClose: () => void;
}

export const AISettingsPage = ({
  preferences,
  onPreferencesChange,
  readerPreferences = DEFAULT_READER_PREFERENCES,
  onReaderPreferencesChange,
  onClose,
}: AISettingsPageProps) => {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [providerError, setProviderError] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>('settings-reading');
  const settingsNavigationRef = useRef<HTMLElement>(null);
  const settingsSelectionIndicatorRef = useRef<HTMLSpanElement>(null);
  const settingsPageMainRef = useRef<HTMLElement>(null);
  const pendingSettingsSectionRef = useRef<SettingsSectionId | null>(null);
  const pendingSettingsSectionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!window.shaleAPI) {
      setProviderError('当前预览未连接 Electron Main 进程。');
      return () => {
        disposed = true;
      };
    }
    void window.shaleAPI.provider.get().then((result) => {
      if (disposed) return;
      if (result.ok) setProfile(result.data);
      else setProviderError(result.error.message);
    }).catch(() => {
      if (!disposed) setProviderError('无法加载模型服务配置。');
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const main = settingsPageMainRef.current;
    if (!main) return;

    const updateActiveSection = (): void => {
      const mainRect = main.getBoundingClientRect();
      if (mainRect.height === 0 && main.clientHeight === 0) return;

      if (pendingSettingsSectionRef.current) {
        if (pendingSettingsSectionTimerRef.current !== null) {
          clearTimeout(pendingSettingsSectionTimerRef.current);
        }
        pendingSettingsSectionTimerRef.current = setTimeout(() => {
          pendingSettingsSectionRef.current = null;
          pendingSettingsSectionTimerRef.current = null;
          updateActiveSection();
        }, 160);
        return;
      }

      const remainingScroll = main.scrollHeight - main.scrollTop - main.clientHeight;
      const activationLine = mainRect.top + Math.min(160, mainRect.height * 0.28);
      let nextSection: SettingsSectionId = SETTINGS_NAVIGATION[0].id;

      for (const item of SETTINGS_NAVIGATION) {
        const section = main.querySelector<HTMLElement>(`#${item.id}`);
        if (section && section.getBoundingClientRect().top <= activationLine) {
          nextSection = item.id;
        }
      }

      if (main.scrollHeight > main.clientHeight && remainingScroll <= 2) {
        nextSection = SETTINGS_NAVIGATION[SETTINGS_NAVIGATION.length - 1].id;
      }
      setActiveSettingsSection((current) =>
        current === nextSection ? current : nextSection);
    };

    updateActiveSection();
    main.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    return () => {
      main.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
      if (pendingSettingsSectionTimerRef.current !== null) {
        clearTimeout(pendingSettingsSectionTimerRef.current);
        pendingSettingsSectionTimerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const navigation = settingsNavigationRef.current;
    const indicator = settingsSelectionIndicatorRef.current;
    const activeLink = navigation?.querySelector<HTMLElement>(
      `[data-settings-section="${activeSettingsSection}"]`,
    );
    if (!navigation || !indicator || !activeLink) return;

    const updateIndicator = (): void => {
      const navigationRect = navigation.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const linkHeight = linkRect.height || activeLink.offsetHeight || 35;
      const indicatorHeight = Math.min(30, linkHeight);
      const verticalInset = (linkHeight - indicatorHeight) / 2;
      const targetY = linkRect.top - navigationRect.top + verticalInset;

      indicator.style.height = `${indicatorHeight}px`;
      indicator.style.setProperty('--settings-selection-y', `${targetY}px`);
      indicator.style.opacity = '1';
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateIndicator);
    resizeObserver?.observe(navigation);
    resizeObserver?.observe(activeLink);

    return () => {
      window.removeEventListener('resize', updateIndicator);
      resizeObserver?.disconnect();
    };
  }, [activeSettingsSection]);

  const updatePreferences = (update: Partial<AiPreferences>): void => {
    onPreferencesChange({ ...preferences, ...update });
  };

  const selectSettingsSection = (sectionId: SettingsSectionId): void => {
    pendingSettingsSectionRef.current = sectionId;
    if (pendingSettingsSectionTimerRef.current !== null) {
      clearTimeout(pendingSettingsSectionTimerRef.current);
    }
    pendingSettingsSectionTimerRef.current = setTimeout(() => {
      pendingSettingsSectionRef.current = null;
      pendingSettingsSectionTimerRef.current = null;
    }, 240);
    setActiveSettingsSection(sectionId);
  };

  return (
    <div className="settings-page">
      <aside className="settings-navigation" aria-label="设置分类">
        <div className="settings-navigation-header">
          <button type="button" className="settings-back-button" onClick={onClose}>
            <span aria-hidden="true">←</span>
            返回阅读
          </button>
          <div>
            <span className="settings-product-name">Shale</span>
            <h1>设置</h1>
          </div>
        </div>
        <nav ref={settingsNavigationRef} className="settings-navigation-links">
          <span
            ref={settingsSelectionIndicatorRef}
            className="settings-selection-indicator"
            aria-hidden="true"
          />
          {SETTINGS_NAVIGATION.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={activeSettingsSection === item.id ? 'is-active' : ''}
              data-settings-section={item.id}
              aria-current={activeSettingsSection === item.id ? 'location' : undefined}
              onClick={() => selectSettingsSection(item.id)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <p className="settings-navigation-note">
          阅读偏好会自动保存在本机。
        </p>
      </aside>

      <main ref={settingsPageMainRef} className="settings-page-main">
        <header className="settings-page-header">
          <span className="settings-page-kicker">阅读体验</span>
          <h2>设置</h2>
          <p>配置摘要、翻译和模型服务。所有选项均服务于本地阅读流程。</p>
        </header>

        <div className="settings-page-content">
          <section
            id="settings-reading"
            className="settings-section"
            aria-labelledby="reading-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="reading-settings-title" className="settings-section-title">阅读</h3>
                <p>控制阅读界面的动态效果。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-toggle-grid">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={readerPreferences.pageTurnAnimationEnabled}
                    onChange={(event) => onReaderPreferencesChange?.({
                      ...readerPreferences,
                      pageTurnAnimationEnabled: event.target.checked,
                    })}
                  />
                  <span>
                    <strong>翻页动画</strong>
                    <small>滚动文章时显示右下角书本翻页；关闭后保留阅读进度和跳转按钮。</small>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section
            id="settings-summary"
            className="settings-section"
            aria-labelledby="summary-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="summary-settings-title" className="settings-section-title">摘要</h3>
                <p>选择摘要的输出语言和信息密度。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-fields settings-fields-two-columns">
                <label>
                  摘要语言
                  <select
                    value={preferences.summaryTargetLanguage}
                    onChange={(event) => updatePreferences({
                      summaryTargetLanguage: event.target.value as SummaryTargetLanguage,
                    })}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  详细程度
                  <select
                    value={preferences.summaryDetailLevel}
                    onChange={(event) => updatePreferences({
                      summaryDetailLevel: event.target.value as SummaryDetailLevel,
                    })}
                  >
                    <option value="short">简短</option>
                    <option value="medium">适中</option>
                    <option value="detailed">详细</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section
            id="settings-translation"
            className="settings-section"
            aria-labelledby="translation-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="translation-settings-title" className="settings-section-title">翻译</h3>
                <p>设置翻译方向，并决定是否使用术语和全文智能上下文。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-fields settings-fields-two-columns">
                <label>
                  源语言
                  <select
                    value={preferences.translationSourceLanguage}
                    onChange={(event) => updatePreferences({
                      translationSourceLanguage: event.target.value as TranslationSourceLanguage,
                    })}
                  >
                    <option value="auto">自动检测</option>
                    {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                      <option key={language} value={language}>
                        {SETTINGS_TRANSLATION_LANGUAGE_LABELS[language]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  目标语言
                  <select
                    value={preferences.translationTargetLanguage}
                    onChange={(event) => updatePreferences({
                      translationTargetLanguage: event.target.value as TranslationTargetLanguage,
                    })}
                  >
                    {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                      <option key={language} value={language}>
                        {SETTINGS_TRANSLATION_LANGUAGE_LABELS[language]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="settings-toggle-grid">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.useTerminology}
                    onChange={(event) => updatePreferences({
                      useTerminology: event.target.checked,
                    })}
                  />
                  <span>
                    <strong>使用术语库</strong>
                    <small>在所有翻译模式中应用本地术语候选。</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.useSmartContext}
                    onChange={(event) => updatePreferences({
                      useSmartContext: event.target.checked,
                    })}
                  />
                  <span>
                    <strong>AI 智能上下文</strong>
                    <small>翻译前分析全文、专业术语和文体，会增加一次或多次模型请求。</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <span>
                    <strong>深度翻译（实验性）</strong>
                    <small>通过初译、专业审校和重写生成更自然、准确的译文。会显著增加模型请求、Token 用量和翻译时间。</small>
                  </span>
                  <select
                    value={preferences.translationMode}
                    onChange={(event) => updatePreferences({
                      translationMode: event.target.value as TranslationMode,
                    })}
                    aria-label="翻译模式"
                  >
                    <option value="standard">标准翻译</option>
                    <option value="deep">深度翻译</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <TerminologySettingsSection
            useTerminology={preferences.useTerminology}
          />

          <ExpertSettingsSection
            preferences={preferences}
            onPreferencesChange={onPreferencesChange}
          />

          <ShortcutSettingsSection
            preferences={preferences}
            onPreferencesChange={onPreferencesChange}
          />

          <TagAgentSettingsSection
            preferences={preferences}
            onPreferencesChange={onPreferencesChange}
          />

          <div id="settings-provider" className="settings-section-anchor">
            {providerError && <p className="settings-page-error" role="status">{providerError}</p>}
            <ProviderSettings
              mode="embedded"
              profile={profile}
              onSaved={setProfile}
            />
          </div>

          <div id="settings-usage" className="settings-section-anchor">
            <UsageStatisticsSection />
          </div>

          <div id="settings-diagnostics" className="settings-section-anchor">
            <DiagnosticsSection />
          </div>
        </div>
      </main>
    </div>
  );
};
