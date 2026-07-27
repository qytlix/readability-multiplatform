import {
  useEffect,
  useRef,
  useState,
  type AnimationEventHandler,
  type CSSProperties,
} from 'react';
import { getReadingProgressPercentage } from './readingProgress';
import type { ReadingBookTurnMotion } from './readingProgressBookMotion';

interface ReadingProgressBookProps {
  readingProgress: number;
  turnMotion: ReadingBookTurnMotion | null;
  jumpTarget: 'start' | 'end';
  onJump: () => void;
}

type PageTurnStyle = CSSProperties & {
  '--reading-book-turn-duration': string;
};

interface BookFlipProps {
  className: string;
  style?: PageTurnStyle;
  onAnimationEnd?: AnimationEventHandler<HTMLDivElement>;
}

const BookFlip = ({
  className,
  style,
  onAnimationEnd,
}: BookFlipProps) => (
  <div className={`reading-progress-book-flips ${className}`}>
    <div
      className="reading-progress-book-flip flip1"
      style={style}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="reading-progress-book-flip flip2">
        <div className="reading-progress-book-flip flip3">
          <div className="reading-progress-book-flip flip4">
            <div className="reading-progress-book-flip flip5">
              <div className="reading-progress-book-flip flip6">
                <div className="reading-progress-book-flip flip7" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const ReadingProgressBook = ({
  readingProgress,
  turnMotion,
  jumpTarget,
  onJump,
}: ReadingProgressBookProps) => {
  const [activeTurn, setActiveTurn] = useState<ReadingBookTurnMotion | null>(null);
  const pendingTurnRef = useRef<ReadingBookTurnMotion | null>(null);
  const percentage = getReadingProgressPercentage(readingProgress);
  const jumpsToStart = jumpTarget === 'start';

  useEffect(() => {
    if (!turnMotion) {
      pendingTurnRef.current = null;
      setActiveTurn(null);
      return;
    }

    setActiveTurn((currentTurn) => {
      if (!currentTurn) return turnMotion;

      // Keep the current page turn uninterrupted and coalesce bursty scroll
      // updates into one latest follow-up instead of animating several 3D
      // page stacks at the same time.
      pendingTurnRef.current = turnMotion;
      return currentTurn;
    });
  }, [turnMotion]);

  const finishTurn = (turnId: number): void => {
    setActiveTurn((currentTurn) => {
      if (currentTurn?.id !== turnId) return currentTurn;

      const pendingTurn = pendingTurnRef.current;
      pendingTurnRef.current = null;
      return pendingTurn;
    });
  };

  return (
    <aside
      className="reading-progress-book"
      aria-label="阅读导航与进度"
    >
      <button
        type="button"
        className={`reading-progress-jump-button is-${jumpsToStart ? 'up' : 'down'}`}
        aria-label={jumpsToStart ? '跳转到文章开头' : '跳转到文章末尾'}
        title={jumpsToStart ? '跳转到文章开头' : '跳转到文章末尾'}
        onClick={onJump}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m4.5 5 7 7-7 7" />
          <path d="m11.5 5 7 7-7 7" />
        </svg>
      </button>
      <div
        className="reading-progress-book-status"
        role="progressbar"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div className="reading-progress-book-visual" aria-hidden="true">
          <div className="reading-progress-book-model">
            <div className="reading-progress-book-gap" />
            <div className="reading-progress-book-pages">
              <div className="reading-progress-book-page" />
              <div className="reading-progress-book-page" />
              <div className="reading-progress-book-page" />
              <div className="reading-progress-book-page" />
              <div className="reading-progress-book-page" />
              <div className="reading-progress-book-page" />
            </div>
            <BookFlip className="is-resting" />
            {activeTurn && (() => {
              const turn = activeTurn;
              const style: PageTurnStyle = {
                '--reading-book-turn-duration': `${turn.durationMs}ms`,
                zIndex: 6,
              };

              if (turn.variant === 'single') {
                return (
                  <div
                    key={turn.id}
                    className={`reading-progress-book-single-page is-turning-${turn.direction}`}
                    style={style}
                    onAnimationEnd={() => finishTurn(turn.id)}
                  />
                );
              }

              return (
                <BookFlip
                  key={turn.id}
                  className={`is-turning-${turn.direction}`}
                  style={style}
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget) {
                      finishTurn(turn.id);
                    }
                  }}
                />
              );
            })()}
          </div>
        </div>
        <div className="reading-progress-book-label">
          <strong>{percentage}%</strong>
        </div>
      </div>
    </aside>
  );
};
