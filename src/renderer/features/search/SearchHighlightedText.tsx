import { Fragment } from 'react';
import { parseSearchTerms } from '../../../shared/search';

export interface SearchTextPart {
  text: string;
  matched: boolean;
}

export const splitSearchHighlights = (
  text: string,
  query: string,
): SearchTextPart[] => {
  const terms = parseSearchTerms(query)
    .map((term) => term.value)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (terms.length === 0 || !text) return [{ text, matched: false }];

  const foldedText = text.toLocaleLowerCase();
  const foldedTerms = terms.map((term) => term.toLocaleLowerCase());
  const parts: SearchTextPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let matchStart = -1;
    let matchLength = 0;

    for (const term of foldedTerms) {
      const candidate = foldedText.indexOf(term, cursor);
      if (
        candidate >= 0
        && (
          matchStart < 0
          || candidate < matchStart
          || (candidate === matchStart && term.length > matchLength)
        )
      ) {
        matchStart = candidate;
        matchLength = term.length;
      }
    }

    if (matchStart < 0) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (matchStart > cursor) {
      parts.push({ text: text.slice(cursor, matchStart), matched: false });
    }
    parts.push({
      text: text.slice(matchStart, matchStart + matchLength),
      matched: true,
    });
    cursor = matchStart + matchLength;
  }

  return parts;
};

interface SearchHighlightedTextProps {
  text: string;
  query: string;
}

export const SearchHighlightedText = ({
  text,
  query,
}: SearchHighlightedTextProps) => (
  <>
    {splitSearchHighlights(text, query).map((part, index) => (
      <Fragment key={`${index}-${part.text}`}>
        {part.matched
          ? <mark className="entry-search-match">{part.text}</mark>
          : part.text}
      </Fragment>
    ))}
  </>
);
