import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UQL_KEYWORDS = ['FIND', 'ADD', 'MODIFY', 'REMOVE', 'WHERE', 'SET', 'VALUES', 'FROM', 'TO', 'PATH', 'AS', 'AND', 'OR', 'NOT', 'LIMIT', 'ORDER', 'BY', 'DESC', 'ASC', 'CREATE', 'DROP', 'GRAPH', 'DOC', 'DOCUMENT', 'TABLE', 'DB', 'DATABASE', 'IN', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SHOW', 'EXPLAIN', 'INDEX', 'ON', 'UNIQUE', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'USE'];

export type Theme = 'dark' | 'light';

interface SyntaxColors {
  comment: string;
  string: string;
  object: string;
  keyword: string;
  ident: string;
  number: string;
  operator: string;
  bracket: string;
}

const DARK_COLORS: SyntaxColors = {
  comment: '#555555',
  string: '#aaaaaa',
  object: '#cccccc',
  keyword: '#ffffff',
  ident: '#e0e0e0',
  number: '#dddddd',
  operator: '#888888',
  bracket: '#aaaaaa',
};

const LIGHT_COLORS: SyntaxColors = {
  comment: '#999999',
  string: '#4a4a4a',
  object: '#333333',
  keyword: '#000000',
  ident: '#1a1a1a',
  number: '#333333',
  operator: '#555555',
  bracket: '#666666',
};

export const highlightUQL = (code: string, theme: Theme = 'dark'): string => {
  const c = theme === 'light' ? LIGHT_COLORS : DARK_COLORS;
  const lines = code.split('\n');

  const processedLines = lines.map(line => {
    let result = '';
    let i = 0;
    const chars = line;

    while (i < chars.length) {
      if (chars[i] === '-' && chars[i + 1] === '-') {
        result += `<span style="color:${c.comment};font-style:italic">${escapeHtml(chars.slice(i))}</span>`;
        break;
      }

      if (chars[i] === '"' || chars[i] === "'") {
        const quote = chars[i];
        let j = i + 1;
        while (j < chars.length && chars[j] !== quote) j++;
        result += `<span style="color:${c.string}">${escapeHtml(chars.slice(i, j + 1))}</span>`;
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
        result += `<span style="color:${c.object}">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[a-zA-Z_]/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[a-zA-Z0-9_.]/.test(chars[j])) j++;
        const word = chars.slice(i, j);
        const upper = word.toUpperCase().replace(/\./g, '');
        if (UQL_KEYWORDS.includes(upper)) {
          result += `<span style="color:${c.keyword};font-weight:600">${word.toUpperCase()}</span>`;
        } else {
          result += `<span style="color:${c.ident}">${escapeHtml(word)}</span>`;
        }
        i = j;
        continue;
      }

      if (/\d/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[\d.]/.test(chars[j])) j++;
        result += `<span style="color:${c.number};font-style:italic">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[=<>!]/.test(chars[i])) {
        let j = i;
        while (j < chars.length && /[=<>!]/.test(chars[j])) j++;
        result += `<span style="color:${c.operator}">${escapeHtml(chars.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (/[()[\]]/.test(chars[i])) {
        result += `<span style="color:${c.bracket}">${escapeHtml(chars[i])}</span>`;
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
