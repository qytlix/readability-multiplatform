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
import type { ArticleAvailability } from '../../../shared/contracts/export.types';
import type { PerArticleOptions } from '../../../shared/contracts/export.types';
import { DEFAULT_PER_ARTICLE_OPTIONS } from '../../../shared/contracts/export.types';
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
  const titleId = useId();

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
    const all = {
      includeSummary: true,
      includeTranslation: true,
      includeNotes: true,
    };
    for (const article of articles) {
      const opts = perArticleOptions.get(article.entryId);
      if (!opts) continue;
      if (!opts.includeSummary) all.includeSummary = false;
      if (!opts.includeTranslation) all.includeTranslation = false;
      if (!opts.includeNotes) all.includeNotes = false;
    }
    return all;
  }, [articles, perArticleOptions]);

  // 每列内容可用性（至少有一篇文章包含该内容）
  const fieldAvailability = useMemo(() => ({
    includeSummary: articles.some((a) => a.hasSummary),
    includeTranslation: articles.some((a) => a.hasTranslation),
    includeNotes: articles.some((a) => a.hasNotes),
  }), [articles]);

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
      const currentAll = columnAll[field];
      const newValue = !currentAll;
      setPerArticleOptions((prev) => {
        const next = new Map(prev);
        for (const [entryId] of next) {
          const existing = next.get(entryId);
          if (existing) {
            next.set(entryId, { ...existing, [field]: newValue });
          }
        }
        return next;
      });
    },
    [columnAll],
  );

  if (!open) return null;

  const renderCheckbox = (
    entryId: number,
    field: keyof PerArticleOptions,
    label: string,
    enabled: boolean,
  ) => {
    const checked = perArticleOptions.get(entryId)?.[field] ?? false;
    return (
      <label className={`export-option-checkbox${!enabled ? ' is-disabled' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!enabled}
          onChange={() => {
            if (enabled) setOption(entryId, field, !checked);
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
        <h2 id={titleId}>导出文件</h2>

        {articles.length > 1 && (
          <div className="export-options-column-toggles">
          <span className="article-action-tooltip" data-tooltip={!fieldAvailability.includeSummary ? '没有文章包含总结' : columnAll.includeSummary ? '取消全选总结' : '全选总结'}>
            <button
              type="button"
              className={`export-options-column-toggle${!fieldAvailability.includeSummary ? ' is-disabled' : ''}`}
              disabled={!fieldAvailability.includeSummary}
              onClick={() => toggleColumn('includeSummary')}
            >
              <span className={`export-toggle-indicator${columnAll.includeSummary ? ' is-checked' : ''}`} />
              总结
            </button>
          </span>
          <span className="article-action-tooltip" data-tooltip={!fieldAvailability.includeTranslation ? '没有文章包含翻译' : columnAll.includeTranslation ? '取消全选翻译' : '全选翻译'}>
            <button
              type="button"
              className={`export-options-column-toggle${!fieldAvailability.includeTranslation ? ' is-disabled' : ''}`}
              disabled={!fieldAvailability.includeTranslation}
              onClick={() => toggleColumn('includeTranslation')}
            >
              <span className={`export-toggle-indicator${columnAll.includeTranslation ? ' is-checked' : ''}`} />
              翻译
            </button>
          </span>
          <span className="article-action-tooltip" data-tooltip={!fieldAvailability.includeNotes ? '没有文章包含笔记' : columnAll.includeNotes ? '取消全选笔记' : '全选笔记'}>
            <button
              type="button"
              className={`export-options-column-toggle${!fieldAvailability.includeNotes ? ' is-disabled' : ''}`}
              disabled={!fieldAvailability.includeNotes}
              onClick={() => toggleColumn('includeNotes')}
            >
              <span className={`export-toggle-indicator${columnAll.includeNotes ? ' is-checked' : ''}`} />
              笔记
            </button>
          </span>
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
                <span
                  className={`export-options-row-status${
                    pipelineSuccess ? ' is-success' : ''
                  }${pipelineFailed ? ' is-failed' : ''
                  }${isCleaning ? ' is-cleaning' : ''}`}
                />
                <span className="export-options-row-title">{a.title}</span>
                {pipelineSuccess && (
                  <div className="export-options-row-fields">
                    {renderCheckbox(
                      a.entryId,
                      'includeSummary',
                      '总结',
                      a.hasSummary,
                    )}
                    {renderCheckbox(
                      a.entryId,
                      'includeTranslation',
                      '翻译',
                      a.hasTranslation,
                    )}
                    {renderCheckbox(
                      a.entryId,
                      'includeNotes',
                      '笔记',
                      a.hasNotes,
                    )}
                  </div>
                )}
                {!pipelineSuccess && (
                  <div className="export-options-row-unwashed">
                    {pipelineFailed ? (
                      <span className="export-options-failed-label">获取失败</span>
                    ) : isCleaning ? (
                      <span className="export-options-cleaning-label">获取中…</span>
                    ) : (
                      <>
                        <span className="export-options-unwashed-label" title="获取并清洗文章内容">未获取</span>
                        <button
                          type="button"
                          className="export-options-clean-btn"
                          title="获取并清洗文章内容"
                          onClick={() => void handleCleanSingle(a.entryId)}
                        >
                          现在获取
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
                title="获取并清洗所有未就绪文章内容"
                onClick={async () => {
                  const unwashed = articles.filter(
                    (a) => getEffectiveStatus(a.entryId) !== 'success',
                  );
                  for (const article of unwashed) {
                    await handleCleanSingle(article.entryId);
                  }
                }}
              >
                获取全部（{unwashedCount}篇）
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
    </div>
  );

  const pageRoot = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, pageRoot ?? document.body);
};