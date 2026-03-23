import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UQL_KEYWORDS = ['FIND', 'ADD', 'MODIFY', 'REMOVE', 'WHERE', 'SET', 'VALUES', 'FROM', 'TO', 'PATH', 'AS', 'AND', 'OR', 'NOT', 'LIMIT', 'ORDER', 'BY', 'DESC', 'ASC', 'CREATE', 'DROP', 'GRAPH', 'DOC', 'DOCUMENT', 'TABLE', 'DB', 'DATABASE', 'IN'];

export type Theme = 'dark' | 'light';

export const highlightUQL = (code: string, theme: Theme = 'dark'): string => {
  const isDark = theme === 'dark';
  const colors = {
    comment:    isDark ? '#6b7280' : '#888ea8',
    string:     isDark ? '#34d399' : '#16a34a',
    braces:     isDark ? '#fbbf24' : '#d97706',
    keyword:    isDark ? '#22d3ee' : '#0369a1',
    identifier: isDark ? '#e2e8f0' : '#1e293b',
    number:     isDark ? '#fb923c' : '#c2410c',
    operator:   isDark ? '#f472b6' : '#9333ea',
    paren:      isDark ? '#facc15' : '#ca8a04',
  };
  const lines = code.split('\n');
  const processedLines = lines.map(line => {
    let result = '';
    let i = 0;
    const chars = line;

    while (i < chars.length) {
      if (chars[i] === '-' && chars[i + 1] === '-') {
        result += `<span style="color:${colors.comment};font-style:italic">${escapeHtml(chars.slice(i))}</span>`;
        break;
      }

      if (chars[i] === '"' || chars[i] === "'") {
        const quote = chars[i];
        let j = i + 1;
        while (j < chars.length && chars[j] !== quote) j++;
        result += `<span style="color:${colors.string}">${escapeHtml(chars.slice(i, j + 1))}</span>`;
        i = j + 1;
        continue;
      }

      if (chars[i] === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < chars.length && depth > 0) {
          if (chars[j] === '{') depth++;
          if (chars[j] === '}') depth--;
          j++;
        }
        result += `<span style="color:${colors.braces}">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[a-zA-Z_]/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[a-zA-Z0-9_]/.test(chars[j])) j++;
        const word = chars.slice(i, j);
        if (UQL_KEYWORDS.includes(word.toUpperCase())) {
          result += `<span style="color:${colors.keyword};font-weight:700">${word.toUpperCase()}</span>`;
        } else {
          result += `<span style="color:${colors.identifier}">${escapeHtml(word)}</span>`;
        }
        i = j;
        continue;
      }

      if (/\d/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[\d.]/.test(chars[j])) j++;
        result += `<span style="color:${colors.number}">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[=<>!]/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[=<>!]/.test(chars[j])) j++;
        result += `<span style="color:${colors.operator}">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[()[\]]/.test(chars[i])) {
        result += `<span style="color:${colors.paren}">${escapeHtml(chars[i])}</span>`;
        i++;
        continue;
      }

      result += escapeHtml(chars[i]);
      i++;
    }

    return result;
  });

  return processedLines.join('\n');
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
