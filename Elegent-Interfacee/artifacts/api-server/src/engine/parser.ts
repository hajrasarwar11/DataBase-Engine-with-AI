// UQL Tokenizer + AST Parser — Full UQL language support

export type TokenKind =
  | "KEYWORD" | "IDENT" | "NUMBER" | "STRING"
  | "LPAREN" | "RPAREN" | "LBRACE" | "RBRACE" | "LBRACKET" | "RBRACKET"
  | "COMMA" | "DOT" | "COLON" | "EQ" | "NEQ" | "GT" | "LT" | "GTE" | "LTE"
  | "STAR" | "AND" | "OR" | "EOF";

const KEYWORDS = new Set([
  "FIND","ADD","MODIFY","REMOVE","WHERE","SET","VALUES","FROM","TO","PATH",
  "CREATE","DROP","DB","TABLE","GRAPH","DOCUMENT","IN","LIMIT","AS",
  "BEGIN","COMMIT","ROLLBACK","AND","OR","NOT","ORDER","BY","DESC","ASC",
  // New
  "JOIN","ON","GROUP","AGGREGATE","COUNT","SUM","AVG","MIN","MAX",
  "EXPLAIN","INDEX","SHOW","STATS","INDEXES","FOR","HAVING",
  "DATABASE","SCHEMA","REQUIRED",
]);

export interface Token { kind: TokenKind; value: string; pos: number; }

// ── Tokenizer ─────────────────────────────────────────────────────────────────
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === "-" && src[i+1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }

    const pos = i;

    // String literal
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      let s = "";
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { i++; s += src[i++]; } else s += src[i++];
      }
      i++;
      tokens.push({ kind: "STRING", value: s, pos });
      continue;
    }

    // Wildcard *
    if (src[i] === "*") {
      tokens.push({ kind: "STAR", value: "*", pos }); i++; continue;
    }

    // Number (including negative)
    if (/[0-9]/.test(src[i]) || (src[i] === "-" && /[0-9]/.test(src[i+1]||""))) {
      let n = src[i++];
      while (i < src.length && /[0-9.]/.test(src[i])) n += src[i++];
      tokens.push({ kind: "NUMBER", value: n, pos });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(src[i])) {
      let word = "";
      while (i < src.length && /[a-zA-Z0-9_.@]/.test(src[i])) word += src[i++];
      const up = word.toUpperCase();
      tokens.push({ kind: KEYWORDS.has(up) ? "KEYWORD" : "IDENT", value: word, pos });
      continue;
    }

    // Multi-char operators
    if (src[i] === "!" && src[i+1] === "=") { tokens.push({kind:"NEQ",value:"!=",pos}); i+=2; continue; }
    if (src[i] === ">" && src[i+1] === "=") { tokens.push({kind:"GTE",value:">=",pos}); i+=2; continue; }
    if (src[i] === "<" && src[i+1] === "=") { tokens.push({kind:"LTE",value:"<=",pos}); i+=2; continue; }

    // Single-char
    const single: Record<string, TokenKind> = {
      "(":"LPAREN",")":"RPAREN","{":"LBRACE","}":"RBRACE","[":"LBRACKET","]":"RBRACKET",
      ",":"COMMA",".":"DOT",":":"COLON","=":"EQ",">":"GT","<":"LT",
    };
    if (single[src[i]]) { tokens.push({kind:single[src[i]],value:src[i],pos}); i++; continue; }

    i++;
  }
  tokens.push({ kind: "EOF", value: "", pos: i });
  return tokens;
}

// ── AST Types ─────────────────────────────────────────────────────────────────
export type WhereClause = Record<string, unknown>;

export type AggFunc = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

export type JoinClause = {
  collection: string;
  localField: string;
  foreignField: string;
};

export type AST =
  | {
      type: "FIND"; target: string; db: string | null; where: WhereClause | null;
      limit: number | null; orderBy: string | null; orderAsc: boolean;
      groupBy: string | null; aggFunc: AggFunc | null; aggField: string | null;
      join: JoinClause | null;
    }
  | { type: "ADD";      target: string; db: string | null; values: Record<string,unknown>; }
  | { type: "MODIFY";   target: string; db: string | null; set: Record<string,unknown>; where: WhereClause | null; }
  | { type: "REMOVE";   target: string; db: string | null; where: WhereClause | null; }
  | { type: "FIND_PATH";target: string; db: string | null; from: {name:string;id:number}; to: {name:string;id:number}; }
  | { type: "CREATE_DB";  name: string; }
  | { type: "DROP_DB";    name: string; }
  | { type: "CREATE_COL"; db: string | null; name: string; colType: "table"|"graph"|"document"; schema: unknown[]; }
  | { type: "DROP_COL";   db: string | null; name: string; }
  | { type: "CREATE_INDEX"; db: string | null; col: string; field: string; }
  | { type: "DROP_INDEX";   db: string | null; col: string; field: string; }
  | { type: "SHOW_INDEXES"; db: string | null; col: string; }
  | { type: "SHOW_STATS";   db: string | null; }
  | { type: "EXPLAIN";      inner: AST; }
  | { type: "BEGIN"; }
  | { type: "COMMIT";   txn?: number; }
  | { type: "ROLLBACK"; txn?: number; }

// ── Parser ────────────────────────────────────────────────────────────────────
export function parse(src: string): AST {
  const tokens = tokenize(src.trim());
  let pos = 0;

  const peek    = () => tokens[pos];
  const next    = () => tokens[pos++];
  const eat     = (v: string) => {
    if (peek().value.toUpperCase() !== v.toUpperCase())
      throw new Error(`Expected '${v}', got '${peek().value}'`);
    return next();
  };
  const tryEat  = (v: string) => {
    if (peek().value.toUpperCase() === v.toUpperCase()) { next(); return true; }
    return false;
  };
  const ident   = () => next().value;
  const isKw    = (v: string) => peek().value.toUpperCase() === v.toUpperCase();

  function parseWhere(): WhereClause {
    const cond: WhereClause = {};
    do {
      const field = ident();
      const op = next().value;
      const val = parseValue();
      if (op === "=")  cond[field] = val;
      else if (op === "!=") cond[field] = { $ne: val };
      else if (op === ">")  cond[field] = { $gt: val };
      else if (op === "<")  cond[field] = { $lt: val };
      else if (op === ">=") cond[field] = { $gte: val };
      else if (op === "<=") cond[field] = { $lte: val };
      else cond[field] = val;
    } while (tryEat("AND"));
    return cond;
  }

  function parseValue(): unknown {
    const t = peek();
    if (t.kind === "NUMBER") { next(); return Number(t.value); }
    if (t.kind === "STRING") { next(); return t.value; }
    if (t.value.toUpperCase() === "TRUE")  { next(); return true; }
    if (t.value.toUpperCase() === "FALSE") { next(); return false; }
    if (t.value.toUpperCase() === "NULL")  { next(); return null; }
    if (t.kind === "LBRACE")   return parseObject();
    if (t.kind === "LBRACKET") return parseArray();
    next(); return t.value;
  }

  function parseObject(): Record<string,unknown> {
    eat("{");
    const obj: Record<string,unknown> = {};
    while (peek().kind !== "RBRACE" && peek().kind !== "EOF") {
      const k = ident(); eat(":");
      obj[k] = parseValue();
      tryEat(",");
    }
    eat("}"); return obj;
  }

  function parseArray(): unknown[] {
    eat("[");
    const arr: unknown[] = [];
    while (peek().kind !== "RBRACKET" && peek().kind !== "EOF") {
      arr.push(parseValue()); tryEat(",");
    }
    eat("]"); return arr;
  }

  function parseInDb(): string | null {
    if (isKw("IN")) { next(); return ident(); }
    return null;
  }

  // Parse aggregate function: COUNT(*) | SUM(field) | AVG(field) | MIN(field) | MAX(field)
  function parseAgg(): { func: AggFunc; field: string } {
    const func = next().value.toUpperCase() as AggFunc;
    eat("(");
    let field = "*";
    if (peek().kind !== "RPAREN" && peek().kind !== "STAR") {
      field = ident();
    } else if (peek().kind === "STAR") {
      next();
    }
    eat(")");
    return { func, field };
  }

  // ── Statement dispatch ────────────────────────────────────────────────────
  const first = next().value.toUpperCase();

  // ── EXPLAIN ──────────────────────────────────────────────────────────────
  if (first === "EXPLAIN") {
    // Parse the inner query from the rest of the tokens
    const rest = tokens.slice(pos).map(t => t.value).join(" ").trim();
    const inner = parse(rest);
    return { type: "EXPLAIN", inner };
  }

  // ── SHOW ──────────────────────────────────────────────────────────────────
  if (first === "SHOW") {
    if (isKw("STATS")) {
      next();
      const db = parseInDb();
      return { type: "SHOW_STATS", db };
    }
    if (isKw("INDEXES")) {
      next(); eat("FOR");
      const col = ident();
      const db = parseInDb();
      return { type: "SHOW_INDEXES", db, col };
    }
    throw new Error("Expected STATS or INDEXES after SHOW");
  }

  // ── Transaction commands ──────────────────────────────────────────────────
  if (first === "BEGIN")    return { type: "BEGIN" };
  if (first === "COMMIT")   return { type: "COMMIT" };
  if (first === "ROLLBACK") return { type: "ROLLBACK" };

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (first === "CREATE") {
    const kind = next().value.toUpperCase();

    if (kind === "DB" || kind === "DATABASE") {
      return { type: "CREATE_DB", name: ident() };
    }

    // CREATE INDEX ON col(field) IN db
    if (kind === "INDEX") {
      eat("ON");
      const col = ident();
      eat("(");
      const field = ident();
      eat(")");
      const db = parseInDb();
      return { type: "CREATE_INDEX", db, col, field };
    }

    const colType = (
      kind === "TABLE" ? "table" : kind === "GRAPH" ? "graph" : "document"
    ) as "table" | "graph" | "document";

    const name = ident();
    const db   = parseInDb();

    const schema: unknown[] = [];
    if (isKw("SCHEMA")) {
      next(); eat("(");
      while (peek().kind !== "RPAREN" && peek().kind !== "EOF") {
        const fname = ident();
        const ftype = ident();
        const required = isKw("REQUIRED") ? (next(), true) : false;
        schema.push({ name: fname, type: ftype, required });
        tryEat(",");
      }
      eat(")");
    }
    return { type: "CREATE_COL", db, name, colType, schema };
  }

  // ── DROP ──────────────────────────────────────────────────────────────────
  if (first === "DROP") {
    const kind = next().value.toUpperCase();
    if (kind === "DB" || kind === "DATABASE") return { type: "DROP_DB", name: ident() };
    // DROP INDEX ON col(field) IN db
    if (kind === "INDEX") {
      eat("ON");
      const col = ident();
      eat("(");
      const field = ident();
      eat(")");
      const db = parseInDb();
      return { type: "DROP_INDEX", db, col, field };
    }
    const name = ident();
    const db = parseInDb();
    return { type: "DROP_COL", db, name };
  }

  // ── FIND ──────────────────────────────────────────────────────────────────
  if (first === "FIND") {
    // FIND PATH FROM node(id) TO node(id) [IN db]
    if (isKw("PATH")) {
      next(); eat("FROM");
      const fromName = ident(); eat("("); const fromId = Number(ident()); eat(")");
      eat("TO");
      const toName = ident(); eat("("); const toId = Number(ident()); eat(")");
      const db = parseInDb();
      return { type: "FIND_PATH", target: fromName, db, from:{name:fromName,id:fromId}, to:{name:toName,id:toId} };
    }

    const target = ident();

    let where: WhereClause | null = null;
    let limit: number | null = null;
    let orderBy: string | null = null;
    let orderAsc = true;
    let groupBy: string | null = null;
    let aggFunc: AggFunc | null = null;
    let aggField: string | null = null;
    let join: JoinClause | null = null;

    // JOIN col ON f1 = f2
    if (isKw("JOIN")) {
      next();
      const joinCol = ident();
      eat("ON");
      const lf = ident(); eat("=");
      const ff = ident();
      join = { collection: joinCol, localField: lf, foreignField: ff };
    }

    if (tryEat("WHERE")) where = parseWhere();

    // GROUP BY field AGGREGATE func(field)
    if (isKw("GROUP")) {
      next(); eat("BY");
      groupBy = ident();
      if (isKw("AGGREGATE")) {
        next();
        const { func, field } = parseAgg();
        aggFunc = func; aggField = field;
      }
    }

    // AGGREGATE without GROUP BY (whole-collection aggregate)
    if (isKw("AGGREGATE")) {
      next();
      const { func, field } = parseAgg();
      aggFunc = func; aggField = field;
      groupBy = groupBy ?? "__all__";
    }

    if (isKw("ORDER")) {
      next(); eat("BY");
      orderBy = ident();
      if (isKw("ASC"))  { next(); orderAsc = true;  }
      if (isKw("DESC")) { next(); orderAsc = false; }
    }

    if (tryEat("LIMIT")) limit = Number(ident());

    // IN <db> can appear right after target (FIND x IN db) or at the very end
    const db = parseInDb();

    return { type: "FIND", target, db, where, limit, orderBy, orderAsc, groupBy, aggFunc, aggField, join };
  }

  // ── ADD ───────────────────────────────────────────────────────────────────
  if (first === "ADD") {
    const target = ident();
    eat("VALUES");
    const values = parseValue() as Record<string,unknown>;
    const db = parseInDb();
    return { type: "ADD", target, db, values };
  }

  // ── MODIFY ────────────────────────────────────────────────────────────────
  if (first === "MODIFY") {
    const target = ident();
    eat("SET");
    const set: Record<string,unknown> = {};
    do {
      const field = ident(); eat("=");
      set[field] = parseValue();
    } while (tryEat(","));
    let where: WhereClause | null = null;
    if (tryEat("WHERE")) where = parseWhere();
    const db = parseInDb();
    return { type: "MODIFY", target, db, set, where };
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  if (first === "REMOVE") {
    const target = ident();
    let where: WhereClause | null = null;
    if (tryEat("WHERE")) where = parseWhere();
    const db = parseInDb();
    return { type: "REMOVE", target, db, where };
  }

  throw new Error(`Unknown UQL statement starting with: '${first}'`);
}
