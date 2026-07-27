import { useState, useEffect } from 'react';
import type { TagWithCount } from '../../../shared/contracts/tag.types';
import { tagColor } from './tagColor';

interface TagListPageProps {
  onSelectTag: (tagName: string) => void;
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export const TagListPage = ({ onSelectTag }: TagListPageProps) => {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadState('loading');
      try {
        const result = await window.shaleAPI.tag.listAllWithCount();
        if (cancelled) return;
        if (!result.ok) {
          setLoadState('error');
          return;
        }
        setTags(result.data);
        setLoadState(result.data.length === 0 ? 'empty' : 'loaded');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="tag-list-page">
      <header className="tag-list-page-header">
        <h1>标签</h1>
        {loadState === 'loaded' && <span className="tag-list-count">{tags.length}</span>}
      </header>

      {loadState === 'loading' && (
        <div className="tag-list-state">
          <span className="reader-spinner" />
          <p>正在加载标签…</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="tag-list-state is-error">
          <h2>标签载入失败</h2>
          <p>请稍后重试。</p>
        </div>
      )}

      {loadState === 'empty' && (
        <div className="tag-list-state">
          <h2>还没有标签</h2>
          <p>在阅读文章时可以为文章添加标签。</p>
        </div>
      )}

      {loadState === 'loaded' && tags.length > 0 && (
        <div className="tag-list-items">
          {tags.map((tag) => {
            const { hue } = tagColor(tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                className="tag-list-item"
                onClick={() => onSelectTag(tag.name)}
              >
                <span
                  className="tag-list-dot"
                  style={{ '--tag-hue': hue } as React.CSSProperties}
                />
                <span className="tag-list-name">{tag.name}</span>
                <span className="tag-list-count-number">
                  {tag.count} 篇文章
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};