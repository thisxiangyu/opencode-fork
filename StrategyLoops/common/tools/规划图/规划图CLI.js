/* 基于 规划图CLI.ts 构建 */
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var CLI_exports = {};
__export(CLI_exports, {
  TIME_PERIODS: () => TIME_PERIODS,
  WRITE_KEY_HASH: () => WRITE_KEY_HASH,
  formatDateTime: () => formatDateTime,
  getDb: () => getDb,
  getTimePeriod: () => getTimePeriod,
  initDb: () => initDb,
  initDbStrict: () => initDbStrict,
  任务: () => 任务,
  任务Tag: () => 任务Tag,
  任务依赖: () => 任务依赖,
  加载根任务: () => 加载根任务,
  动态记录: () => 动态记录,
  当前表中全部任务数: () => 当前表中全部任务数,
  当前表中总任务数_仅末端: () => 当前表中总任务数_仅末端,
  当前项目名: () => 当前项目名,
  查询规划图_返回视图: () => 查询规划图_返回视图,
  检查环境完整性: () => 检查环境完整性,
  规划图: () => 规划图,
  规划图dbPath: () => 规划图dbPath,
  解析任务行: () => 解析任务行
});
module.exports = __toCommonJS(CLI_exports);
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_path = require("path");
var import_fs = require("fs");
var import_url = require("url");
const import_meta = {};
const scriptDir = import_meta.url ? (0, import_path.dirname)((0, import_url.fileURLToPath)(import_meta.url)) : __dirname;
const WRITE_KEY_HASH = 0x9ee19172f78b1ecen;
const TIME_PERIODS = [
  "早晨",
  // 5:00-7:59
  "上午",
  // 8:00-11:59
  "中午",
  // 12:00-12:59
  "下午",
  // 13:00-17:59
  "傍晚",
  // 18:00-18:59
  "晚上",
  // 19:00-23:59
  "午夜"
  // 0:00-4:59
];
function getTimePeriod(date = /* @__PURE__ */ new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "早晨";
  if (hour >= 8 && hour < 12) return "上午";
  if (hour >= 12 && hour < 13) return "中午";
  if (hour >= 13 && hour < 18) return "下午";
  if (hour >= 18 && hour < 19) return "傍晚";
  if (hour >= 19 && hour < 24) return "晚上";
  return "午夜";
}
function formatDateTime(options) {
  const date = new Date(options.isoString);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const period = options.period === "auto" || options.period === void 0 ? getTimePeriod(date) : options.period;
  const yearStr = options.showYear !== false ? `${year}年` : "";
  const periodStr = options.showPeriod ? `${period}` : "";
  const timeStr = options.showTime ? ` ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}${options.showSeconds ? `:${date.getSeconds().toString().padStart(2, "0")}` : ""}` : "";
  return `${yearStr}${month}月${day}日${periodStr}${timeStr}`;
}
const 任务Tag = {
  DETAIL: "detail",
  ADD: "add",
  FEAT: "feat",
  FIX: "fix",
  REFACTOR: "refactor",
  BIG_CHANGE: "BIG_CHANGE",
  CHORE: "chore",
  ADJUST: "adjust",
  REVERT: "revert",
  TEST: "test",
  EXPLORE: "explore_in_progress",
  MERGE: "merge",
  MILESTONE: "milestone"
};
const 合法的Tag列表 = Object.values(任务Tag);
function 校验Tag合法性(tag) {
  return 合法的Tag列表.includes(tag);
}
function 校验所有Tag(tags) {
  for (const tag of tags) {
    if (!校验Tag合法性(tag)) {
      return `存在无效的Tag，必须且只能在以下Tag中选择：${合法的Tag列表.join("、")}`;
    }
  }
  return null;
}
class 任务 {
  id;
  标题;
  父任务ID;
  Tag;
  任务描述;
  是否完成 = false;
  创建时间UTC;
  优先级序号;
  依赖;
  已删除 = false;
  动态 = [];
}
class 任务依赖 {
  "依赖任务ID";
  "原因";
}
class 动态记录 {
  时间UTC;
  角色;
  消息;
}
function 校验同级依赖规则(任务标题, 父任务ID, 优先级序号, 依赖) {
  if (依赖.length === 0 || 父任务ID === null) return null;
  const 同级任务 = 获取规划图Db().prepare(
    "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID);
  for (const dep of 依赖) {
    const 依赖任务 = 同级任务.find((t) => t.id === dep.依赖任务ID);
    if (依赖任务) {
      const 依赖任务优先级 = 解析任务行(依赖任务).优先级序号 ?? 0;
      if (优先级序号 <= 依赖任务优先级) {
        return { 成功: false, 消息: `同级任务情况下，前者(优先级序号更小)不能依赖后者（优先级序号更大），请重新从整体依赖设计出发，权衡任务《${任务标题}》和《${依赖展示标题(dep)}》的优先级，判断是否是错误的优先级规划或错误的依赖关系。如果重要任务一定要提前做，也可以考虑采取将这个重要任务拆成两个任务：一个开发时过渡性任务、一个正式态完善/补足任务， 让开发时过渡提前做完，形成更细的任务顺序：过渡性任务->依赖过渡性任务的任务->正式态完善/补足` };
      }
    }
  }
  return null;
}
function 统计子任务数(父任务ID) {
  const children = 获取规划图Db().prepare(
    "SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID);
  let count = children.length;
  for (const child of children) {
    count += 统计子任务数(child.id);
  }
  return count;
}
function 检查所有子任务是否已完成(父任务ID) {
  const children = 获取规划图Db().prepare(
    "SELECT id, 是否完成 FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID);
  for (const child of children) {
    if (!child.是否完成) return false;
    if (!检查所有子任务是否已完成(child.id)) return false;
  }
  return true;
}
function 尝试向上自动完成(刚完成的任务ID) {
  const 刚完成的任务 = 获取规划图Db().prepare(
    "SELECT 父任务ID FROM 规划图 WHERE id = ? AND 是否删除 = 0"
  ).get(刚完成的任务ID);
  if (!刚完成的任务 || 刚完成的任务.父任务ID === null) {
    return;
  }
  const 父任务ID = 刚完成的任务.父任务ID;
  const 同级任务 = 获取规划图Db().prepare(
    "SELECT 是否完成 FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID);
  const allSiblingsDone = 同级任务.every((s) => s.是否完成);
  if (allSiblingsDone) {
    获取规划图Db().prepare(
      "UPDATE 规划图 SET 是否完成 = 1 WHERE id = ?"
    ).run(父任务ID);
    尝试向上自动完成(父任务ID);
  }
}
function 级联更新字段(父任务ID, 字段, 值) {
  const children = 获取规划图Db().prepare(
    "SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID);
  for (const child of children) {
    级联更新字段(child.id, 字段, 值);
  }
  获取规划图Db().prepare(`UPDATE 规划图 SET ${字段} = ? WHERE id = ?`).run(值, 父任务ID);
}
let db;
let 规划图dbPath;
let 当前项目名;
function 获取规划图Db() {
  if (!db) throw new Error("规划图数据库未初始化，请先调用 initDb()");
  return db;
}
function initDb(项目名, 数据库目录) {
  当前项目名 = 项目名;
  const 项目目录 = (0, import_path.join)(数据库目录 ?? scriptDir, "data", `.scheduleMap.${项目名}`);
  if (!(0, import_fs.existsSync)(项目目录)) {
    (0, import_fs.mkdirSync)(项目目录, { recursive: true });
  }
  规划图dbPath = (0, import_path.join)(项目目录, `${项目名}ScheduleMap.db`);
  db = new import_better_sqlite3.default(规划图dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS 规划图 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      标题 TEXT UNIQUE NOT NULL,
      父任务ID INTEGER,
      Tag TEXT NOT NULL,
      任务描述 TEXT NOT NULL,
      是否完成 INTEGER DEFAULT 0,
      创建时间UTC TEXT NOT NULL,
      优先级序号 INTEGER DEFAULT 0,
      依赖 TEXT,
      是否删除 INTEGER DEFAULT 0,
      动态 TEXT
    )
  `);
  迁移依赖为ID存储();
  return db;
}
function initDbStrict(项目名) {
  const 项目目录 = (0, import_path.join)(scriptDir, "data", `.scheduleMap.${项目名}`);
  if ((0, import_fs.existsSync)(项目目录)) {
    throw new Error(`项目目录已存在: ${项目目录}`);
  }
  return initDb(项目名);
}
function 检查环境完整性(项目名) {
  const 项目目录 = (0, import_path.join)(scriptDir, "data", `.scheduleMap.${项目名}`);
  if (!(0, import_fs.existsSync)(项目目录)) {
    return { 成功: false, 消息: `项目目录不存在: ${项目目录}` };
  }
  const dbPath = (0, import_path.join)(项目目录, `${项目名}ScheduleMap.db`);
  if (!(0, import_fs.existsSync)(dbPath)) {
    return { 成功: false, 消息: `数据库丢失: ${dbPath}，项目目录存在但数据库文件不存在` };
  }
  return { 成功: true, 消息: "环境检查通过" };
}
function getDb() {
  return 获取规划图Db();
}
function 当前表中全部任务数() {
  const result = 获取规划图Db().prepare("SELECT COUNT(*) as count FROM 规划图 WHERE 是否删除 = 0").get();
  return result?.count ?? 0;
}
function 当前表中总任务数_仅末端() {
  const result = 获取规划图Db().prepare("SELECT COUNT(*) as count FROM 规划图 WHERE 是否删除 = 0 AND id NOT IN (SELECT DISTINCT 父任务ID FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NOT NULL)").get();
  return result?.count ?? 0;
}
function 加载根任务() {
  const rows = 获取规划图Db().prepare(
    "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NULL ORDER BY 优先级序号 ASC"
  ).all();
  return rows.map(解析任务行);
}
function 计算移动目标优先级(父任务ID, 新任务优先级序号) {
  let maxResult;
  if (父任务ID === null) {
    maxResult = 获取规划图Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), 0) as maxPri FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NULL"
    ).get();
  } else {
    maxResult = 获取规划图Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), 0) as maxPri FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
    ).get(父任务ID);
  }
  if (新任务优先级序号 < 0) return 0;
  return 新任务优先级序号 > maxResult.maxPri ? maxResult.maxPri : 新任务优先级序号;
}
function 计算实际优先级序号(父任务ID, 新任务优先级序号) {
  let maxResult;
  if (父任务ID === null) {
    maxResult = 获取规划图Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), -1) as maxPri FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NULL"
    ).get();
  } else {
    maxResult = 获取规划图Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), -1) as maxPri FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
    ).get(父任务ID);
  }
  const clamped = 新任务优先级序号 < 0 ? 0 : 新任务优先级序号;
  return clamped > maxResult.maxPri + 1 ? maxResult.maxPri + 1 : clamped;
}
function 插入任务并更新同级优先级(父任务ID, 新任务优先级序号) {
  const 实际优先级序号 = 计算实际优先级序号(父任务ID, 新任务优先级序号);
  if (父任务ID === null) {
    获取规划图Db().prepare(
      "UPDATE 规划图 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID IS NULL AND 优先级序号 >= ?"
    ).run(实际优先级序号);
    return 实际优先级序号;
  }
  获取规划图Db().prepare(
    "UPDATE 规划图 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID = ? AND 优先级序号 >= ?"
  ).run(父任务ID, 实际优先级序号);
  return 实际优先级序号;
}
function 压紧同级优先级(父任务ID) {
  const rows = 父任务ID === null ? 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NULL ORDER BY 优先级序号 ASC, id ASC").all() : 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ? ORDER BY 优先级序号 ASC, id ASC").all(父任务ID);
  rows.forEach((row, index) => {
    获取规划图Db().prepare("UPDATE 规划图 SET 优先级序号 = ? WHERE id = ?").run(index, row.id);
  });
}
function 查找未删除任务By标题或ID(标题, idRaw, 名称) {
  if (idRaw !== void 0 && String(idRaw).trim()) {
    const id = typeof idRaw === "number" ? idRaw : parseInt(idRaw);
    if (isNaN(id) || id <= 0) return { 成功: false, 消息: `${名称}ID必须是有效的正整数` };
    const row2 = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE id = ? AND 是否删除 = 0").get(id);
    if (!row2) return { 成功: false, 消息: `${名称}ID「${id}」不存在` };
    return { 成功: true, row: row2 };
  }
  const 标题trim = 标题?.trim();
  if (!标题trim) return { 成功: false, 消息: `${名称}标题或ID不能为空` };
  const row = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
  if (!row) return { 成功: false, 消息: `${名称}「${标题trim}」不存在` };
  return { 成功: true, row };
}
function 是否后代任务(候选祖先ID, 候选后代ID) {
  const children = 获取规划图Db().prepare(
    "SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(候选祖先ID);
  return children.some((child) => child.id === 候选后代ID || 是否后代任务(child.id, 候选后代ID));
}
function 检测里程碑(父任务ID) {
  if (父任务ID === null) return null;
  const parent = 获取规划图Db().prepare("SELECT 父任务ID FROM 规划图 WHERE id = ? AND 是否删除 = 0").get(父任务ID);
  if (parent?.父任务ID === null) {
    return 任务Tag.MILESTONE;
  }
  return null;
}
function 是否根任务(任务ID) {
  const task = 获取规划图Db().prepare("SELECT 父任务ID FROM 规划图 WHERE id = ? AND 是否删除 = 0").get(任务ID);
  return task?.父任务ID === null;
}
function 解析任务行(raw) {
  if ("Tag" in raw && Array.isArray(raw.Tag) && "动态" in raw && Array.isArray(raw.动态)) {
    return raw;
  }
  const task = raw;
  let tags = [];
  if (typeof task.Tag === "string") {
    try {
      tags = JSON.parse(task.Tag);
    } catch {
      tags = [];
    }
  } else if (Array.isArray(task.Tag)) {
    tags = task.Tag;
  }
  let 动态 = [];
  if (typeof task.动态 === "string") {
    try {
      动态 = JSON.parse(task.动态);
    } catch {
      动态 = [];
    }
  } else if (Array.isArray(task.动态)) {
    动态 = task.动态;
  }
  return {
    ...task,
    Tag: tags,
    是否完成: Boolean(task.是否完成),
    已删除: Boolean(task["是否删除"] ?? task.已删除),
    动态
  };
}
function 查询依赖任务标题(依赖任务ID) {
  const task = 获取规划图Db().prepare(
    "SELECT 标题 FROM 规划图 WHERE id = ?"
  ).get(依赖任务ID);
  return task?.标题 ?? null;
}
function 依赖展示标题(dep) {
  if (typeof dep.依赖任务ID === "number") return 查询依赖任务标题(dep.依赖任务ID) ?? `ID:${dep.依赖任务ID}`;
  return dep.依赖任务?.trim() || "（未知依赖）";
}
function 解析依赖任务ID(dep) {
  if (typeof dep.依赖任务ID === "number" && Number.isInteger(dep.依赖任务ID) && dep.依赖任务ID > 0) {
    const depTask2 = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE id = ? AND 是否删除 = 0").get(dep.依赖任务ID);
    if (!depTask2) return { 成功: false, 消息: `依赖任务ID「${dep.依赖任务ID}」不存在` };
    return { 成功: true, 依赖任务ID: depTask2.id };
  }
  if (!("依赖任务" in dep) || typeof dep.依赖任务 !== "string") return { 成功: false, 消息: "依赖任务ID不能为空" };
  const depTitle = dep.依赖任务.trim();
  if (!depTitle) return { 成功: false, 消息: "依赖任务ID不能为空" };
  const depTask = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(depTitle);
  if (!depTask) return { 成功: false, 消息: `依赖任务「${depTitle}」不存在` };
  return { 成功: true, 依赖任务ID: depTask.id };
}
function 规范化依赖列表(依赖) {
  const normalized = [];
  for (const dep of 依赖) {
    const resolved = 解析依赖任务ID(dep);
    if (!resolved.成功) return resolved;
    normalized.push({ 依赖任务ID: resolved.依赖任务ID, 原因: dep.原因 });
  }
  return { 成功: true, 依赖: normalized };
}
function 迁移依赖为ID存储() {
  const rows = 获取规划图Db().prepare(
    "SELECT id, 依赖 FROM 规划图 WHERE 依赖 IS NOT NULL AND TRIM(依赖) != ''"
  ).all();
  for (const row of rows) {
    let deps;
    try {
      const parsed = JSON.parse(row.依赖);
      if (!Array.isArray(parsed)) continue;
      deps = parsed;
    } catch {
      continue;
    }
    let changed = false;
    const migrated = deps.map((dep) => {
      if (typeof dep.依赖任务ID === "number" && Number.isInteger(dep.依赖任务ID) && dep.依赖任务ID > 0) {
        changed = changed || dep.依赖任务 !== void 0;
        return { 依赖任务ID: dep.依赖任务ID, 原因: dep.原因 };
      }
      if (typeof dep.依赖任务 === "string" && dep.依赖任务.trim()) {
        const task = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ?").get(dep.依赖任务.trim());
        if (task) {
          changed = true;
          return { 依赖任务ID: task.id, 原因: dep.原因 };
        }
      }
      return dep;
    });
    if (changed) {
      获取规划图Db().prepare("UPDATE 规划图 SET 依赖 = ? WHERE id = ?").run(JSON.stringify(migrated), row.id);
    }
  }
}
const 规划图 = {
  添加任务(添加到哪个父任务之下, 任务描述, 标题, 优先级序号, 任务类型Tag, 依赖 = [], 其它Tag = []) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    if (!任务描述 || !任务描述.trim()) return { 成功: false, 消息: "任务描述不能为空" };
    let 父任务ID = null;
    if (添加到哪个父任务之下 !== null) {
      const parent = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(添加到哪个父任务之下);
      if (!parent) return { 成功: false, 消息: `父任务「${添加到哪个父任务之下}」不存在` };
      父任务ID = parent.id;
    }
    const existing = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (existing) return { 成功: false, 消息: `标题「${标题trim}」在当前项目「${当前项目名}」已存在` };
    const 任务类型Tag校验 = 校验所有Tag([任务类型Tag]);
    if (任务类型Tag校验) return { 成功: false, 消息: 任务类型Tag校验 };
    if (其它Tag.length > 0) {
      const 其它Tag校验 = 校验所有Tag(其它Tag);
      if (其它Tag校验) return { 成功: false, 消息: 其它Tag校验 };
    }
    const softDeleted = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 1").get(标题trim);
    if (softDeleted) {
      获取规划图Db().prepare("DELETE FROM 规划图 WHERE 标题 = ? AND 是否删除 = 1").run(标题trim);
    }
    const 依赖规范化结果 = 规范化依赖列表(依赖);
    if (!依赖规范化结果.成功) return 依赖规范化结果;
    const 实际优先级序号 = 计算实际优先级序号(父任务ID, 优先级序号);
    const 依赖校验结果 = 校验同级依赖规则(标题trim, 父任务ID, 实际优先级序号, 依赖规范化结果.依赖);
    if (依赖校验结果) return 依赖校验结果;
    const mileStone = 检测里程碑(父任务ID);
    const 所有Tag = [...new Set([其它Tag, 任务类型Tag, mileStone].flat().filter((t) => t !== null))];
    if (所有Tag.length === 0) return { 成功: false, 消息: "至少需要一个Tag" };
    插入任务并更新同级优先级(父任务ID, 优先级序号);
    const 创建时间UTC = (/* @__PURE__ */ new Date()).toISOString();
    const insertResult = 获取规划图Db().prepare(
      "INSERT INTO 规划图 (标题, 父任务ID, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除, 动态) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, ?)"
    ).run(标题trim, 父任务ID, JSON.stringify(所有Tag), 任务描述.trim(), 创建时间UTC, 实际优先级序号, JSON.stringify(依赖规范化结果.依赖), JSON.stringify([]));
    const newTaskId = insertResult.lastInsertRowid;
    const isRoot = 父任务ID === null;
    const 父任务标题信息 = isRoot ? "" : `（父任务：${添加到哪个父任务之下}）`;
    const 依赖提醒 = 依赖规范化结果.依赖.length === 0 ? "（当前依赖数量为0，请掂量是否有未考虑周到的隐性依赖，依赖链是极为重要的，不要忽视隐性依赖）" : "";
    return {
      成功: true,
      消息: `已添加${isRoot ? "根任务" : "子任务"}「${标题trim}」${父任务标题信息}（优先级：${实际优先级序号}，ID：${newTaskId}）${依赖提醒}`
    };
  },
  删除任务(标题) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    const 子任务总数 = 统计子任务数(existing.id);
    if (子任务总数 > 0) {
      return { 成功: false, 消息: `该操作将把全部子任务级联标记为删除，请确认：`, 需要确认: true, 子任务数: 子任务总数 };
    }
    级联更新字段(existing.id, "是否删除", 1);
    return { 成功: true, 消息: `已删除任务「${标题trim}」` };
  },
  确认删除(标题) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    级联更新字段(existing.id, "是否删除", 1);
    return { 成功: true, 消息: `已删除任务「${标题trim}」及其所有子任务` };
  },
  查询已删除任务(数量, 从, 到, 描述字数阈值, 动态字数阈值) {
    const taskDb = 获取规划图Db();
    if (数量 <= 0) {
      return `错误Found: 数量必须大于0，当前值: ${数量}`;
    }
    const { sql: 时间过滤, params: 时间参数, 校验失败消息 } = 构建时间过滤条件(从, 到);
    if (校验失败消息) {
      return `错误Found: ${校验失败消息}`;
    }
    const deletedTasks = taskDb.prepare(
      `SELECT * FROM 规划图 WHERE 是否删除 = 1${时间过滤} ORDER BY 创建时间UTC DESC LIMIT ?`
    ).all(...时间参数, 数量);
    const parsedTasks = deletedTasks.map(解析任务行);
    const lines = [];
    lines.push(``);
    lines.push(`【已删除任务统计】`);
    lines.push(`- 已删除任务数: ${parsedTasks.length}`);
    lines.push(``);
    lines.push(`【已删除任务列表】（按删除时间倒序）`);
    lines.push(``);
    for (const task of parsedTasks) {
      const tagsStr = task.Tag?.join("、") ?? "";
      const 依赖信息 = task.依赖 ? JSON.parse(task.依赖) : [];
      const 依赖Str = Array.isArray(依赖信息) && 依赖信息.length > 0 ? 依赖信息.map((d) => 依赖展示标题(d)).join("、") : "无";
      const 描述原文 = task.任务描述 ?? "N/A";
      const 描述展示 = 描述原文.length > 描述字数阈值 ? 描述原文.slice(0, 描述字数阈值) + `(..折叠${描述原文.length - 描述字数阈值}字)` : 描述原文;
      lines.push(`${task.标题}`);
      lines.push(`  创建时间: ${task.创建时间UTC ? formatDateTime({ isoString: task.创建时间UTC, showYear: false, showPeriod: true, showTime: true, showSeconds: false }) : "N/A"}`);
      lines.push(`  (${tagsStr})${描述展示}`);
      lines.push(`  依赖: ${依赖Str}`);
      lines.push(`  ${task.是否完成 ? "✅ " : "☕️ "}`);
      if (task.动态 && task.动态.length > 0) {
        const 动态行 = [];
        let 累计消息字数 = 0;
        let 已折叠数 = 0;
        for (let i = 0; i < task.动态.length; i++) {
          const d = task.动态[i];
          const timeStr = formatDateTime({ isoString: d.时间UTC, showYear: false, showPeriod: false, showTime: true, showSeconds: false });
          const 消息字数 = d.消息.length;
          if (累计消息字数 + 消息字数 > 动态字数阈值) {
            const 剩余空间 = 动态字数阈值 - 累计消息字数;
            if (剩余空间 > 0) {
              动态行.push(`  ${i + 1}.「${timeStr} ${d.角色}：${d.消息.slice(0, 剩余空间)}」`);
            }
            已折叠数 = task.动态.length - 动态行.length;
            break;
          }
          累计消息字数 += 消息字数;
          动态行.push(`  ${i + 1}.「${timeStr} ${d.角色}：${d.消息}」`);
        }
        if (已折叠数 > 0) {
          动态行.push(`  (..折叠${已折叠数}个动态)`);
        }
        lines.push(`  动态：`);
        lines.push(...动态行);
      } else {
        lines.push(`  无动态`);
      }
      lines.push(``);
    }
    return lines.join("\n");
  },
  按标题查(标题, 模糊 = false) {
    if (模糊) {
      const rows = 获取规划图Db().prepare(
        "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 标题 LIKE ? ORDER BY 优先级序号 ASC"
      ).all(`%${标题}%`);
      return rows.map(解析任务行);
    }
    const row = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 标题 = ?"
    ).get(标题);
    return row ? [解析任务行(row)] : [];
  },
  按ID查(id) {
    const row = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE id = ? AND 是否删除 = 0"
    ).get(id);
    return row ? 解析任务行(row) : null;
  },
  /**
   * 递归构建任务依赖链。
   *
   * @param 标题 要查询的任务标题
   * @param 最大层数 递归最大深度，默认 3
   * @returns 任务详情 + 分层的依赖链，每层包含【标题、依赖原因、动态】
   */
  查询依赖链(标题, 最大层数 = 3) {
    const taskRow = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0"
    ).get(标题);
    if (!taskRow) return { 成功: false, 消息: `任务"${标题}"不存在` };
    const task = 解析任务行(taskRow);
    const visited = /* @__PURE__ */ new Set([task.id]);
    function 获取依赖任务(依赖JSON) {
      if (!依赖JSON) return [];
      try {
        const deps = JSON.parse(依赖JSON);
        return deps.map((d) => {
          if (typeof d.依赖任务ID === "number") return { 依赖任务ID: d.依赖任务ID, 原因: d.原因 };
          if (!d.依赖任务?.trim()) return null;
          const depTask = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(d.依赖任务.trim());
          return depTask ? { 依赖任务ID: depTask.id, 原因: d.原因 } : null;
        }).filter((d) => d !== null);
      } catch {
        return [];
      }
    }
    function 递归收集依赖(depInfos, depthRemaining) {
      if (depthRemaining <= 0 || depInfos.length === 0) return [];
      const currentLayer = [];
      const nextDepInfos = [];
      for (const dep of depInfos) {
        if (visited.has(dep.依赖任务ID)) continue;
        visited.add(dep.依赖任务ID);
        const depRow = 获取规划图Db().prepare(
          "SELECT * FROM 规划图 WHERE id = ? AND 是否删除 = 0"
        ).get(dep.依赖任务ID);
        if (!depRow) continue;
        const depTask = 解析任务行(depRow);
        currentLayer.push({ 标题: depTask.标题, 原因: dep.原因, 动态: depTask.动态 });
        const subDeps = 获取依赖任务(depTask.依赖);
        nextDepInfos.push(...subDeps);
      }
      if (currentLayer.length === 0) return [];
      const nextLayers = 递归收集依赖(nextDepInfos, depthRemaining - 1);
      return [{ 层: 最大层数 - depthRemaining + 1, 依赖: currentLayer }, ...nextLayers];
    }
    const topDeps = 获取依赖任务(task.依赖);
    const 依赖链 = 递归收集依赖(topDeps, 最大层数);
    return {
      成功: true,
      任务: { 标题: task.标题, Tag: task.Tag, 任务描述: task.任务描述 },
      依赖链
    };
  },
  按Tag查询(Tag) {
    const rows = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 是否删除 = 0"
    ).all();
    return rows.map(解析任务行).filter((task) => task.Tag?.includes(Tag));
  },
  改描述(标题, 新描述) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    if (!新描述 || !新描述.trim()) return { 成功: false, 消息: "新描述不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    获取规划图Db().prepare("UPDATE 规划图 SET 任务描述 = ? WHERE id = ?").run(新描述.trim(), existing.id);
    return { 成功: true, 消息: `已更新任务「${标题trim}」的描述` };
  },
  改标题(旧标题, 新标题) {
    const 旧标题trim = 旧标题.trim();
    const 新标题trim = 新标题.trim();
    if (!旧标题trim) return { 成功: false, 消息: "旧标题不能为空" };
    if (!新标题trim) return { 成功: false, 消息: "新标题不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(旧标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${旧标题trim}」不存在` };
    const duplicate = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ?").get(新标题trim);
    if (duplicate) return { 成功: false, 消息: `新标题「${新标题trim}」在当前项目「${当前项目名}」已存在` };
    获取规划图Db().prepare("UPDATE 规划图 SET 标题 = ? WHERE id = ?").run(新标题trim, existing.id);
    return { 成功: true, 消息: `已将任务「${旧标题trim}」更名为「${新标题trim}」（ID：${existing.id}不变，父子关系和依赖关系不受影响）` };
  },
  改依赖(标题, 新依赖) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    const existingTask = 解析任务行(existing);
    const 依赖规范化结果 = 规范化依赖列表(新依赖);
    if (!依赖规范化结果.成功) return 依赖规范化结果;
    const 依赖校验结果 = 校验同级依赖规则(标题trim, existingTask.父任务ID ?? null, existingTask.优先级序号 ?? 0, 依赖规范化结果.依赖);
    if (依赖校验结果) return 依赖校验结果;
    获取规划图Db().prepare("UPDATE 规划图 SET 依赖 = ? WHERE id = ?").run(JSON.stringify(依赖规范化结果.依赖), existing.id);
    const 依赖提醒 = 依赖规范化结果.依赖.length === 0 ? "（当前依赖数量为0，请掂量是否有未考虑周到的隐性依赖，依赖链是极为重要的，不要忽视隐性依赖）" : "";
    return { 成功: true, 消息: `已更新任务「${标题trim}」的依赖${依赖提醒}` };
  },
  改优先级(标题, 新优先级序号) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    const existingTask = 解析任务行(existing);
    const 原优先级序号 = existingTask.优先级序号 ?? 0;
    const 父任务ID = existingTask.父任务ID ?? null;
    const 实际优先级序号 = 计算移动目标优先级(父任务ID, 新优先级序号);
    const 同级任务 = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS ?"
    ).all(父任务ID);
    for (const other of 同级任务) {
      const otherTask = 解析任务行(other);
      if (otherTask.id === existing.id || !otherTask.依赖) continue;
      try {
        const otherDeps = JSON.parse(otherTask.依赖);
        const depOnThis = otherDeps.find((d) => d.依赖任务ID === existing.id);
        if (depOnThis) {
          const otherPri = otherTask.优先级序号 ?? 0;
          if (原优先级序号 < 实际优先级序号 && otherPri > 原优先级序号 && otherPri <= 实际优先级序号) {
            return { 成功: false, 消息: `该任务被同级任务《${otherTask.标题}》依赖，将其优先级从 ${原优先级序号} 改为 ${实际优先级序号} 会导致依赖顺序颠倒，请重新考虑优先级或依赖关系` };
          }
          if (原优先级序号 < 实际优先级序号 && otherPri < 原优先级序号) {
            return { 成功: false, 消息: `该任务被同级任务《${otherTask.标题}》依赖，将其优先级从 ${原优先级序号} 改为 ${实际优先级序号} 会导致依赖顺序颠倒，请重新考虑优先级或依赖关系` };
          }
        }
      } catch {
      }
    }
    if (existingTask.依赖) {
      try {
        const selfDeps = JSON.parse(existingTask.依赖);
        const 自身依赖校验 = 校验同级依赖规则(标题trim, 父任务ID, 实际优先级序号, selfDeps);
        if (自身依赖校验) return 自身依赖校验;
      } catch {
      }
    }
    const taskDb = 获取规划图Db();
    taskDb.exec("BEGIN TRANSACTION");
    try {
      if (原优先级序号 < 实际优先级序号) {
        taskDb.prepare("UPDATE 规划图 SET 优先级序号 = 优先级序号 - 1 WHERE 是否删除 = 0 AND 父任务ID IS ? AND 优先级序号 > ? AND 优先级序号 <= ? AND id != ?").run(父任务ID, 原优先级序号, 实际优先级序号, existing.id);
      } else if (原优先级序号 > 实际优先级序号) {
        taskDb.prepare("UPDATE 规划图 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID IS ? AND 优先级序号 >= ? AND 优先级序号 < ? AND id != ?").run(父任务ID, 实际优先级序号, 原优先级序号, existing.id);
      }
      taskDb.prepare("UPDATE 规划图 SET 优先级序号 = ? WHERE id = ?").run(实际优先级序号, existing.id);
      taskDb.exec("COMMIT");
    } catch (e) {
      taskDb.exec("ROLLBACK");
      return { 成功: false, 消息: `更新优先级失败: ${e instanceof Error ? e.message : String(e)}` };
    }
    const 更新后同级 = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS ? ORDER BY 优先级序号 ASC"
    ).all(父任务ID);
    const 当前任务索引 = 更新后同级.findIndex((t) => t.id === existing.id);
    const 前两个任务 = 更新后同级.slice(Math.max(0, 当前任务索引 - 2), 当前任务索引).map((t) => 解析任务行(t));
    const 后两个任务 = 更新后同级.slice(当前任务索引 + 1, 当前任务索引 + 3).map((t) => 解析任务行(t));
    const 前两个描述 = 前两个任务.length > 0 ? 前两个任务.map((t) => `《${t.标题}》(优先级${t.优先级序号})`).join("、") : "无";
    const 后两个描述 = 后两个任务.length > 0 ? 后两个任务.map((t) => `《${t.标题}》(优先级${t.优先级序号})`).join("、") : "无";
    return { 成功: true, 消息: `已将任务「${标题trim}」的优先级从 ${原优先级序号} 改为 ${实际优先级序号}。当前位置：前两个任务[${前两个描述}] <- 本任务 -> 后两个任务[${后两个描述}]` };
  },
  改父任务(子任务标题, 新父任务标题, 子任务ID, 新父任务ID) {
    const 子任务查找 = 查找未删除任务By标题或ID(子任务标题, 子任务ID, "子任务");
    if (!子任务查找.成功) return 子任务查找;
    const 新父任务查找 = 查找未删除任务By标题或ID(新父任务标题, 新父任务ID, "新父任务");
    if (!新父任务查找.成功) return 新父任务查找;
    const 子任务 = 解析任务行(子任务查找.row);
    const 新父任务 = 解析任务行(新父任务查找.row);
    if (子任务.id === 新父任务.id) return { 成功: false, 消息: "不能将任务设置为自己的父任务" };
    if (子任务.父任务ID === null) return { 成功: false, 消息: `任务「${子任务.标题}」是根任务，不是子任务` };
    if (子任务.父任务ID === 新父任务.id) return { 成功: true, 消息: `任务「${子任务.标题}」已在父任务「${新父任务.标题}」之下，无需变更` };
    if (是否后代任务(子任务.id, 新父任务.id)) return { 成功: false, 消息: "不能将任务移动到自己的后代任务之下" };
    const 新父任务同级 = 获取规划图Db().prepare(
      "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
    ).all(新父任务.id);
    const 依赖该任务的同级 = 新父任务同级.map(解析任务行).find((task) => {
      if (!task.依赖) return false;
      try {
        return JSON.parse(task.依赖).some((dep) => dep.依赖任务ID === 子任务.id);
      } catch {
        return false;
      }
    });
    if (依赖该任务的同级) return { 成功: false, 消息: `新父任务下已有同级任务《${依赖该任务的同级.标题}》依赖该任务；移动到末尾会导致同级依赖顺序颠倒，请先调整依赖或优先级` };
    const 新优先级序号 = 计算实际优先级序号(新父任务.id, 99999);
    if (子任务.依赖) {
      try {
        const 依赖校验结果 = 校验同级依赖规则(子任务.标题, 新父任务.id, 新优先级序号, JSON.parse(子任务.依赖));
        if (依赖校验结果) return 依赖校验结果;
      } catch {
      }
    }
    const 原父任务ID = 子任务.父任务ID ?? null;
    const 所有Tag = 检测里程碑(新父任务.id) === 任务Tag.MILESTONE ? [.../* @__PURE__ */ new Set([...子任务.Tag ?? [], 任务Tag.MILESTONE])] : 子任务.Tag ?? [];
    const taskDb = 获取规划图Db();
    taskDb.exec("BEGIN TRANSACTION");
    try {
      taskDb.prepare("UPDATE 规划图 SET 父任务ID = ?, 优先级序号 = ?, Tag = ? WHERE id = ?").run(新父任务.id, 新优先级序号, JSON.stringify(所有Tag), 子任务.id);
      压紧同级优先级(原父任务ID);
      压紧同级优先级(新父任务.id);
      taskDb.exec("COMMIT");
    } catch (e) {
      taskDb.exec("ROLLBACK");
      return { 成功: false, 消息: `更新父任务失败: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { 成功: true, 消息: `已将子任务「${子任务.标题}」移动到父任务「${新父任务.标题}」之下` };
  },
  标记为已完成(标题) {
    return _完成任务(标题);
  },
  确认完成(标题) {
    return _完成任务(标题);
  },
  添加动态(标题, 角色, 消息) {
    const 标题trim = 标题.trim();
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
    if (!角色 || !角色.trim()) return { 成功: false, 消息: "角色不能为空" };
    if (!消息 || !消息.trim()) return { 成功: false, 消息: "消息不能为空" };
    const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
    const 现有动态 = existing.动态 ? JSON.parse(existing.动态) : [];
    const 新动态 = { 时间UTC: (/* @__PURE__ */ new Date()).toISOString(), 角色: 角色.trim(), 消息: 消息.trim() };
    现有动态.push(新动态);
    获取规划图Db().prepare("UPDATE 规划图 SET 动态 = ? WHERE id = ?").run(JSON.stringify(现有动态), existing.id);
    return { 成功: true, 消息: `已为任务「${标题trim}」添加动态` };
  }
};
function _完成任务(标题) {
  const 标题trim = 标题.trim();
  if (!标题trim) return { 成功: false, 消息: "标题不能为空" };
  const existing = 获取规划图Db().prepare("SELECT * FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim);
  if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` };
  const 子任务总数 = 统计子任务数(existing.id);
  if (子任务总数 > 0) {
    if (!检查所有子任务是否已完成(existing.id)) {
      return { 成功: false, 消息: `不允许直接将父任务标记为完成，请先确保所有子任务完成` };
    }
    获取规划图Db().prepare("UPDATE 规划图 SET 是否完成 = 1 WHERE id = ?").run(existing.id);
    return { 成功: true, 消息: `已将任务「${标题trim}」标记为已完成` };
  }
  获取规划图Db().prepare("UPDATE 规划图 SET 是否完成 = 1 WHERE id = ?").run(existing.id);
  尝试向上自动完成(existing.id);
  return { 成功: true, 消息: `已将任务「${标题trim}」标记为已完成` };
}
function 构建时间过滤条件(从, 到) {
  const sqlParts = [];
  const params = [];
  if (从 !== void 0) {
    const date = new Date(从);
    if (isNaN(date.getTime())) {
      return { sql: "", params: [], 校验失败消息: `--从 参数无效的ISO时间格式: ${从}` };
    }
    sqlParts.push("创建时间UTC >= ?");
    params.push(date.toISOString());
  }
  if (到 !== void 0) {
    const date = new Date(到);
    if (isNaN(date.getTime())) {
      return { sql: "", params: [], 校验失败消息: `--到 参数无效的ISO时间格式: ${到}` };
    }
    sqlParts.push("创建时间UTC <= ?");
    params.push(date.toISOString());
  }
  return {
    sql: sqlParts.length > 0 ? ` AND ${sqlParts.join(" AND ")}` : "",
    params,
    校验失败消息: null
  };
}
function 查询规划图_返回视图(一次性聚焦数量上限, 从, 到, 描述字数展示阈值, 任务动态字数展示阈值) {
  const taskDb = 获取规划图Db();
  if (一次性聚焦数量上限 <= 0) {
    return `错误Found: 一次性聚焦数量上限必须大于0，当前值: ${一次性聚焦数量上限}`;
  }
  const { sql: 时间过滤, params: 时间参数, 校验失败消息 } = 构建时间过滤条件(从, 到);
  if (校验失败消息) {
    return `错误Found: ${校验失败消息}`;
  }
  const 末端任务数 = 当前表中总任务数_仅末端();
  const 总任务数 = 当前表中全部任务数();
  const n = 一次性聚焦数量上限;
  function 计算任务树层数() {
    function 获取子任务层级(父任务ID, currentDepth) {
      const children = taskDb.prepare(
        "SELECT id FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ?"
      ).all(父任务ID);
      if (children.length === 0) return currentDepth;
      let maxDepth2 = currentDepth;
      for (const child of children) {
        const childDepth = 获取子任务层级(child.id, currentDepth + 1);
        if (childDepth > maxDepth2) maxDepth2 = childDepth;
      }
      return maxDepth2;
    }
    const roots = 加载根任务();
    if (roots.length === 0) return 0;
    let maxDepth = 0;
    for (const root of roots) {
      const depth = 获取子任务层级(root.id, 1);
      if (depth > maxDepth) maxDepth = depth;
    }
    return maxDepth;
  }
  const 任务树最深处层数 = 计算任务树层数();
  const 根任务列表 = 时间过滤 ? taskDb.prepare(
    `SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NULL${时间过滤} ORDER BY 优先级序号 ASC`
  ).all(...时间参数) : 加载根任务();
  const recentTasks = taskDb.prepare(
    `SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID IS NOT NULL${时间过滤} ORDER BY 创建时间UTC DESC LIMIT ?`
  ).all(...时间参数, n);
  function 追溯父任务链(任务ID, visited) {
    if (任务ID === null) return [];
    if (visited.has(任务ID)) return [];
    const parent = taskDb.prepare(
      "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND id = ?"
    ).get(任务ID);
    if (!parent) return [];
    if (parent.父任务ID === null) return [解析任务行(parent)];
    visited.add(任务ID);
    const ancestors = 追溯父任务链(parent.父任务ID ?? null, visited);
    return [解析任务行(parent), ...ancestors];
  }
  const allTasksMap = /* @__PURE__ */ new Map();
  for (const root of 根任务列表) {
    if (root.id) allTasksMap.set(root.id, 解析任务行(root));
  }
  for (const recent of recentTasks) {
    if (recent.id) {
      allTasksMap.set(recent.id, 解析任务行(recent));
      const ancestors = 追溯父任务链(recent.父任务ID ?? null, /* @__PURE__ */ new Set());
      for (const ancestor of ancestors) {
        if (ancestor.id) allTasksMap.set(ancestor.id, 解析任务行(ancestor));
      }
    }
  }
  const allTasks = Array.from(allTasksMap.values());
  const 构建序号路径 = (任务2) => {
    const chain = [];
    let current = 任务2;
    const visited = /* @__PURE__ */ new Set();
    while (current) {
      if (current.id && visited.has(current.id)) break;
      if (current.id) visited.add(current.id);
      chain.unshift(current.优先级序号 ?? 0);
      if (current.父任务ID === null || current.父任务ID === void 0) break;
      current = allTasksMap.get(current.父任务ID) ?? (() => {
        const parent = taskDb.prepare(
          "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND id = ?"
        ).get(current.父任务ID);
        return parent ? 解析任务行(parent) : void 0;
      })();
    }
    return chain.join(".");
  };
  const 优先级序列 = (路径) => {
    return 路径.split(".").map((num) => parseInt(num, 10));
  };
  const 获取任务深度 = (任务2) => {
    let depth = 0;
    let current = 任务2;
    const visited = /* @__PURE__ */ new Set();
    while (current) {
      if (current.id && visited.has(current.id)) break;
      if (current.id) visited.add(current.id);
      depth++;
      if (current.父任务ID === null || current.父任务ID === void 0) break;
      current = allTasksMap.get(current.父任务ID) ?? (() => {
        const parent = taskDb.prepare(
          "SELECT * FROM 规划图 WHERE 是否删除 = 0 AND id = ?"
        ).get(current.父任务ID);
        return parent ? 解析任务行(parent) : void 0;
      })();
    }
    return depth;
  };
  const 获取Dash前缀 = (深度) => {
    const base = "——";
    if (深度 <= 1) return base;
    return base + "—".repeat((深度 - 1) * 2);
  };
  const sortedTasks = allTasks.sort((a, b) => {
    const pathA = 构建序号路径(a);
    const pathB = 构建序号路径(b);
    const seqA = 优先级序列(pathA);
    const seqB = 优先级序列(pathB);
    for (let i = 0; i < Math.max(seqA.length, seqB.length); i++) {
      const numA = seqA[i] ?? 0;
      const numB = seqB[i] ?? 0;
      if (numA !== numB) return numA - numB;
    }
    return seqA.length - seqB.length;
  });
  const lines = [];
  lines.push(``);
  lines.push(`【规划图统计】`);
  lines.push(`- 末端任务数（小颗粒度任务）: ${末端任务数}`);
  lines.push(`- 总任务数（含所有父任务）: ${总任务数}`);
  lines.push(`- 任务树最深处层数: ${任务树最深处层数}`);
  lines.push(``);
  lines.push(`【规划图视图】（优先级序号从0到n排序，靠前=优先；✅ =已完成，☕️ =未完成）`);
  lines.push(`- 当前展示数量: ${sortedTasks.length}`);
  lines.push(``);
  for (const task of sortedTasks) {
    const depth = 获取任务深度(task);
    const prefix = 获取Dash前缀(depth);
    const 序号Str = 构建序号路径(task);
    const tagsStr = task.Tag?.join("、") ?? "";
    const 依赖信息 = task.依赖 ? JSON.parse(task.依赖) : [];
    const 依赖Str = Array.isArray(依赖信息) && 依赖信息.length > 0 ? 依赖信息.map((d) => 依赖展示标题(d)).join("、") : "无";
    const 描述原文 = task.任务描述 ?? "N/A";
    const 描述展示 = 描述原文.length > 描述字数展示阈值 ? 描述原文.slice(0, 描述字数展示阈值) + `(..折叠${描述原文.length - 描述字数展示阈值}字)` : 描述原文;
    lines.push(`${序号Str}《${task.标题}》`);
    lines.push(`${prefix} 创建时间: ${task.创建时间UTC ? formatDateTime({ isoString: task.创建时间UTC, showYear: false, showPeriod: true, showTime: true, showSeconds: false }) : "N/A"}`);
    lines.push(`${prefix} (${tagsStr})${描述展示}`);
    lines.push(`${prefix} 依赖: ${依赖Str}`);
    lines.push(`${prefix} ${task.是否完成 ? "✅ " : "☕️ "}`);
    if (task.动态 && task.动态.length > 0) {
      const 动态行 = [];
      let 累计消息字数 = 0;
      let 已折叠数 = 0;
      const 动态前缀 = `${prefix}  `;
      for (let i = 0; i < task.动态.length; i++) {
        const d = task.动态[i];
        const timeStr = formatDateTime({ isoString: d.时间UTC, showYear: false, showPeriod: false, showTime: true, showSeconds: false });
        const 消息字数 = d.消息.length;
        if (累计消息字数 + 消息字数 > 任务动态字数展示阈值) {
          const 剩余空间 = 任务动态字数展示阈值 - 累计消息字数;
          if (剩余空间 > 0) {
            动态行.push(`${动态前缀}${i + 1}.「${timeStr} ${d.角色}：${d.消息.slice(0, 剩余空间)}」`);
          }
          已折叠数 = task.动态.length - 动态行.length;
          break;
        }
        累计消息字数 += 消息字数;
        动态行.push(`${动态前缀}${i + 1}.「${timeStr} ${d.角色}：${d.消息}」`);
      }
      if (已折叠数 > 0) {
        动态行.push(`${动态前缀}(..折叠${已折叠数}个动态)`);
      }
      lines.push(`${prefix} 动态：`);
      lines.push(...动态行);
    } else {
      lines.push(`${prefix} 无动态`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
const CLI_COMMANDS = {
  help: "显示帮助信息",
  init: "初始化数据库 --项目 <项目名> --WRITE_KEY <Key>",
  add: "添加任务 --标题 <标题> --描述 <描述> [--父任务 <父任务>] [--优先级 <序号>] [--Tag <Tag>] [--依赖 <JSON>] [--其它Tag <JSON>] --WRITE_KEY <Key>",
  delete: "删除任务 --标题 <标题> --WRITE_KEY <Key>",
  "query-deleted": "查询已删除任务 --数量 <n> --描述字数阈值 <字数> --动态字数阈值 <字数> [--从 <ISO>] [--到 <ISO>]",
  query: "查询规划图视图 --数量 <n> --描述字数阈值 <字数> --动态字数阈值 <字数> [--从 <ISO>] [--到 <ISO>]",
  "query-by-title": "按标题查询 --标题 <标题> [--模糊 <true|false>]",
  "query-by-id": "按ID查询 --id <ID>",
  "query-by-tag": "按Tag查询 --Tag <Tag>",
  "update-description": "改描述 --标题 <标题> --新描述 <描述> --WRITE_KEY <Key>",
  "update-title": "改标题 --标题 <旧标题> --新标题 <新标题> --WRITE_KEY <Key>",
  "update-dependency": "改依赖 --标题 <标题> --新依赖 <JSON> --WRITE_KEY <Key>",
  "update-priority": "改优先级 --标题 <标题> --新优先级 <序号> --WRITE_KEY <Key>",
  "update-parent": "改父任务 (--标题 <子任务标题>|--id <子任务ID>) (--新父任务 <标题>|--新父任务ID <ID>) --WRITE_KEY <Key>",
  "mark-complete": "标记为已完成 --标题 <标题> --WRITE_KEY <Key>",
  "add-activity": "添加动态 --标题 <标题> --角色 <角色> --消息 <消息>",
  "query-dependency-chain": "查询依赖链 --标题 <标题> [--最大层数 <n>]"
};
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] ?? "";
      result[key] = value;
      i++;
    }
  }
  return result;
}
function outputResult(data) {
  console.log(JSON.stringify(data, null, 2));
}
function 计算写入Key哈希(key) {
  return [...Buffer.from(key, "utf8")].reduce(
    (hash, byte) => (hash ^ BigInt(byte)) * 0x100000001b3n & 0xffffffffffffffffn,
    0xcbf29ce484222325n
  );
}
function 校验写入Key(key) {
  return key !== void 0 && 计算写入Key哈希(key) === WRITE_KEY_HASH;
}
async function 确认强制里程碑Tag(任务标题) {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`正在将一个任务设置在根任务之后，此类任务将被强制打上里程碑Tag，请三思。确保你所设置的任务《${任务标题}》的确属于项目里程碑，否则系统建议将之设置在更次等的层级。选择y确认，n反悔。y/n`, resolve);
  });
  rl.close();
  return answer.toLowerCase() === "y";
}
function printHelp() {
  const lines = ["规划图CLI - 任务管理工具", "", "用法: npx tsx 规划图CLI.ts <命令> [选项]", ""];
  for (const [cmd, desc] of Object.entries(CLI_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(22)} ${desc}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
}
async function runCli() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const flags = parseArgs(args.slice(1));
  if (command === "help") {
    printHelp();
    process.exit(0);
  }
  if (command === "init") {
    if (!flags.项目) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --项目" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    try {
      initDbStrict(flags.项目);
      outputResult({ 成功: true, 消息: `规划图数据库已初始化 (项目: ${flags.项目})，可以使用规划图啦！`, 路径: 规划图dbPath });
      process.exit(0);
    } catch (e) {
      outputResult({ 成功: false, 消息: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    }
  }
  if (!process.env.SCHEDULEMAP_PROJECT_NAME) {
    outputResult({ 成功: false, 消息: "未指定项目，请设置环境变量 SCHEDULEMAP_PROJECT_NAME 或在 init 命令中指定 --项目" });
    process.exit(1);
  }
  const 项目名 = process.env.SCHEDULEMAP_PROJECT_NAME;
  const 环境检查 = 检查环境完整性(项目名);
  if (!环境检查.成功) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(`${环境检查.消息}。y新建，n退出: `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== "y") {
      outputResult({ 成功: false, 消息: "已取消操作" });
      process.exit(0);
    }
  }
  initDb(项目名);
  if (command === "add") {
    if (!flags.标题 || !flags.描述 || flags.优先级 === void 0) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --描述, --优先级" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    let 依赖 = [];
    let 其它Tag = [];
    try {
      依赖 = flags.依赖 ? JSON.parse(flags.依赖) : [];
      其它Tag = flags.其它Tag ? JSON.parse(flags.其它Tag) : [];
    } catch (e) {
      outputResult({ 成功: false, 消息: `JSON参数解析失败: ${e instanceof Error ? e.message : String(e)}` });
      process.exit(1);
    }
    try {
      if (flags.父任务) {
        const parent = 获取规划图Db().prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(flags.父任务);
        if (parent && 是否根任务(parent.id) && !await 确认强制里程碑Tag(flags.标题)) {
          outputResult({ 成功: false, 消息: "已取消操作" });
          process.exit(0);
        }
      }
      const result = 规划图.添加任务(
        flags.父任务 ?? null,
        flags.描述,
        flags.标题,
        parseInt(flags.优先级),
        flags.Tag ?? 任务Tag.DETAIL,
        依赖,
        其它Tag
      );
      outputResult(result);
      process.exit(result.成功 ? 0 : 1);
    } catch (e) {
      outputResult({ 成功: false, 消息: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    }
  }
  if (command === "delete") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const result = 规划图.删除任务(flags.标题);
    if (result.需要确认) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`${result.消息} (y/n): `, resolve);
      });
      rl.close();
      if (answer.toLowerCase() === "y") {
        const confirmResult = 规划图.确认删除(flags.标题);
        outputResult(confirmResult);
        process.exit(confirmResult.成功 ? 0 : 1);
      } else {
        outputResult({ 成功: false, 消息: "已取消删除" });
        process.exit(0);
      }
    }
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "query-by-title") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" });
      process.exit(1);
    }
    const 模糊 = flags.模糊 === "true";
    const result = 规划图.按标题查(flags.标题, 模糊);
    outputResult({ 成功: true, 数量: result.length, 任务: result });
    process.exit(0);
  }
  if (command === "query-by-id") {
    if (!flags.id) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --id" });
      process.exit(1);
    }
    const id = parseInt(flags.id);
    if (isNaN(id)) {
      outputResult({ 成功: false, 消息: "id必须是有效的整数" });
      process.exit(1);
    }
    const result = 规划图.按ID查(id);
    if (result) {
      outputResult({ 成功: true, 任务: result });
    } else {
      outputResult({ 成功: false, 消息: `ID为${id}的任务不存在或已删除` });
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "query-by-tag") {
    if (!flags.Tag) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --Tag" });
      process.exit(1);
    }
    const result = 规划图.按Tag查询(flags.Tag);
    outputResult({ 成功: true, 数量: result.length, 任务: result });
    process.exit(0);
  }
  if (command === "query-dependency-chain") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" });
      process.exit(1);
    }
    const 最大层数 = flags.最大层数 ? parseInt(flags.最大层数) : 1;
    if (isNaN(最大层数) || 最大层数 < 1) {
      outputResult({ 成功: false, 消息: "最大层数必须为正整数" });
      process.exit(1);
    }
    const result = 规划图.查询依赖链(flags.标题, 最大层数);
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "query-deleted") {
    if (!flags.数量 || !flags.描述字数阈值 || !flags.动态字数阈值) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --数量, --描述字数阈值, --动态字数阈值" });
      process.exit(1);
    }
    const result = 规划图.查询已删除任务(
      parseInt(flags.数量),
      flags.从 || void 0,
      flags.到 || void 0,
      parseInt(flags.描述字数阈值),
      parseInt(flags.动态字数阈值)
    );
    if (result.startsWith("错误Found")) {
      outputResult({ 成功: false, 消息: result });
      process.exit(1);
    }
    console.log(result);
    process.exit(0);
  }
  if (command === "update-description") {
    if (!flags.标题 || !flags.新描述) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新描述" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const result = 规划图.改描述(flags.标题, flags.新描述);
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "update-title") {
    if (!flags.标题 || !flags.新标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新标题" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const result = 规划图.改标题(flags.标题, flags.新标题);
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "update-dependency") {
    if (!flags.标题 || !flags.新依赖) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新依赖" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    let 新依赖;
    try {
      新依赖 = JSON.parse(flags.新依赖);
    } catch (e) {
      outputResult({ 成功: false, 消息: `JSON参数解析失败: ${e instanceof Error ? e.message : String(e)}` });
      process.exit(1);
    }
    const result = 规划图.改依赖(flags.标题, 新依赖);
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "update-priority") {
    if (!flags.标题 || flags.新优先级 === void 0) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新优先级" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const result = 规划图.改优先级(flags.标题, parseInt(flags.新优先级));
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "update-parent") {
    if (!flags.标题 && !flags.id || !flags.新父任务 && !flags.新父任务ID) {
      outputResult({ 成功: false, 消息: "缺少必需参数: (--标题 或 --id), (--新父任务 或 --新父任务ID)" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const 子任务查找 = 查找未删除任务By标题或ID(flags.标题, flags.id, "子任务");
    const 新父任务查找 = 查找未删除任务By标题或ID(flags.新父任务, flags.新父任务ID, "新父任务");
    if (子任务查找.成功 && 新父任务查找.成功 && 是否根任务(新父任务查找.row.id) && !await 确认强制里程碑Tag(解析任务行(子任务查找.row).标题)) {
      outputResult({ 成功: false, 消息: "已取消操作" });
      process.exit(0);
    }
    const result = 规划图.改父任务(
      flags.标题,
      flags.新父任务,
      flags.id ? parseInt(flags.id) : void 0,
      flags.新父任务ID ? parseInt(flags.新父任务ID) : void 0
    );
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "mark-complete") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" });
      process.exit(1);
    }
    if (!校验写入Key(flags.WRITE_KEY)) {
      outputResult({ 成功: false, 消息: "写入Key错误" });
      process.exit(1);
    }
    const result = 规划图.标记为已完成(flags.标题);
    if (result.需要确认) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`${result.消息} (y/n): `, resolve);
      });
      rl.close();
      if (answer.toLowerCase() === "y") {
        const confirmResult = 规划图.确认完成(flags.标题);
        outputResult(confirmResult);
        process.exit(confirmResult.成功 ? 0 : 1);
      } else {
        outputResult({ 成功: false, 消息: "已取消操作" });
        process.exit(0);
      }
    }
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "add-activity") {
    if (!flags.标题 || !flags.角色 || !flags.消息) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --角色, --消息" });
      process.exit(1);
    }
    const result = 规划图.添加动态(flags.标题, flags.角色, flags.消息);
    outputResult(result);
    process.exit(result.成功 ? 0 : 1);
  }
  if (command === "query") {
    if (!flags.数量 || !flags.描述字数阈值 || !flags.动态字数阈值) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --数量, --描述字数阈值, --动态字数阈值" });
      process.exit(1);
    }
    const result = 查询规划图_返回视图(
      parseInt(flags.数量),
      flags.从 || void 0,
      flags.到 || void 0,
      parseInt(flags.描述字数阈值),
      parseInt(flags.动态字数阈值)
    );
    if (result.startsWith("错误Found")) {
      outputResult({ 成功: false, 消息: result });
      process.exit(1);
    }
    console.log(result);
    process.exit(0);
  }
  outputResult({ 成功: false, 消息: `未知命令: ${command}`, 可用命令: Object.keys(CLI_COMMANDS) });
  process.exit(1);
}
if (process.argv[1] === __filename) {
  runCli().catch((err) => {
    outputResult({ 成功: false, 消息: `执行错误: ${err instanceof Error ? err.message : String(err)}` });
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TIME_PERIODS,
  WRITE_KEY_HASH,
  formatDateTime,
  getDb,
  getTimePeriod,
  initDb,
  initDbStrict,
  任务,
  任务Tag,
  任务依赖,
  加载根任务,
  动态记录,
  当前表中全部任务数,
  当前表中总任务数_仅末端,
  当前项目名,
  查询规划图_返回视图,
  检查环境完整性,
  规划图,
  规划图dbPath,
  解析任务行
});
