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
    <div className="story-list">
      <header className="story-list-header">
        <div className="story-list-heading">
          <h1>标签</h1>
        </div>
      </header>

      <div className="story-list-meta">
        {loadState === 'loaded' && <span>{tags.length} 个标签</span>}
      </div>

      {loadState === 'loading' && (
        <div className="story-list-state">
          <span className="reader-spinner" />
          <h2>正在加载标签…</h2>
          <p>所有内容都从这台设备加载。</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="story-list-state is-error">
          <span aria-hidden="true">!</span>
          <h2>标签载入失败</h2>
          <p>请稍后重试。</p>
        </div>
      )}

      {loadState === 'empty' && (
        <div className="story-list-state">
          <h2>还没有标签</h2>
          <p>在阅读文章时可以为文章添加标签。</p>
        </div>
      )}

      {loadState === 'loaded' && tags.length > 0 && (
        <div className="story-cards">
          {tags.map((tag) => {
            const { hue } = tagColor(tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                className="story-card story-card-tag-item"
                style={{ '--tag-hue': hue } as React.CSSProperties}
                onClick={() => onSelectTag(tag.name)}
              >
                <div className="story-card-copy">
                  <div className="story-card-title">
                    <h2>{tag.name}</h2>
                    <span className="story-card-reading-progress">
                      {tag.count}
                    </span>
                  </div>
                  <p>{tag.count} 篇文章</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};