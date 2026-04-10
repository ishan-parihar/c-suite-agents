import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getDirectReports } from "../staff/core-staff.js";
import { validateAgentIdentity } from "../auth/session.js";

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

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

export class Kanban {
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static async init(dbPath: string) {
    const resolved = path.resolve(dbPath);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${dbPath}`);
    }

    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });

    const db = new Database(resolved);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
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

    return new Kanban(db);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async ensureBoard(agentId: string, name: string, columns?: string[]) {
    await validateAgentIdentity(agentId);
    
    const boardRow = this.db.prepare("SELECT id FROM boards WHERE agent_id=?").get(agentId) as { id: string } | undefined;
    if (boardRow) return boardRow.id;

    const boardId = uuidv4();
    const defaultColumns: CardStatus[] = ["Backlog","Todo","In Progress","Blocked","Review","Done"];
    const cols = columns || defaultColumns;

    const createTransaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO boards (id, agent_id, name) VALUES (?,?,?)").run(boardId, agentId, name);
      const insertCol = this.db.prepare("INSERT INTO columns (id, board_id, name, ord) VALUES (?,?,?,?)");
      for (let i = 0; i < cols.length; i++) {
        insertCol.run(uuidv4(), boardId, cols[i], i + 1);
      }
    });

    createTransaction();
    return boardId;
  }

  async addCard(agentId: string, title: string, description: string, priority: string, due: string|null, tags: string[], projectId?: string) {
    await validateAgentIdentity(agentId);
    
    const board = this.db.prepare("SELECT id FROM boards WHERE agent_id=?").get(agentId) as { id: string } | undefined;
    if (!board) throw new Error("Board not found");
    
    const boardId = board.id;
    
    let column = this.db.prepare("SELECT id FROM columns WHERE board_id=? AND name=?").get(boardId, "Backlog") as { id: string } | undefined;
    if (!column?.id) {
      column = this.db.prepare("SELECT id FROM columns WHERE board_id=? ORDER BY ord LIMIT 1").get(boardId) as { id: string } | undefined;
    }
    const columnId = column?.id;
    if (!columnId) throw new Error("No columns found on board");
    
    const id = uuidv4();
    const now = new Date().toISOString();

    const insertTransaction = this.db.transaction(() => {
      this.db.prepare(
        "INSERT INTO cards (id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).run(id, boardId, columnId, title, description, priority, due, JSON.stringify(tags), agentId, projectId || null, now);
      
      this.db.prepare(
        "INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)"
      ).run(uuidv4(), id, now, "create", JSON.stringify({ title }));
    });

    insertTransaction();
    return id;
  }

  async moveCard(agentId: string, cardId: string, status: CardStatus) {
    await validateAgentIdentity(agentId);

    const cardRow = this.db.prepare(
      "SELECT id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update FROM cards WHERE id=?"
    ).get(cardId) as (Omit<KanbanCard, 'status' | 'tags'> & { tags: string }) | undefined;
    
    if (!cardRow) throw new Error("Card not found");
    
    const board = this.db.prepare("SELECT id, agent_id FROM boards WHERE id=?").get(cardRow.board_id) as { id: string; agent_id: string } | undefined;
    if (!board) throw new Error("Board not found");
    if (board.agent_id !== agentId) throw new Error("Not authorized: board does not belong to agent");

    const column = this.db.prepare("SELECT id FROM columns WHERE board_id=? AND name=?").get(board.id, status) as { id: string } | undefined;
    if (!column) throw new Error(`Column '${status}' not found`);
    
    const now = new Date().toISOString();

    const moveTransaction = this.db.transaction(() => {
      this.db.prepare("UPDATE cards SET column_id=?, last_update=? WHERE id=?").run(column.id, now, cardId);
      this.db.prepare("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)")
        .run(uuidv4(), cardId, now, "move", JSON.stringify({ to: status }));
    });

    moveTransaction();
  }

  async getBoard(agentId: string): Promise<KanbanBoard | null> {
    await validateAgentIdentity(agentId);
    
    const boardRow = this.db.prepare("SELECT id, name FROM boards WHERE agent_id=?").get(agentId) as { id: string; name: string } | undefined;
    if (!boardRow) return null;

    const boardId = boardRow.id;
    const columnRows = this.db.prepare("SELECT id, name FROM columns WHERE board_id=? ORDER BY ord").all(boardId) as Array<{ id: string; name: string }>;

    const board: KanbanBoard = {
      id: boardId,
      agent_id: agentId,
      name: boardRow.name,
      columns: []
    };

    const getCardsStmt = this.db.prepare("SELECT id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update FROM cards WHERE column_id=?");
    
    for (const colRow of columnRows) {
      const dbCards = getCardsStmt.all(colRow.id) as Array<Omit<KanbanCard, 'status' | 'tags'> & { tags: string }>;
      
      const cards: KanbanCard[] = dbCards.map(c => ({
        ...c,
        tags: safeJsonParse(c.tags, []),
        status: colRow.name as CardStatus
      }));

      board.columns.push({
        id: colRow.id,
        name: colRow.name,
        cards
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

  private getColumnNames(boardId: string): string[] {
    const rows = this.db.prepare("SELECT name FROM columns WHERE board_id=? ORDER BY ord").all(boardId) as Array<{ name: string }>;
    return rows.map(r => r.name);
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

    const cardRow = this.db.prepare("SELECT column_id, assignee_agent_id FROM cards WHERE id=?").get(cardId) as { column_id: string; assignee_agent_id: string } | undefined;
    if (!cardRow) throw new Error("Card not found");

    if (cardRow.assignee_agent_id !== fromAgentId) {
      throw new Error(`Card ${cardId} is not assigned to ${fromAgentId} (actual: ${cardRow.assignee_agent_id})`);
    }

    const fromBoard = this.db.prepare("SELECT id FROM boards WHERE agent_id=?").get(fromAgentId) as { id: string } | undefined;
    const toBoard = this.db.prepare("SELECT id FROM boards WHERE agent_id=?").get(toAgentId) as { id: string } | undefined;

    if (!fromBoard || !toBoard) throw new Error("Board not found for one of the agents");

    const columnNames = this.getColumnNames(fromBoard.id);
    const srcColumn = this.db.prepare("SELECT name FROM columns WHERE id=?").get(cardRow.column_id) as { name: string } | undefined;
    const columnName = srcColumn?.name;
    
    if (!columnName || !columnNames.includes(columnName)) {
      throw new Error(`Source column '${columnName || 'unknown'}' not found in board ${fromBoard.id}`);
    }

    const newColumn = this.db.prepare("SELECT id FROM columns WHERE board_id=? AND name=?").get(toBoard.id, columnName) as { id: string } | undefined;
    if (!newColumn) {
      throw new Error(`Target board ${toBoard.id} has no column named '${columnName}'`);
    }

    const now = new Date().toISOString();
    
    const reassignTransaction = this.db.transaction(() => {
      this.db.prepare("UPDATE cards SET board_id=?, column_id=?, assignee_agent_id=?, last_update=? WHERE id=?")
        .run(toBoard.id, newColumn.id, toAgentId, now, cardId);
      this.db.prepare("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)")
        .run(uuidv4(), cardId, now, "reassign", JSON.stringify({ from: fromAgentId, to: toAgentId }));
    });

    reassignTransaction();
    logger.info({ cardId, from: fromAgentId, to: toAgentId }, "Card reassigned");
  }

  async escalateCard(cardId: string, callerAgentId: string, toManagerId: string, reason: string): Promise<void> {
    await validateAgentIdentity(callerAgentId);
    await validateAgentIdentity(toManagerId);

    const cardRow = this.db.prepare("SELECT assignee_agent_id FROM cards WHERE id=?").get(cardId) as { assignee_agent_id: string } | undefined;
    if (!cardRow) throw new Error("Card not found");

    if (cardRow.assignee_agent_id !== callerAgentId) {
      throw new Error("Not authorized: caller does not own this card");
    }

    const directReports = getDirectReports(toManagerId);
    if (directReports.length === 0) {
      throw new Error(`${toManagerId} is not a manager (has no direct reports)`);
    }

    this.db.prepare("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)")
      .run(uuidv4(), cardId, new Date().toISOString(), "escalate", JSON.stringify({ to: toManagerId, reason, from: callerAgentId }));

    logger.info({ cardId, to: toManagerId, reason, from: callerAgentId }, "Card escalated");
  }

  async getCard(cardId: string): Promise<KanbanCard | null> {
    const cardRow = this.db.prepare("SELECT id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update FROM cards WHERE id=?").get(cardId) as (Omit<KanbanCard, 'status' | 'tags'> & { tags: string }) | undefined;
    if (!cardRow) return null;

    const columnRow = this.db.prepare("SELECT name FROM columns WHERE id=?").get(cardRow.column_id) as { name: string } | undefined;

    return {
      ...cardRow,
      tags: safeJsonParse(cardRow.tags, []),
      status: columnRow ? columnRow.name as CardStatus : "Backlog"
    };
  }

  listAgents(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT agent_id FROM boards").all() as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
  }
}
