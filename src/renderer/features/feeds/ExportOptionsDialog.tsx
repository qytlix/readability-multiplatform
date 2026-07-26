import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  ArticleAvailability,
  PerArticleOptions,
} from '../../../shared/contracts/export.types';
import type { CleanProgressEvent } from '../../../shared/contracts/export.ipc';
import { cleanSingle } from './entryExport';

interface ExportOptionsDialogProps {
  open: boolean;
  /** 单篇：1 篇；多选：N 篇 */
  articles: ArticleAvailability[];
  onConfirm: (
    perArticleOptions: Map<number, PerArticleOptions>,
  ) => void;
  onCancel: () => void;
}

/**
 * 导出选项对话框。
 *
 * 单篇时简化为一行的三个 checkbox。
 * 多篇时每篇文章一行独立勾选，支持列级全选/全不选。
 */
export const ExportOptionsDialog = ({
  open,
  articles,
  onConfirm,
  onCancel,
}: ExportOptionsDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const titleId = useId();
  const [feedback, setFeedback] = useState('');

  // 每篇文章的选项：Map<entryId, PerArticleOptions>
  const [perArticleOptions, setPerArticleOptions] = useState<
    Map<number, PerArticleOptions>
  >(() => new Map());

  // 正在清洗中的 entryId 集合
  const [cleaningIds, setCleaningIds] = useState<Set<number>>(new Set());

  // 已通过「现在清洗」完成的文章
  const [refreshedArticleStatus, setRefreshedArticleStatus] = useState<
    Map<number, ArticleAvailability['pipelineStatus']>
  >(() => new Map());

  const showFeedback = useCallback((message: string): void => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback(message);
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback('');
      feedbackTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  // 获取文章当前实际 pipelineStatus（考虑本地清洗结果）
  const getEffectiveStatus = useCallback(
    (entryId: number): ArticleAvailability['pipelineStatus'] => {
      const localStatus = refreshedArticleStatus.get(entryId);
      if (localStatus) return localStatus;
      const article = articles.find((a) => a.entryId === entryId);
      return article?.pipelineStatus ?? 'pending';
    },
    [articles, refreshedArticleStatus],
  );

  // 清洗单篇文章
  const handleCleanSingle = useCallback(async (entryId: number) => {
    setCleaningIds((prev) => new Set(prev).add(entryId));
    try {
      await cleanSingle(entryId, (event: CleanProgressEvent) => {
        if (event.entryId === entryId) {
          if (event.status === 'success') {
            setRefreshedArticleStatus((prev) => {
              const next = new Map(prev);
              next.set(entryId, 'success');
              return next;
            });
            // Also mark original article as selectable by setting options
            setPerArticleOptions((prev) => {
              const next = new Map(prev);
              if (!next.has(entryId)) {
                next.set(entryId, {
                  includeSummary: false,
                  includeTranslation: false,
                  includeNotes: false,
                });
              }
              return next;
            });
          } else if (event.status === 'failed') {
            setRefreshedArticleStatus((prev) => {
              const next = new Map(prev);
              next.set(entryId, 'failed');
              return next;
            });
          }
        }
      });
    } catch {
      setRefreshedArticleStatus((prev) => {
        const next = new Map(prev);
        next.set(entryId, 'failed');
        return next;
      });
    } finally {
      setCleaningIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  }, []);

  // 项级全选状态
  const columnAll = useMemo(() => {
    const isEveryAvailableOptionSelected = (
      field: keyof PerArticleOptions,
    ): boolean => {
      const availableArticles = articles.filter((article) =>
        isOptionAvailable(article, field));
      return availableArticles.length > 0 && availableArticles.every((article) =>
        perArticleOptions.get(article.entryId)?.[field] === true);
    };
    return {
      includeSummary: isEveryAvailableOptionSelected('includeSummary'),
      includeTranslation: isEveryAvailableOptionSelected('includeTranslation'),
      includeNotes: isEveryAvailableOptionSelected('includeNotes'),
    };
  }, [articles, perArticleOptions]);

  // 初始化 / articles 变化时重置
  useEffect(() => {
    if (!open) return;
    const map = new Map<number, PerArticleOptions>();
    for (const article of articles) {
      map.set(article.entryId, {
        includeSummary: article.hasSummary,
        includeTranslation: article.hasTranslation,
        includeNotes: article.hasNotes,
      });
    }
    setPerArticleOptions(map);
    setCleaningIds(new Set());
    setRefreshedArticleStatus(new Map());
    setFeedback('');
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    // 焦点
    requestAnimationFrame(() => {
      cancelButtonRef.current?.focus();
    });
  }, [open, articles]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onCancel]);

  // Tab 循环
  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled)',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  const handleOverlayClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onCancel();
      }
    },
    [onCancel],
  );

  const setOption = useCallback(
    (entryId: number, field: keyof PerArticleOptions, value: boolean) => {
      setPerArticleOptions((prev) => {
        const next = new Map(prev);
        const existing = next.get(entryId);
        if (existing) {
          next.set(entryId, { ...existing, [field]: value });
        }
        return next;
      });
    },
    [],
  );

  const toggleColumn = useCallback(
    (field: keyof PerArticleOptions) => {
      const availableArticles = articles.filter((article) =>
        isOptionAvailable(article, field));
      if (availableArticles.length === 0) {
        showFeedback(`所选文章均暂无${OPTION_LABELS[field]}，无法选择。`);
        return;
      }
      const currentAll = columnAll[field];
      const newValue = !currentAll;
      setPerArticleOptions((prev) => {
        const next = new Map(prev);
        for (const article of availableArticles) {
          const entryId = article.entryId;
          const existing = next.get(entryId);
          if (existing) {
            next.set(entryId, { ...existing, [field]: newValue });
          }
        }
        return next;
      });
    },
    [articles, columnAll, showFeedback],
  );

  if (!open) return null;

  const renderCheckbox = (
    article: ArticleAvailability,
    field: keyof PerArticleOptions,
    label: string,
    enabled: boolean,
  ) => {
    const checked = perArticleOptions.get(article.entryId)?.[field] ?? false;
    const unavailableMessage = `“${article.title}”暂无${label}，无法选择。`;
    return (
      <label
        className={`export-option-checkbox${!enabled ? ' is-disabled' : ''}`}
        title={enabled ? undefined : unavailableMessage}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-disabled={!enabled}
          aria-label={enabled ? label : `${label}不可选：暂无${label}`}
          onChange={(event) => {
            if (!enabled) {
              event.currentTarget.checked = false;
              showFeedback(unavailableMessage);
              return;
            }
            setOption(article.entryId, field, !checked);
          }}
        />
        <span>{label}</span>
      </label>
    );
  };

  const dialog = (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className="dialog export-options-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId}>📄 导出文件</h2>

        {articles.length > 1 && (
          <div className="export-options-column-toggles">
          <button
            type="button"
            className="export-options-column-toggle"
            onClick={() => toggleColumn('includeSummary')}
            title={columnAll.includeSummary ? '取消全选总结' : '全选总结'}
          >
            {columnAll.includeSummary ? '☑' : '☐'} 总结
          </button>
          <button
            type="button"
            className="export-options-column-toggle"
            onClick={() => toggleColumn('includeTranslation')}
            title={
              columnAll.includeTranslation ? '取消全选翻译' : '全选翻译'
            }
          >
            {columnAll.includeTranslation ? '☑' : '☐'} 翻译
          </button>
          <button
            type="button"
            className="export-options-column-toggle"
            onClick={() => toggleColumn('includeNotes')}
            title={columnAll.includeNotes ? '取消全选笔记' : '全选笔记'}
          >
            {columnAll.includeNotes ? '☑' : '☐'} 笔记
          </button>
        </div>
        )}

        <div className="export-options-list">
          {articles.map((a) => {
            const effectiveStatus = getEffectiveStatus(a.entryId);
            const isCleaning = cleaningIds.has(a.entryId);
            const pipelineSuccess = effectiveStatus === 'success';
            const pipelineFailed = effectiveStatus === 'failed';

            return (
              <div key={a.entryId} className="export-options-row">
                <span className={`export-options-row-status${
                  pipelineFailed ? ' is-failed' : ''
                }${isCleaning ? ' is-cleaning' : ''}`}>
                  {pipelineSuccess
                    ? '✅'
                    : pipelineFailed
                      ? '❌'
                      : isCleaning
                        ? '⏳'
                        : '⏳'}
                </span>
                <span className="export-options-row-title">{a.title}</span>
                {pipelineSuccess && (
                  <div className="export-options-row-fields">
                    {renderCheckbox(
                      a,
                      'includeSummary',
                      '总结',
                      a.hasSummary,
                    )}
                    {renderCheckbox(
                      a,
                      'includeTranslation',
                      '翻译',
                      a.hasTranslation,
                    )}
                    {renderCheckbox(
                      a,
                      'includeNotes',
                      '笔记',
                      a.hasNotes,
                    )}
                  </div>
                )}
                {!pipelineSuccess && (
                  <div className="export-options-row-unwashed">
                    {pipelineFailed ? (
                      <span className="export-options-failed-label">清洗失败</span>
                    ) : isCleaning ? (
                      <span className="export-options-cleaning-label">清洗中…</span>
                    ) : (
                      <>
                        <span className="export-options-unwashed-label">🧹未清洗</span>
                        <button
                          type="button"
                          className="export-options-clean-btn"
                          onClick={() => void handleCleanSingle(a.entryId)}
                        >
                          现在清洗
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(() => {
          const unwashedCount = articles.filter(
            (a) => getEffectiveStatus(a.entryId) !== 'success',
          ).length;
          const hasCleaningInProgress = cleaningIds.size > 0;
          return unwashedCount > 0 && !hasCleaningInProgress ? (
            <div className="export-options-clean-all">
              <button
                type="button"
                className="export-options-clean-all-btn"
                onClick={async () => {
                  const unwashed = articles.filter(
                    (a) => getEffectiveStatus(a.entryId) !== 'success',
                  );
                  for (const article of unwashed) {
                    await handleCleanSingle(article.entryId);
                  }
                }}
              >
                🧹 清洗全部未清洗（{unwashedCount}篇）
              </button>
            </div>
          ) : null;
        })()}

        <div className="dialog-actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={cleaningIds.size > 0}
            onClick={() => onConfirm(perArticleOptions)}
          >
            下一步
          </button>
        </div>
      </div>
      {feedback && (
        <div
          className="reader-toast export-options-feedback"
          role="status"
          aria-live="polite"
        >
          {feedback}
        </div>
      )}
    </div>
  );

  const pageRoot = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, pageRoot ?? document.body);
};

const OPTION_LABELS: Record<keyof PerArticleOptions, string> = {
  includeSummary: '总结',
  includeTranslation: '翻译',
  includeNotes: '笔记',
};

function isOptionAvailable(
  article: ArticleAvailability,
  field: keyof PerArticleOptions,
): boolean {
  switch (field) {
    case 'includeSummary': return article.hasSummary;
    case 'includeTranslation': return article.hasTranslation;
    case 'includeNotes': return article.hasNotes;
  }
}
