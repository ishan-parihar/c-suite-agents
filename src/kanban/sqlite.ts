import initSqlJs from "sql.js";
import { promises as fs } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getStaffById, getDirectReports } from "../staff/core-staff.js";
import { validateAgentIdentity } from "../auth/session.js";

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
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

export class Kanban {
  private constructor(private db: DBAny, private path: string) {}

  static async init(path: string) {
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
    let db: DBAny;
    try {
      const buf = await fs.readFile(path);
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
    `);
    const kb = new Kanban(db, path);
    await kb.persist();
    return kb;
  }

  private async persist() {
    const data = this.db.export();
    await fs.writeFile(this.path, Buffer.from(data));
  }

  async ensureBoard(agentId: string, name: string) {
    await validateAgentIdentity(agentId);
    const safeAgentId = escapeSql(agentId);
    const row = this.db.exec(`SELECT id FROM boards WHERE agent_id='${safeAgentId}'`)[0]?.values?.[0];
    if (row) return row[0] as string;
    const boardId = uuidv4();
    this.db.run("INSERT INTO boards (id, agent_id, name) VALUES (?,?,?)", [boardId, agentId, name]);
    const statuses: [CardStatus, number][] = [["Backlog",1],["Todo",2],["In Progress",3],["Blocked",4],["Review",5],["Done",6]];
    for (const [n, ord] of statuses) this.db.run("INSERT INTO columns (id, board_id, name, ord) VALUES (?,?,?,?)", [uuidv4(), boardId, n, ord]);
    await this.persist();
    return boardId;
  }

  async addCard(agentId: string, title: string, description: string, priority: string, due: string|null, tags: string[]) {
    await validateAgentIdentity(agentId);
    const safeAgentId = escapeSql(agentId);
    const board = this.db.exec(`SELECT id FROM boards WHERE agent_id='${safeAgentId}'`)[0]?.values?.[0];
    if (!board) throw new Error("Board not found");
    const boardId = board[0] as string;
    const column = this.db.exec(`SELECT id FROM columns WHERE board_id='${boardId}' AND name='Backlog'`)[0]?.values?.[0];
    const columnId = column[0] as string;
    const id = uuidv4();
    this.db.run("INSERT INTO cards (id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, last_update) VALUES (?,?,?,?,?,?,?,?,?,?)", [id, boardId, columnId, title, description, priority, due, JSON.stringify(tags), agentId, new Date().toISOString()]);
    this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", [uuidv4(), id, new Date().toISOString(), "create", JSON.stringify({ title })]);
    await this.persist();
    return id;
  }

  async moveCard(cardId: string, status: CardStatus) {
    const safeCardId = escapeSql(cardId);
    const card = this.db.exec(`SELECT * FROM cards WHERE id='${safeCardId}'`)[0]?.values?.[0];
    if (!card) throw new Error("Card not found");
    const boardId = card[1] as string;
    const safeStatus = escapeSql(status);
    const column = this.db.exec(`SELECT id FROM columns WHERE board_id='${boardId}' AND name='${safeStatus}'`)[0]?.values?.[0];
    const columnId = column[0] as string;
    this.db.run("UPDATE cards SET column_id=?, last_update=? WHERE id=?", [columnId, new Date().toISOString(), cardId]);
    this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", [uuidv4(), cardId, new Date().toISOString(), "move", JSON.stringify({ to: status })]);
    await this.persist();
  }

  async getBoard(agentId: string): Promise<KanbanBoard | null> {
    await validateAgentIdentity(agentId);
    const safeAgentId = escapeSql(agentId);
    const boardRow = this.db.exec(`SELECT id, agent_id, name FROM boards WHERE agent_id='${safeAgentId}'`)[0]?.values?.[0];
    if (!boardRow) return null;
    
    const boardId = boardRow[0] as string;
    const columns = this.db.exec(`SELECT id, name FROM columns WHERE board_id='${boardId}' ORDER BY ord`);
    
    const board: KanbanBoard = {
      id: boardId,
      agent_id: agentId,
      name: boardRow[2] as string,
      columns: []
    };

    for (const colRow of columns[0]?.values || []) {
      const colId = colRow[0] as string;
      const colName = colRow[1] as string;
      
      const cards = this.db.exec(`SELECT id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update FROM cards WHERE column_id='${colId}'`);
      
      board.columns.push({
        id: colId,
        name: colName,
        cards: cards[0]?.values.map((row: any[]) => ({
          id: row[0] as string,
          board_id: row[1] as string,
          column_id: row[2] as string,
          title: row[3] as string,
          description: row[4] as string,
          priority: row[5] as string,
          due: row[6] as string | null,
          tags: JSON.parse(row[7] as string),
          assignee_agent_id: row[8] as string,
          project_id: row[9] as string | null,
          last_update: row[10] as string,
          status: colName as CardStatus
        })) || []
      });
    }

    return board;
  }

  // Manager visibility: View all reports' boards
  async viewReportsBoard(managerId: string): Promise<Array<{ agent_id: string; board: KanbanBoard }>> {
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

  // Manager reassign: Move card from one report to another
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
    
    const safeCardId = escapeSql(cardId);
    const card = this.db.exec(`SELECT * FROM cards WHERE id='${safeCardId}'`)[0]?.values?.[0];
    if (!card) throw new Error("Card not found");

    const safeFromAgentId = escapeSql(fromAgentId);
    const safeToAgentId = escapeSql(toAgentId);
    const fromBoard = this.db.exec(`SELECT id FROM boards WHERE agent_id='${safeFromAgentId}'`)[0]?.values?.[0];
    const toBoard = this.db.exec(`SELECT id FROM boards WHERE agent_id='${safeToAgentId}'`)[0]?.values?.[0];
    
    if (!fromBoard || !toBoard) throw new Error("Board not found for one of the agents");

    const columnId = card[2] as string;
    const newColumn = this.db.exec(`SELECT id FROM columns WHERE board_id='${toBoard[0]}' AND name='${card[10]}'`)[0]?.values?.[0];
    
    if (newColumn) {
      this.db.run("UPDATE cards SET board_id=?, column_id=?, assignee_agent_id=?, last_update=? WHERE id=?", 
        [toBoard[0], newColumn[0], toAgentId, new Date().toISOString(), cardId]);
      
      this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", 
        [uuidv4(), cardId, new Date().toISOString(), "reassign", JSON.stringify({ from: fromAgentId, to: toAgentId })]);
      
      await this.persist();
      logger.info({ cardId, from: fromAgentId, to: toAgentId }, "Card reassigned");
    }
  }

  // Escalate card to manager
  async escalateCard(cardId: string, toManagerId: string, reason: string): Promise<void> {
    await validateAgentIdentity(toManagerId);
    const safeCardId = escapeSql(cardId);
    const card = this.db.exec(`SELECT * FROM cards WHERE id='${safeCardId}'`)[0]?.values?.[0];
    if (!card) throw new Error("Card not found");

    this.db.run("INSERT INTO card_activity (id, card_id, ts, action, payload) VALUES (?,?,?,?,?)", 
      [uuidv4(), cardId, new Date().toISOString(), "escalate", JSON.stringify({ to: toManagerId, reason })]);
    
    await this.persist();
    logger.info({ cardId, to: toManagerId, reason }, "Card escalated");
  }

  // Get card by ID
  async getCard(cardId: string): Promise<KanbanCard | null> {
    const safeCardId = escapeSql(cardId);
    const card = this.db.exec(`SELECT id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update FROM cards WHERE id='${safeCardId}'`)[0]?.values?.[0];
    if (!card) return null;

    const boardId = card[1] as string;
    const columnId = card[2] as string;
    const columnRow = this.db.exec(`SELECT name FROM columns WHERE id='${columnId}'`)[0]?.values?.[0];

    return {
      id: card[0] as string,
      board_id: boardId,
      column_id: columnId,
      title: card[3] as string,
      description: card[4] as string,
      priority: card[5] as string,
      due: card[6] as string | null,
      tags: JSON.parse(card[7] as string),
      assignee_agent_id: card[8] as string,
      project_id: card[9] as string | null,
      last_update: card[10] as string,
      status: columnRow ? columnRow[0] as CardStatus : "Backlog"
    };
  }

  listAgents(): string[] {
    const rows = this.db.exec("SELECT DISTINCT agent_id FROM boards");
    if (!rows.length) return [];
    return rows[0].values.map((v: any) => String(v[0]));
  }
}
