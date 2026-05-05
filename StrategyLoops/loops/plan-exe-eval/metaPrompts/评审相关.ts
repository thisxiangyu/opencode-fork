export function 需求评审(): string {
  return ""
}

export function 设计评审(): string {
  return ""
}

export function 检查diff删掉的注释(){
  return "检查diff（工作区和暂存区），看是否有关键的注释被清除了。如果是逻辑变更但是注释又很关键，重新写好注释，契合原则：语义不清、逻辑跳跃必写注释。"
}

export function 语义清晰or注释(){
  return "检查代码语义不清晰之处。要么让语义清晰，要么添加注释。"
}

export function 代码评审(): string {
  return ""
}

export function 预备Commit(): string {
  return `理解当前项目工作区和暂存区变更，然后跳出来从文件整体分析模块内聚性，进行一次整理：
  将足够内聚的代码添加到暂存区；不够内聚、临时探索性、另一主题、另一模块的代码留在工作区。
  拆好后，逐个文件检查是否符合这些原则：
  暂存区代码不应依赖工作区变更、
  暂存区应该正好适合1次提交、
  删除的文件需要分析是不是命名变更或者该文件被另一实现替代（替代和命名变更应该确保步调一致）。
  该项工作全程应慢思考，切勿破坏/变更文件本身内容。`
}

export function 中文Commit(): string {
  return ` 将git暂存区代码做一次深度理解。慢思考，如果工作区存在暂存区的依赖，将工作区中的文件添加到暂存，不依赖则不添加。
  进行一次commit，根据该项目的要求，编写详实、合规的提交信息。
  提交以标签(模块或文件): 打头。中文内容。
  如:
  explore_in_progress(UI):探索新交互布局...(具体探索)
  feat(input):输入新增特性...(具体特性)
  detail(产品Icon):给产品Icon添加新样式...(具体细节)
  add(埋点):新增埋点模块...(具体实现)

  要写具体一点！
  
  [大文件检查] git 当中不应当包含任何大文件（超过3mb 的图片、音视频、动画、数据库文件、二进制文件、各种资产），请务必检查并ignore
  [资产仓库] 根据项目所使用的资产仓库(通常是SVN、Git LFS等，以项目历史约定为准)
  [仓库职责分离]确保大文件在资产仓库的跟踪中；确保代码、文档等文本文件不处于资产仓库中，只处于代码仓库中（有一些动态性较强的小型资产比如icon、小音频、场景描述文件、预制体等可以被赦免，放进代码仓库，这取决于项目决策，请查看项目文档遵循历史约定）。
  [资产仓库提交] 

  标签应该从以下列表中选择：
  "detail",
  "add",
  "feat",
  "fix",
  "refactor",
  "BIG_CHANGE",
  "chore",
  "adjust",
  "revert",
  "test",
  "explore_in_progress",
  "merge",
  "milestone"`
}

export function 测试用例与测试结果评审(): string {
  return ""
}

export function 里程碑交付评审(): string {
  return ""
}

export function 发布准备评审(): string {
  return ""
}

export function 项目复盘与总结评审(): string {
  return ""
}