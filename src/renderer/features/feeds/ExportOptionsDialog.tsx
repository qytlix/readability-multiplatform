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

  const isSingle = articles.length === 1;
  const article = articles[0];

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
        <h2 id={titleId}>📄 导出文件</h2>

        {isSingle && article && (
          <div className="export-options-single">
            <p className="export-options-title">{article.title}</p>
            <div className="export-options-fields">
              {renderCheckbox(
                article.entryId,
                'includeSummary',
                '包含总结',
                article.hasSummary,
              )}
              {renderCheckbox(
                article.entryId,
                'includeTranslation',
                '包含翻译',
                article.hasTranslation,
              )}
              {renderCheckbox(
                article.entryId,
                'includeNotes',
                '包含笔记',
                article.hasNotes,
              )}
            </div>
          </div>
        )}

        {!isSingle && (
          <>
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

            <div className="export-options-list">
              {articles.map((a) => (
                <div key={a.entryId} className="export-options-row">
                  <span className="export-options-row-title">{a.title}</span>
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
                </div>
              ))}
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
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