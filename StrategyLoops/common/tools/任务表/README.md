#  开始

# 查看帮助
node 任务表CLI.js help

# 项目初始化（首次使用执行，同名项目不能重复创建）
node 任务表CLI.js init --项目 <项目名>

# 设置项目环境变量（指定项目数据库）
# 方式一：设置一次，后续命令无需重复（推荐）
# Linux/macOS:
export TASKTABLE_PROJECT_NAME=<项目名>
# Windows (CMD):
set TASKTABLE_PROJECT_NAME=<项目名>
# Windows (PowerShell):
$env:TASKTABLE_PROJECT_NAME="<项目名>"

# 方式二：内联前缀（单条命令生效）
# Linux/macOS:
TASKTABLE_PROJECT_NAME=<项目名> node 任务表CLI.js <命令> [选项]
# Windows (CMD):
set TASKTABLE_PROJECT_NAME=<项目名> && node 任务表CLI.js <命令> [选项]
# Windows (PowerShell):
$env:TASKTABLE_PROJECT_NAME="<项目名>"; node 任务表CLI.js <命令> [选项]

#  查询

# 最常用（描述截断到25字，动态消息截断到35字）
node 任务表CLI.js query --数量 20 --描述字数阈值 25 --动态字数阈值 35

# 大阈值视图
node 任务表CLI.js query --数量 20 --描述字数阈值 9999 --动态字数阈值 9999

# 只查看最近1条
node 任务表CLI.js query --数量 1 --描述字数阈值 9999 --动态字数阈值 9999

# 指定从到时间
node 任务表CLI.js query --数量 20 --描述字数阈值 100 --动态字数阈值 100 --从 "2026-04-01T00:00:00Z" --到 "2026-05-01T00:00:00Z"

# 按标题精确查询单条
node 任务表CLI.js query-by-title --标题 <标题>

# 按标题模糊查询
node 任务表CLI.js query-by-title --标题 <关键词> --模糊 true

# 按Tag查询
node 任务表CLI.js query-by-tag --Tag <Tag>

# 查询依赖链（递归查询前置任务，默认3层）
node 任务表CLI.js query-dependency-chain --标题 <标题> [--最大层数 <n>]

# 查询已删除任务（--从 --到 都不传表示查全部）
node 任务表CLI.js query-deleted --数量 20 --描述字数阈值 100 --动态字数阈值 100 --从 "2026-04-01T00:00:00Z" --到 "2026-05-01T00:00:00Z"

#  添加

# 优先级序号越小，优先级越高（0为最高），优先级高的任务排在前面

# 添加根任务
node 任务表CLI.js add --标题 <标题> --描述 <描述> --优先级 <序号> --Tag <Tag>

# 添加任务
node 任务表CLI.js add --标题 <标题> --描述 <描述> --优先级 <序号> --父任务 <父任务标题> --Tag <Tag>

# 添加带依赖的任务
node 任务表CLI.js add --标题 <标题> --描述 <描述> --优先级 <序号> --父任务 <父任务标题> --Tag <Tag> --依赖 '[{"依赖任务":"<依赖任务标题>","原因":"<依赖详情描述，应具体>"}]'

# 添加带多个Tag的任务，示例：
node 任务表CLI.js add --标题 "新任务" --描述 "描述" --优先级 0 --父任务 "父任务标题" --Tag "feat" --其它Tag '["explore_in_progress","detail"]'

# 技巧：传入大数字（如99999）可自动插到末尾，无需查询当前最大优先级
node 任务表CLI.js add --标题 <标题> --描述 <描述> --优先级 99999 --父任务 <父任务标题> --Tag <Tag>


#  变更

# 变更任务描述
node 任务表CLI.js update-description --标题 <标题> --新描述 <新描述>

# 变更标题（父子联系会因此级联更新）
node 任务表CLI.js update-title --标题 <旧标题> --新标题 <新标题>

# 变更依赖
node 任务表CLI.js update-dependency --标题 <标题> --新依赖 '[{"依赖任务":"<依赖任务标题>","原因":"<依赖详情>"}]'

# 变更优先级（同级任务会因插入而重排序）
node 任务表CLI.js update-priority --标题 <标题> --新优先级 <序号>


#  动态

# 添加一条动态
node 任务表CLI.js add-activity --标题 <标题> --角色 <角色名> --消息 <消息内容>


#  状态

# 标记为已完成（有子任务时会提示确认并级联标记）
node 任务表CLI.js mark-complete --标题 <标题>

# 删除（陈旧/过时的任务应定期清理）
node 任务表CLI.js delete --标题 <标题>
