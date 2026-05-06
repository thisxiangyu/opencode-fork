  
export function 需求分析与产品定位(): string {
  return ""
}

export function 调研(): string {
  return ""
}

export function 技术栈权衡(): string {
  return ""
}

  /**
   * Prompts: Git和其作用（管理代码、文档、文本、小微Asset如icon和logo）
   */
export const GIT_WITH_ITS_USAGE : string = `git（管理代码、文档、文本、小微Asset如icon和logo）`
  /**
   * Prompts: SVN和其作用（管理中大体积的Asset：高清图片、动画、二进制文件和视频等）
   */
export const SVN_WITH_ITS_USAGE : string = `SVN（管理中大体积的Asset：高清图片、动画、二进制文件和视频等）`


export const 类Opencode技术栈 = {
  /**
   * Note：参考Opencode的技术选型，适合Web和Desktop，但是干不了移动端App（Bun运行时限制）。
   */
  类Opencode的WebApp立项技术选型(): string {
  return `
      运行时: Bun 1.3.13
      语言: TypeScript 5.8.2
      框架: Effect Framework (函数式编程, 4.0.0-beta.48)
      Monorepo 管理: Turbo + Bun workspaces
      服务端框架: Hono 
      验证: Zod + Hono Zod Validator
      数据库: Drizzle ORM + SQLite（客户端应用数据库） + PgSQL（服务器主力数据库）
      UI 框架: SolidJS 1.9.10 （HTML只作为入口点，UI 用 SolidJS 组件写）
      桌面: Electron 41 + electron-vite
      样式: Tailwind CSS 4, OpenUI 组件库
      文档站解决方案: Astro 5 + Starlight
      前端开发时Server: Vite 7
      仓库/版本管理工具：${GIT_WITH_ITS_USAGE}、${SVN_WITH_ITS_USAGE}(v 1.14+)
      `
  }
}

export const 基于ReactNative和Electron技术栈 = {
  /**
   * 跨大部分平台，支持Web、Desktop（Win&MacOS）、IOS、安卓
   * 注意：鸿蒙/RN桌面暂不在本期范围内
   */
  基于ReactNative和Electron的全平台WebApp立项技术选型(需要原生拓展:boolean): string {
    return `
        《基于ReactNative和Electron的全平台WebApp立项技术选型》
        语言: TypeScript 5.8
        框架: React Native 0.78 + Expo SDK 53
        - 移动端 (iOS/Android): React Native 原生渲染
        - Web / Desktop: react-native-web  (先用 react-native-web 统一 UI，先用低成本验证产品逻辑，找到 PMF 后再决定是否投入资源做桌面端 UI 的原生化)
        Desktop: Electron 35 + electron-vite (封装Web为桌面App，支持Win&MacOS)
        移动端: Expo (iOS/Android原生打包)
        Monorepo管理: Turbo + npm/pnpm workspaces
        服务器: Hono 5 (远程API服务)
        验证: Zod + Hono Zod Validator
        数据库: 分远程服务器数据库和本地数据库两方面，
            - 远程: Drizzle ORM + PostgreSQL 17
            - 本地数据库统一抽象: packages/client-database-adapter(定义客户端统一接口)
              1.移动端实现: expo-sqlite（本地 SQLite）
              2.Desktop 实现: 项目刚开发时先全都走远程 API，预留 better-sqlite3 方便未来本地直连（本地主要是SQLite）
              3.Web 端实现: 须完全依赖远程 API（因浏览器环境不支持）
        状态管理: Zustand 5
        样式: Tailwind CSS 4 + NativeWind 4 (需与Expo SDK 53验证兼容性，CI加验证)
        组件库: React Native Paper (全平台统一)
            - 注意: Paper为移动端设计，桌面端缺少hover态/键盘导航/右键菜单，需业务层补充
        导航: Expo Router (全平台统一路由，Web端底层自动使用 React Router，无需额外适配)
        错误监控: Sentry (支持RN + Web + Electron)
        日志: packages/logger (统一封装接口，Electron/Expo各平台实现分离)
        国际化: packages/i18n-core (统一封装，屏蔽RN静态资源加载与Web fetch差异)
        测试: Jest + React Native Testing Library + Playwright (Web/桌面E2E) + Maestro (移动端E2E)
        文档站解决方案: Astro 5 + Starlight
        前端开发Server: Expo CLI (npx expo start --web，统一全平台开发环境)
        ${需要原生拓展 ? `原生模块:
            - iOS: CocoaPods + Swift
            - Android: Gradle + Kotlin` : ''}
        仓库/版本管理工具：${GIT_WITH_ITS_USAGE}、${SVN_WITH_ITS_USAGE}(v 1.14+)
        `
  },

  /**
   * Note：如果缺少依赖，需要先安装相关依赖（如Git、SVN、Node.js、pnpm、Turbo等），确保环境准备就绪后再执行以下操作。
   */
  初始化开发目录结构_Git和SVN仓库创建(项目根目录: string): string {
    return `
    如果缺少依赖，需要先安装相关依赖（如Git、SVN、Node.js、pnpm、Turbo等），确保环境准备就绪，
    在${项目根目录}位置执行以下操作：
    1. 初始化标准 Monorepo 目录结构（pnpm + Turbo）：
      根目录/
      ├── apps/                    # 各平台应用入口
      │   ├── mobile/              # Expo 移动端 (iOS/Android)
      │   ├── desktop/             # Electron 桌面端
      │   └── web/                 # 纯 Web 端
      ├── packages/                # 共享库与工具包
      │   ├── client-database-adapter/  # 客户端统一数据访问接口
      │   ├── logger/              # 统一日志封装
      │   ├── i18n-core/           # 国际化封装
      │   └── ui/                  # 可选的共享 UI 组件
      ├── resources/               # 小微资产（图标、Logo等），由 Git 管理
      ├── assets/                  # 大体积二进制资产，由 SVN 管理
      ├── docs/                    # 项目文档
      ├── tools/                   # 工具脚本
      ├── pnpm-workspace.yaml      # pnpm 工作空间配置
      ├── turbo.json               # Turbo 构建流水线配置
      └── package.json             # 根 workspace package.json (private: true)
    （注：各个空文件夹下要放.gitkeep占位）  

    2. 创建根配置文件：
      - pnpm-workspace.yaml 内容：
        packages:
          - "apps/*"
          - "packages/*"
      - turbo.json 基础配置（仅包含基础任务占位）：
        {
          "$schema": "https://turbo.build/schema.json",
          "tasks": {}
        }

    3. 创建${GIT_WITH_ITS_USAGE}仓库：
      - 在项目根目录执行 git init
      - 创建 .gitignore 文件，包含以下内容：
        node_modules/
        dist/
        build/
        .turbo/
        .expo/
        .electron-builder/
        *.log
        .env
        .DS_Store
        coverage/
        .nyc_output/
        tmp/
        ios/Pods/
        android/.gradle/
        android/app/build/
      - git add -A && git commit -m "chore: initial monorepo scaffold"
      - 验证工作树干净：git status 应显示 clean

    4. 创建${SVN_WITH_ITS_USAGE}仓库：
      - mkdir -p ${项目根目录}/assets
      - svnadmin create ${项目根目录}/.svnrepo
      - svn checkout file://${项目根目录}/.svnrepo ${项目根目录}/assets
      - 在 assets/ 下创建 .svnignore 文件，内容与 .gitignore 类似
      - svn propset svn:ignore -F .svnignore .
      - echo "hello world from SVN assets" > assets/hello.txt
      - svn add hello.txt && svn commit -m "initial: hello world asset"
      - 验证：svn status 应显示 clean
    `
    ;},

  HelloWorld测试(git远程仓库?: string, SVN远程仓库?: string): string {
       /**
       * SVN已在上一步创建并提交了 hello.txt，这里主要验证 多端构建运行 + Git 提交 + 俩仓库的推送流程。
       * 如果没有远程仓库，会推送步骤。
       */
    return `做一次 Hello world 测试（验证多端可运行骨架）：

    1. 依赖检查：
      - 在项目根目录执行 pnpm install，确保所有 workspace 依赖安装完毕

    2. 创建移动端 Hello World（Expo Router）：
      - 在 apps/mobile/ 下创建 app/index.tsx，内容：
        \`\`\`tsx
        import { View, Text } from 'react-native';
        export default function Home() {
          return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Text>Hello World from Mobile!</Text>
            </View>
          );
        }
        \`\`\`
      - 此文件同时被 Web 端复用（Expo Router 自动处理 web 模式）

    3. 创建桌面端 Electron 基础文件（apps/desktop/）：
      - 创建 electron/main.ts（主进程入口）：
        \`\`\`ts
        import { app, BrowserWindow } from 'electron';
        async function createWindow() {
          const win = new BrowserWindow({ width: 1200, height: 800 });
          // 开发阶段加载 Expo Web 开发服务器，生产时加载打包后的静态文件
          await win.loadURL('http://localhost:19006');
        }
        app.whenReady().then(createWindow);
        app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
        \`\`\`
      - 创建 electron/preload.ts（可留空或简单导出）
      - 确保 electron-vite 配置指向这些文件（后续配置，此刻先有入口）

    4. Web 端无需额外文件，Expo 的 web 模式直接工作

    5. 运行（这一步请用户人工协助验证，人工验证通过再往下一步执行）：
      a) 移动端（需有模拟器或 Expo Go）：
          - cd apps/mobile
          - npx expo start           # 启动开发服务器，按 i（iOS）或 a（Android）打开模拟器
          - 用户确认屏幕上显示 "Hello World from Mobile!"
      b) Web 端：
          - cd apps/mobile
          - npx expo start --web     # 自动打开浏览器，确认显示相同内容
      c) 桌面端：
          - 先确保 Web 服务仍在运行（expo start --web 或 expo start 同时带 web 模式）
          - cd apps/desktop
          - 使用 electron-vite 启动开发模式（需安装 electron 和 electron-vite）： 
            npx electron-vite dev
            或直接用 electron . 启动（需先编译 main 到 JS）
          - 用户确认 Electron 窗口加载 localhost:19006 并显示 Hello World

    ${git远程仓库 ? `6. 先检查确保构建产物已被git忽略。然后提交到 Git 并推送远程：
      - git add -A
      - git commit -m "init: hello world 项目初始化"
      - 检查是否关联远程，如果尚未关联，执行：
          git remote add origin ${git远程仓库}
      - git push -u origin main（或 master，视默认分支名）
      - 验证：git log 应看到提交` 
      : 
      '6. 先检查确保构建产物已被git忽略。然后做一次提交 - git commit -m "init: hello world 项目初始化"'}

    ${SVN远程仓库 ? `7. 推送到 SVN 远程：
      - 如果 SVN 远程仓库已存在且为空，先将本地创建的仓库同步上去：
          svnsync init ${SVN远程仓库} file://\${项目根目录}/.svnrepo
          svnsync sync ${SVN远程仓库}
      - 然后让工作副本指向远程：
          cd assets
          svn relocate ${SVN远程仓库}
      - （如果一开始就是以远程检出方式工作，则直接 svn commit 即可 —— 前提是先检查确保构建产物等大文件已被git忽略）
      - 验证：svn info 应显示远程 URL，svn log 显示 hello world asset 等提交` 
      : 
      ''}
      `
  }
  }

  /**
   * {@link 基于ReactNative和Electron技术栈.基于ReactNative和Electron的全平台WebApp立项技术选型} 的简化版本，从Web和Desktop立项
 * 专注 Desktop（Electron）+ Web 的跨端应用
 * 目标：桌面端提供 VS Code 级别的原生交互感（菜单、键盘、拖拽等），Web 端保持完全兼容
 * 注意：本期不含移动原生端，如需随后可通过 PWA 或独立 React Native 分支覆盖
 */
export function 基于React和Electron的DesktopWebApp立项技术选型(需要原生拓展: boolean): string {
  return `
    《基于React和Electron的DesktopWebApp立项技术选型》
    语言: TypeScript 5.8
    框架: React 19
    Desktop: Electron 35 + electron-vite (Win & macOS)
    Web: React 开启 SPA模式，一个 HTML 外壳 + 多个通过 JS 渲染的虚拟页面
    构建工具: Vite 6 (负责 Web 和 Electron 渲染进程的开发与打包)
    Monorepo管理: Turbo + pnpm workspaces
    服务器: Hono 5 (远程API服务)
    验证: Zod + Hono Zod Validator
    数据库:
        - 远程: Drizzle ORM + PostgreSQL 17
        - 本地: packages/client-database-adapter (客户端统一数据访问接口)
            - Desktop 实现: better-sqlite3 (通过 Electron 主进程暴露，完全离线可用)
            - Web 实现: 完全依赖远程 API
    状态管理: Zustand 5
    样式: Tailwind CSS 4 (无需 NativeWind，Web 原生支持)
    组件库: Radix UI + Tailwind (全平台统一)
        - 内置完善的键盘导航、焦点管理、ARIA 支持，天然适合桌面交互
        - 配合 cmdk 等库实现命令面板、右键菜单、快捷键流
        - 使用 @dnd-kit 等库实现高质量拖拽体验
    导航: React Router 7 (客户端路由，文件约定或配置式均可)
    错误监控: Sentry (支持 Web + Electron)
    日志: packages/logger (统一封装，Electron 主/渲染进程 + Web 各自实现)
    国际化: packages/i18n-core (react-i18next，Web/Electron 通用)
    测试:
        - 单元/组件测试: Vitest + React Testing Library
        - E2E: Playwright (覆盖 Web 和 Electron)
    文档站解决方案: Astro 5 + Starlight
    桌面增强（Electron 内）:
        - 原生窗口控制、系统托盘、全局快捷键
        - 系统级右键菜单、文件对话框、自动更新
        - 通过 preload + IPC 安全暴露 Node.js 能力
    ${需要原生拓展 ? `原生模块（Electron 主进程）:
        - 可集成任何 C++/Node 原生模块，如 better-sqlite3、sharp 等` : ''}
    仓库/版本管理工具：${GIT_WITH_ITS_USAGE}、${SVN_WITH_ITS_USAGE}(v 1.14+)
  `;
}

export function 技术选型初始化(根目录 : string, 技术选型 : string): string {
  return `在${根目录}位置初始化如下技术选型：${技术选型}。
    检查当前设备上相关的安装项、工具和依赖是否完整，列出缺少的或需要升级的，确保技术栈所需要的项、工具和依赖都已正确安装和配置。
    暂时不要编写任何代码或做任何开发，也不要创建仓库, 仅将技术选型所需依赖初始化。
    `
  }

export function 中文为主的代码风格规范(): string {
  return `
    ## 1. 写代码时、提交前须检查，检查顺序：

    1. 这个词是不是公认专有词汇？
    2. 如果是，保留英文。如果专有词汇嵌入在句子中，可以中英文混合，如"_所有tokens"。
    3. 如果不是，优先中文。
    4. 有没有把 "token" 误翻成“标记”之类的词？（公认专有词汇不应生硬翻译）
    5. 这个方法是不是只在当前模块内部使用？如果是，加 "_"; 更强烈的私有可以加"__"。
    6. 如果方法名里用了英文，补中文注释。
    7. 如果方法名是英文句子，确保介词优先，避免"encode_sample_tokens"这样未能表达出”转变为“含义的简化命名。
    8. 如果方法名是中文，但逻辑明显偏复杂、数据结构不直观，也补中文注释。
    9. 人类阅读优先、口语优先、完整优先。不要为了短而简化命名，比如一个复杂数据结构"list[list[str]]"，不要把"全部训练样本的token列表"简化为不好理解的"token序列列表"。
    10. 这段代码里有没有该写 "NOTE:" 的特殊逻辑？
    11. 这段代码里有没有该写 "TODO:" 的空置位置？
    12. 同一作用域里，同一语义是否保持了单一表达。（参考第9点）
    13. 有没有把“同义统一”误解成“所有名词都要统一成一种语言（全英文或中文）”？（参考第9点）

    ## 2. 命名

    - 中文命名为主。
    - 公认专有词汇必须用英文，或中英混合命名，不硬翻。
    - 典型专有词汇包括："token"、"sample"、"dataset"、"train"、"validation"、"TimingPoint"、"HitObject"、"JSONL"、"DataLoader"、"batch"、"loss"、"checkpoint"、"CLI"。
    - "token" 必须写成 "token" / "tokens"，不能翻成“标记”“符号”“词元”。
    - 非专有词汇不要为了看起来整齐而强行改成英文。
    - 英文命名句式结构要完整，不要省略介词，比如"encode_sample_to_tokens"不要少了"to"

    例子：

    - 推荐："解析谱面内容"、"训练基线模型"、"encode_sample_to_tokens"
    - 不推荐："编码样本标记"
      原因："token" 是公认专有词汇，不能翻成“标记”。

    ## 3. 方法命名

    - 普通业务方法：优先中文。
    - 如果方法的核心动作和核心对象都属于公认专有词汇：直接用英文。

    例子：

    - "准备局部窗口样本"
    - "encode_sample_to_tokens"
    - "build_condition_vector"
    - "load_jsonl_samples"

    ## 4. Python 权限约定

    - 对外公开的方法、函数、类：不用前导下划线。
    - 明显只在模块内部使用的 helper：必须加前导 "_"。更强烈的私有可以加"__"。

    例子：

    - 公开："训练基线模型"、"encode_sample_to_tokens"
    - 私有："_时间分桶"、"_保存去重统计"
    - 强烈私有："__a_private_var"、"__时间"


    ## 5. 英文方法必须写中文注释

    所有英文命名的方法都必须补中文解释，优先写函数 docstring。

    注释要求：

    - 语言平易近人
    - 只保留公认专有词汇
    - 说清楚“这个方法做什么”
    - 说清楚“为什么需要它”
    - 如果一个地方值得做“反面解释”，就必须写出反面解释
    - 不要用空泛、炫技、看起来高级但不直白的说法

    这里的“反面解释”指的是：

    - 不只说“这样做有什么好处”
    - 还要说“如果不这样做，会出现什么问题”
    - 常见写法就是“如果不这样……就会……”

    推荐：

    """python
    def encode_sample_to_tokens(样本: 样本类型) -> list[str]:
        """把一个训练样本整理成模型可以直接学习的 tokens。

        这里会先写整体信息，再写按时间排序的事件。
        这样模型训练时就能根据前面的内容，预测后面的内容。
        如果不先整理成固定顺序的 tokens，当前这版基线模型就很难直接利用原始结构化数据。
        """
    """

    不推荐：

    - “将结构化样本映射为线性 token 序列”
    - “构建统一事件语义空间”

    ## 6. 复杂的中文方法也要写注释

    - 中文命名的方法，如果逻辑明显不止一眼能看懂，也要补中文解释。
    - 不要求每个中文方法都写注释，但下面这些情况应当补：
      - 有多步转换
      - 有去重、切分、回填、绑定上下文
      - 有窗口化、聚合、导出
      - 容易让人误解“为什么要这么做”
    - 注释重点同样是两件事：这个方法做什么，为什么需要它。
    - 如果一个逻辑值得做“反面解释”，这里也必须写出来。

    ## 7. 特殊逻辑要用 "NOTE:"

    - 如果一个方法或一段代码用了算法技巧、硬编码字面量、比较绕的不直观逻辑、或者只是当前阶段的临时逻辑，都必须补注释，并以 "NOTE:" 开头。
    - "NOTE:" 要直接解释这段逻辑为什么这样写，不要只重复代码表面行为。
    - 如果这段逻辑存在明显的反面后果，也要在 "NOTE:" 里写出来。
    - "NOTE:" 可以写在方法 docstring 里，也可以写成紧贴代码的行注释。

    例子：

    - "NOTE: 这里把时间按 100ms 分桶，是当前 baseline 为了控制词表大小的折中，后面可能改。"
    - "NOTE: 这里先按歌曲分组再切验证集，是为了避免同歌泄漏导致验证结果虚高。"
    - "NOTE: 这里先补窗口起点已经生效的 TimingPoint；如果不这样，窗口内部没有新 TimingPoint 时就会丢掉节奏上下文。"

    ## 8. 未来要补的地方用 "TODO:"

    - 如果一个地方明确决定先空着、以后再写，就必须用 "TODO:" 注释标出来。
    - "TODO:" 要写清楚以后准备补什么，不要只写“以后再说”。
    - 不能拿 "TODO:" 代替当前就该解释清楚的复杂逻辑；复杂逻辑用 "NOTE:"。

    例子：

    - "TODO: 这里后面补真正的音频编码器，不再只用轻量特征向量。"

    ## 8.1 类注释

    所有 class 都必须写中文注释，优先写类 docstring。

    注释要求须与前面已所说明的注释要求保持一致。

    适用场景：

    - 所有 "class" 定义，包括 dataclass、TypedDict、继承自第三方框架的类等
    - TypedDict 如果只是纯字段定义、一眼能看懂，可以只写一行简短注释
    - 继承自 "nn.Module"、"Dataset" 等框架的类，除了说清楚自己的作用外，可以顺便提一句"训练时会被谁使用"


    ## 9. 同一作用域内避免同义中英混用

    - 同一作用域内，同一语义只保留一种表达。
    - 不要同一个概念一会儿用中文，一会儿用英文。
    - 这条规则只限制“同义词混用”，不要求“所有名词都统一成一种语言”。
    - 非同义名词继续按前面的主规则判断：优先中文，公认专有词汇用英文。
    - 跨作用域允许不同表达，但单个作用域内部必须统一。

    例子：

    - 同一个函数里如果已经用了 "sample"，就不要再用“样本”表示同一个局部概念。
    - 同一个类里如果字段已经叫 "audio_hash"，相关局部命名不要再改成“音频哈希”表示同一语义。
    - 可以同时出现 "sample_object" 和 "训练结果"，因为它们不是同一个语义。
    - 允许："sample_object"、"训练结果"、"输出路径" 同时出现，因为它们不是同一个语义。
    - 不允许：同一个局部概念一会儿叫 "sample_object"，一会儿又叫“样本对象”。
    - 允许："token列表" 和 "训练结果" 同时出现，因为一个是专有词，一个是普通业务词。
    - 不允许：同一个概念一会儿叫 "token列表"，一会儿又叫“标记列表”。
    `
  }

  export function 强引用的基于TS代码的文档和注释原则():string{
  return `
    export const WIKI和NOTE须知_NOTE = () => \`
    有了\${CodeFileAsWiki_NOTE}就不需要传统文档了，有了\${RefAsAComment_NOTE}就不需要传统注释了。
    好处在于强链接性、语法级报错。
    务必注意：构建时剔除这些 XX_WIKI.ts 和 XX_NOTE，避免占据体积。
    \`

    export const RefAsAComment_NOTE = \`
    善加利用 ts的字符串、对象字面量等语法，将 XX_NOTE 插入到业务逻辑的类、函数、方法、变量前或后（而不是中间），方便引用和检查报错，实现注释/文档的强维护性。
    普通嵌套：可以通过 美元符+花括号 的方式实现 NOTE 嵌套 NOTE
    高级层次嵌套：可以通过对象字面量嵌套形成更精妙的高级的层次结构
    先使用后定义：ts的变量只能先定义后使用，但利用函数可以先使用后定义。
    警告：除非特殊设计要求，始终确保 XX_NOTE 不混入正常代码逻辑中。绝对不要因 NOTE混入 而拖累业务逻辑。
    \`

    export const CodeFileAsWiki_NOTE = 
    \`项目根目录的文档：REPO_WIKI.ts
    项目的其它文件夹下方维护一个以 文件夹大写字母_WIKE 命名的ts脚本，如：
        /packages 下方维护 PACKAGES_WIKE.ts
        /apps/ 下方维护 APPS_WIKI.ts
    每个文件夹都要，形成一棵 WIKI 树。
    WIKI 内部结构：
    基于 Note（参见\${RefAsAComment_NOTE}） 组成的类wiki百科的结构，由大量的文本引用/嵌套、对象字面量、段落划分、层级嵌套组成的结构化内容。
    跨文件夹组织：
    你可以通过 export 和 import 跨文件夹组织多个 XX_WIKI.ts
    \`

    export const REPO_WIKI = {
      WIKI维护:"（这句话永远应保留在本文档中：本WIKI应每轮更进，动态完善，适时重写。请多查看。记住: 罗马不是一天建成的）",
      文档与注释:\`切勿使用普通的文档与注释，因为它们缺乏引用性，非常容易遗忘。最佳实践：
      [Code file as Wiki]原则。\${CodeFileAsWiki_NOTE}
      [Ref as a Comment]原则。\${RefAsAComment_NOTE}
      你所看到的这个REPO_WIKI对象所在的ts文件就是最好的[Code file as Wiki]和[Ref as a Comment]实践。
      \${WIKI和NOTE须知_NOTE}\`,
    }
  `
  }

export function 文件规范(): string {
  return ""
}

export function 项目进度检查与报告机制(): string {
  return ""
}

export function 团队组建与角色分配(): string {
  return ""
}

export function 风险识别与应对预案(): string {
  return ""
}

export function 立项评审与成本确认(): string {
  return ""
}