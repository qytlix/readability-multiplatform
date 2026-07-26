import {
  useEffect,
  useState,
  type AnimationEventHandler,
  type CSSProperties,
} from 'react';
import { getReadingProgressPercentage } from './readingProgress';
import type { ReadingBookTurnMotion } from './readingProgressBookMotion';

interface ReadingProgressBookProps {
  readingProgress: number;
  turnMotion: ReadingBookTurnMotion | null;
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
}: ReadingProgressBookProps) => {
  const [activeTurns, setActiveTurns] = useState<ReadingBookTurnMotion[]>([]);
  const percentage = getReadingProgressPercentage(readingProgress);

  useEffect(() => {
    if (!turnMotion) {
      setActiveTurns([]);
      return;
    }

    setActiveTurns((currentTurns) => (
      [...currentTurns, turnMotion].slice(-5)
    ));
  }, [turnMotion]);

  const removeTurn = (turnId: number): void => {
    setActiveTurns((currentTurns) => (
      currentTurns.filter(({ id }) => id !== turnId)
    ));
  };

  return (
    <aside
      className="reading-progress-book"
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
          {activeTurns.map((turn, index) => {
            const style: PageTurnStyle = {
              '--reading-book-turn-duration': `${turn.durationMs}ms`,
              zIndex: 6 + index,
            };

            if (turn.variant === 'single') {
              return (
                <div
                  key={turn.id}
                  className={`reading-progress-book-single-page is-turning-${turn.direction}`}
                  style={style}
                  onAnimationEnd={() => removeTurn(turn.id)}
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
                    removeTurn(turn.id);
                  }
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="reading-progress-book-label">
        <strong>{percentage}%</strong>
      </div>
    </aside>
  );
};
