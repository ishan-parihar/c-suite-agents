import initSqlJs from "sql.js";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getDirectReports } from "../staff/core-staff.js";
import { validateAgentIdentity } from "../auth/session.js";

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

type DBAny = any;

export type CardStatus = "Backlog"|"Todo"|"In Progress"|"Blocked"|"Review"|"Done";

export interface KanbanCard {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string;
  priority: string;
  due: string | null;
  tags: string[];
  assignee_agent_id: string;
  project_id: string | null;
  last_update: string;
  status: CardStatus;
}

export interface KanbanBoard {
  id: string;
  agent_id: string;
  name: string;
  columns: Array<{ id: string; name: string; cards: KanbanCard[] }>;
}

/** sql.js .get() returns arrays; map to named KanbanCard object. */
function mapCard(row: unknown[], columnName: string): KanbanCard {
  return {
    id: row[0] as string,
    board_id: row[1] as string,
    column_id: row[2] as string,
    title: row[3] as string,
    description: row[4] as string,
    priority: row[5] as string,
    due: row[6] as string | null,
    tags: safeJsonParse(row[7] as string, []),
    assignee_agent_id: row[8] as string,
    project_id: row[9] as string | null,
    last_update: row[10] as string,
    status: columnName as CardStatus
  };
}

/** sql.js .get() returns arrays; map to partial card (no status). */
function mapCardPartial(row: unknown[]): Omit<KanbanCard, 'status'> {
  return {
    id: row[0] as string,
    board_id: row[1] as string,
    column_id: row[2] as string,
    title: row[3] as string,
    description: row[4] as string,
    priority: row[5] as string,
    due: row[6] as string | null,
    tags: safeJsonParse(row[7] as string, []),
    assignee_agent_id: row[8] as string,
    project_id: row[9] as string | null,
    last_update: row[10] as string,
  };
}

const CARD_COLUMNS = "id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update";

export class Kanban {
  private constructor(private db: DBAny, private path: string) {}

  static async init(path: string) {
    const resolved = resolve(path);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${path}`);
    }
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
    let db: DBAny;
    try {
      const buf = await fs.readFile(resolved);
      db = new SQL.Database(new Uint8Array(buf));
    } catch {
      db = new SQL.Database();
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, agent_id TEXT, name TEXT);
      CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, board_id TEXT, name TEXT, ord INTEGER);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, board_id TEXT, column_id TEXT, title TEXT, description TEXT, priority TEXT, due TEXT, tags TEXT, assignee_agent_id TEXT, project_id TEXT, last_update TEXT);
      CREATE TABLE IF NOT EXISTS card_activity (id TEXT PRIMARY KEY, card_id TEXT, ts TEXT, action TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS reporting_lines (id TEXT PRIMARY KEY, manager_id TEXT, report_id TEXT, created_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
      CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
      CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
      CREATE INDEX IF NOT EXISTS idx_activity_card ON card_activity(card_id);
      CREATE INDEX IF NOT EXISTS idx_boards_agent ON boards(agent_id);
    `);
    const kb = new Kanban(db, resolved);
    await kb.persist();
    return kb;
  }

  private async persist() {
    const data = this.db.export();
    const tmpPath = `${this.path}.tmp`;
    await fs.writeFile(tmpPath, Buffer.from(data));
    await fs.rename(tmpPath, this.path);
  }

  async close(): Promise<void> {
    await this.persist();
  }

  /** sql.js has no .all() — iterate with .step() to collect all rows. */
  private queryAll(sql: string, params?: unknown[]): unknown[][] {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: unknown[][] = [];
    while (stmt.step()) results.push(stmt.get() as unknown[]);
    stmt.free();
    return results;
  }

  /** sql.js has no .get([params]) — use bind → step → getAsObject. */
  private queryOneObject<T>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const result = stmt.step() ? (stmt.getAsObject() as T) : undefined;
    stmt.free();
    return result;
  }

  /** sql.js has no .get([params]) — returns array-indexed row for mapCardPartial. */
  private queryOneArray(sql: string, params?: unknown[]): unknown[] | undefined {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const result = stmt.step() ? (stmt.get() as unknown[]) : undefined;
    stmt.free();
    return result;
  }

  async ensureBoard(agentId: string, name: string) {
    await validateAgentIdentity(agentId);
    const boardRow = this.queryOneObject<{ id: string }>("SELECT id FROM boards WHERE agent_id=?", [agentId]);
    if (boardRow) return boardRow.id;

    const boardId = uuidv4();
    const statuses: [CardStatus, number][] = [["Backlog",1],["Todo",2],["In Progress",3],["Blocked",4],["Review",5],["Done",6]];

    const trx = this.db.transaction(() => {
      this.db.run("INSERT INTO boards (id, agent_id, name) VALUES (?,?,?)", [boardId, agentId, name]);
      for (const [n, ord] of statuses) this.db.run("INSERT INTO columns (id, board_id, name, ord) VALUES (?,?,?,?)", [uuidv4(), boardId, n, ord]);
    });
    trx();
    await this.persist();
    return boardId;
  }

  async addCard(agentId: string, title: string, description: string, priority: string, due: string|null, tags: string[], projectId?: string) {
    await validateAgentIdentity(agentId);
    const board = this.queryOneObject<{ id: string }>("SELECT id FROM boards WHERE agent_id=?", [agentId]);
    if (!board) throw new Error("Board not found");
    const boardId = board.id;
    const column = this.queryOneObject<{ id: string }>("SELECT id FROM columns WHERE board_id=? AND name=?", [boardId, "Backlog"]);
    const columnId = column?.id;
    if (!columnId) throw new Error("Backlog column not found");
    const id = uuidv4();
    const now = new Date().toISOString();

    const trx = this.db.transaction(() => {
      this.db.run("INSERT INTO cards (id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id, boardId, columnId, title, description, priority, due, JSON.stringify(tags), agentId, projectId || null, now]);
      this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", [uuidv4(), id, now, "create", JSON.stringify({ title })]);
    });
    trx();
    await this.persist();
    return id;
  }

  async moveCard(agentId: string, cardId: string, status: CardStatus) {
    await validateAgentIdentity(agentId);

    const cardRow = this.queryOneArray(`SELECT ${CARD_COLUMNS} FROM cards WHERE id=?`, [cardId]);
    if (!cardRow) throw new Error("Card not found");
    const card = mapCardPartial(cardRow);
    const board = this.queryOneObject<{ id: string; agent_id: string }>("SELECT id, agent_id FROM boards WHERE id=?", [card.board_id]);
    if (!board) throw new Error("Board not found");
    if (board.agent_id !== agentId) throw new Error("Not authorized: board does not belong to agent");

    const column = this.queryOneObject<{ id: string }>("SELECT id FROM columns WHERE board_id=? AND name=?", [board.id, status]);
    if (!column) throw new Error(`Column '${status}' not found`);
    const now = new Date().toISOString();

    const trx = this.db.transaction(() => {
      this.db.run("UPDATE cards SET column_id=?, last_update=? WHERE id=?", [column.id, now, cardId]);
      this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", [uuidv4(), cardId, now, "move", JSON.stringify({ to: status })]);
    });
    trx();
    await this.persist();
  }

  async getBoard(agentId: string): Promise<KanbanBoard | null> {
    await validateAgentIdentity(agentId);
    const boardRow = this.queryOneObject<{ id: string; agent_id: string; name: string }>("SELECT id, agent_id, name FROM boards WHERE agent_id=?", [agentId]);
    if (!boardRow) return null;

    const boardId = boardRow.id;
    const columnRows = this.queryAll("SELECT id, name FROM columns WHERE board_id=? ORDER BY ord", [boardId]) as unknown[][];

    const board: KanbanBoard = {
      id: boardId,
      agent_id: agentId,
      name: boardRow.name,
      columns: []
    };

    for (const colRow of columnRows) {
      const colId = (colRow as unknown[])[0] as string;
      const colName = (colRow as unknown[])[1] as string;

      const rows = this.queryAll(`SELECT ${CARD_COLUMNS} FROM cards WHERE column_id=?`, [colId]);

      board.columns.push({
        id: colId,
        name: colName,
        cards: rows ? rows.map((row: unknown[]) => mapCard(row, colName)) : []
      });
    }

    return board;
  }

  async viewReportsBoard(managerId: string): Promise<Array<{ agent_id: string; board: KanbanBoard }>> {
    await validateAgentIdentity(managerId);
    const reports = getDirectReports(managerId);
    const results: Array<{ agent_id: string; board: KanbanBoard }> = [];

    for (const report of reports) {
      const board = await this.getBoard(report.id);
      if (board) {
        results.push({ agent_id: report.id, board });
      }
    }

    return results;
  }

  /** Column names for a board, ordered. */
  private getColumnNames(boardId: string): string[] {
    const rows = this.queryAll("SELECT name FROM columns WHERE board_id=? ORDER BY ord", [boardId]);
    return rows.map(r => (r as unknown[])[0] as string);
  }

  async reassignCard(cardId: string, fromAgentId: string, toAgentId: string, managerId: string): Promise<void> {
    await validateAgentIdentity(managerId);
    await validateAgentIdentity(fromAgentId);
    await validateAgentIdentity(toAgentId);

    const reports = getDirectReports(managerId);
    const reportIds = reports.map(r => r.id);

    if (!reportIds.includes(fromAgentId)) {
      throw new Error(`${managerId} is not manager of ${fromAgentId}`);
    }
    if (!reportIds.includes(toAgentId)) {
      throw new Error(`${managerId} is not manager of ${toAgentId}`);
    }

    const cardRow = this.queryOneArray(`SELECT ${CARD_COLUMNS} FROM cards WHERE id=?`, [cardId]);
    if (!cardRow) throw new Error("Card not found");
    const card = mapCardPartial(cardRow);

    if (card.assignee_agent_id !== fromAgentId) {
      throw new Error(`Card ${cardId} is not assigned to ${fromAgentId} (actual: ${card.assignee_agent_id})`);
    }

    const fromBoard = this.queryOneObject<{ id: string }>("SELECT id FROM boards WHERE agent_id=?", [fromAgentId]);
    const toBoard = this.queryOneObject<{ id: string }>("SELECT id FROM boards WHERE agent_id=?", [toAgentId]);

    if (!fromBoard || !toBoard) throw new Error("Board not found for one of the agents");

    const columnNames = this.getColumnNames(fromBoard.id);
    const srcColumn = this.queryOneObject<{ name: string }>("SELECT name FROM columns WHERE id=?", [card.column_id]);
    const columnName = srcColumn?.name;
    if (!columnName || !columnNames.includes(columnName)) {
      throw new Error(`Source column '${columnName || 'unknown'}' not found in board ${fromBoard.id}`);
    }

    const newColumn = this.queryOneObject<{ id: string }>("SELECT id FROM columns WHERE board_id=? AND name=?", [toBoard.id, columnName]);
    if (!newColumn) {
      throw new Error(`Target board ${toBoard.id} has no column named '${columnName}'`);
    }

    const now = new Date().toISOString();
    const trx = this.db.transaction(() => {
      this.db.run("UPDATE cards SET board_id=?, column_id=?, assignee_agent_id=?, last_update=? WHERE id=?",
        [toBoard.id, newColumn.id, toAgentId, now, cardId]);
      this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)",
        [uuidv4(), cardId, now, "reassign", JSON.stringify({ from: fromAgentId, to: toAgentId })]);
    });
    trx();
    await this.persist();
    logger.info({ cardId, from: fromAgentId, to: toAgentId }, "Card reassigned");
  }

  async escalateCard(cardId: string, callerAgentId: string, toManagerId: string, reason: string): Promise<void> {
    await validateAgentIdentity(callerAgentId);
    await validateAgentIdentity(toManagerId);

    const cardRow = this.queryOneArray(`SELECT ${CARD_COLUMNS} FROM cards WHERE id=?`, [cardId]);
    if (!cardRow) throw new Error("Card not found");
    const card = mapCardPartial(cardRow);

    if (card.assignee_agent_id !== callerAgentId) {
      throw new Error("Not authorized: caller does not own this card");
    }

    const directReports = getDirectReports(toManagerId);
    if (directReports.length === 0) {
      throw new Error(`${toManagerId} is not a manager (has no direct reports)`);
    }

    this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)",
      [uuidv4(), cardId, new Date().toISOString(), "escalate", JSON.stringify({ to: toManagerId, reason, from: callerAgentId })]);

    await this.persist();
    logger.info({ cardId, to: toManagerId, reason, from: callerAgentId }, "Card escalated");
  }

  async getCard(cardId: string): Promise<KanbanCard | null> {
    const cardRow = this.queryOneArray(`SELECT ${CARD_COLUMNS} FROM cards WHERE id=?`, [cardId]);
    if (!cardRow) return null;

    const card = mapCardPartial(cardRow);
    const columnRow = this.queryOneObject<{ name: string }>("SELECT name FROM columns WHERE id=?", [card.column_id]);

    return {
      ...card,
      status: columnRow ? columnRow.name as CardStatus : "Backlog"
    };
  }

  listAgents(): string[] {
    const rows = this.queryAll("SELECT DISTINCT agent_id FROM boards");
    return rows.map(r => (r as unknown[])[0] as string);
  }
}
