import { ExecutionGraph, GraphNode, NodeType } from "../graph/types.js"

/**
 * 图基因组结构
 * 将图结构编码为进化算法中的基因组
 */
export interface GraphGenome {
  nodes: NodeGene[] // 节点基因列表
  edges: EdgeGene[] // 边基因列表
  fitness: number // 适应度分数
  generation: number // 所属代数
}

const AGENTS = ["developer", "senior-dev", "architect", "qa", "reviewer"] as const

/**
 * 节点基因结构
 * 包含节点的类型、代理和提示词信息
 */
export interface NodeGene {
  id: string
  type: NodeType
  agent: string // 代理类型
  promptGene: PromptGene // 提示词基因
}

/**
 * 边基因结构
 * 包含边的起止节点和条件信息
 */
export interface EdgeGene {
  from: string
  to: string
  conditionGene: ConditionGene
}

/**
 * 提示词基因结构
 */
export interface PromptGene {
  base: string // 基础提示词
  mutations: string[] // 变异历史
}

/**
 * 条件基因结构
 */
export interface ConditionGene {
  type: string
  field?: string
  value?: unknown
}

/**
 * 进化优化器
 * 使用遗传算法优化图结构
 * 通过选择、交叉、变异操作逐步进化出更优的图配置
 */
export interface EvolutionConfig {
  agents?: string[]
  simulateExecutionFn?: (genome: GraphGenome, task: string) => number
}

export class EvolutionaryOptimizer {
  private population: GraphGenome[] = []
  private generation = 0
  private agents: readonly string[]
  private simulateExecutionFn: (genome: GraphGenome, task: string) => number

  constructor(config: EvolutionConfig = {}) {
    this.agents = config.agents ?? AGENTS
    this.simulateExecutionFn =
      config.simulateExecutionFn ?? ((genome: GraphGenome, task: string) => this.defaultSimulateExecution(genome, task))
  }

  /**
   * 初始化种群
   * 从基础图创建多个变体
   * @param baseGraph 基础图
   * @param populationSize 种群大小
   * @returns 初始化后的种群
   */
  initializePopulation(baseGraph: ExecutionGraph, populationSize: number): GraphGenome[] {
    this.population = []

    for (let i = 0; i < populationSize; i++) {
      const genome = this.graphToGenome(baseGraph)
      genome.generation = 0
      if (i > 0) {
        // 第一个是个体是原始图，其他进行变异
        genome.nodes = this.mutateNodes(genome.nodes, 0.2)
        genome.edges = this.mutateEdges(genome.edges, 0.2)
      }
      this.population.push(genome)
    }

    return this.population
  }

  /**
   * 评估基因组适应度
   * @param genome 基因组
   * @param testCases 测试用例
   * @returns 适应度分数
   */
  evaluateFitness(genome: GraphGenome, testCases: Array<{ task: string; expectedScore: number }>): number {
    let totalScore = 0

    for (const tc of testCases) {
      const score = this.simulateExecution(genome, tc.task)
      totalScore += score
    }

    genome.fitness = totalScore / testCases.length
    return genome.fitness
  }

  /**
   * 锦标赛选择
   * @param population 种群
   * @param tournamentSize 锦标赛大小
   * @returns 选出的个体
   */
  select(population: GraphGenome[], tournamentSize: number): GraphGenome[] {
    const selected: GraphGenome[] = []

    for (let i = 0; i < population.length; i++) {
      const tournament: GraphGenome[] = []
      for (let j = 0; j < tournamentSize; j++) {
        const idx = Math.floor(Math.random() * population.length)
        tournament.push(population[idx]!)
      }
      tournament.sort((a, b) => b.fitness - a.fitness)
      selected.push(tournament[0]!)
    }

    return selected
  }

  /**
   * 交叉操作
   * 合并两个父本基因组的特征
   * @param parent1 父本1
   * @param parent2 父本2
   * @returns 子代基因组
   */
  crossover(parent1: GraphGenome, parent2: GraphGenome): GraphGenome {
    const childNodes =
      parent1.nodes.length > parent2.nodes.length
        ? parent1.nodes.slice(0, Math.floor(parent1.nodes.length / 2))
        : parent2.nodes.slice(Math.floor(parent2.nodes.length / 2))

    const childEdges =
      parent1.edges.length > parent2.edges.length
        ? parent1.edges.slice(0, Math.floor(parent1.edges.length / 2))
        : parent2.edges.slice(Math.floor(parent2.edges.length / 2))

    return {
      nodes: childNodes,
      edges: childEdges,
      fitness: 0,
      generation: this.generation,
    }
  }

  /**
   * 变异操作
   * @param genome 基因组
   * @param mutationRate 变异率
   * @returns 变异后的基因组
   */
  mutate(genome: GraphGenome, mutationRate: number): GraphGenome {
    const mutated = { ...genome, nodes: this.mutateNodes(genome.nodes, mutationRate) }
    mutated.edges = this.mutateEdges(mutated.edges, mutationRate)
    return mutated
  }

  /**
   * 进化主循环
   * @param params 进化参数
   * @returns 最优基因组
   */
  evolve(params: {
    initialGraph: ExecutionGraph
    generations: number
    populationSize: number
    testCases: Array<{ task: string; expectedScore: number }>
    targetFitness: number
  }): GraphGenome {
    this.generation = 0
    this.population = this.initializePopulation(params.initialGraph, params.populationSize)

    for (let gen = 0; gen < params.generations; gen++) {
      this.generation = gen

      // 评估所有个体适应度
      for (const genome of this.population) {
        this.evaluateFitness(genome, params.testCases)
      }

      // 按适应度排序
      this.population.sort((a, b) => b.fitness - a.fitness)

      // 达到目标适应度则停止
      if (this.population[0]!.fitness >= params.targetFitness) {
        return this.population[0]!
      }

      // 锦标赛选择
      const selected = this.select(this.population, 3)

      // 精英保留
      const newPopulation: GraphGenome[] = [this.population[0]!]

      // 生成新个体
      while (newPopulation.length < params.populationSize) {
        const parent1 = selected[Math.floor(Math.random() * selected.length)]!
        const parent2 = selected[Math.floor(Math.random() * selected.length)]!
        let child = this.crossover(parent1, parent2)
        child = this.mutate(child, 0.1)
        child.generation = gen
        newPopulation.push(child)
      }

      this.population = newPopulation
    }

    this.population.sort((a, b) => b.fitness - a.fitness)
    return this.population[0]!
  }

  /**
   * 将图转换为基因组表示
   */
  private graphToGenome(graph: ExecutionGraph): GraphGenome {
    const nodes: NodeGene[] = []
    const edges: EdgeGene[] = []

    for (const [id, node] of graph.nodes) {
      nodes.push({
        id,
        type: node.type,
        agent: node.config.agent ?? "default",
        promptGene: { base: node.config.prompt ?? "", mutations: [] },
      })
    }

    for (const edge of graph.edges) {
      edges.push({
        from: edge.from,
        to: edge.to,
        conditionGene: { type: edge.condition.type, field: edge.condition.field, value: edge.condition.value },
      })
    }

    return { nodes, edges, fitness: 0, generation: 0 }
  }

  /**
   * 节点变异
   */
  private mutateNodes(nodes: NodeGene[], rate: number): NodeGene[] {
    return nodes.map((node) => {
      if (Math.random() < rate) {
        return {
          ...node,
          agent: this.randomAgent(),
          promptGene: {
            base: node.promptGene.base,
            mutations: [...node.promptGene.mutations, `mutation_${Date.now()}`],
          },
        }
      }
      return node
    })
  }

  /**
   * 边变异
   */
  private mutateEdges(edges: EdgeGene[], rate: number): EdgeGene[] {
    return edges.map((edge) => {
      if (Math.random() < rate) {
        return {
          ...edge,
          conditionGene: { type: "always" },
        }
      }
      return edge
    })
  }

  /**
   * 随机选择代理类型
   */
  private randomAgent(): string {
    return this.agents[Math.floor(Math.random() * this.agents.length)] ?? "developer"
  }

  /**
   * 默认模拟执行实现
   */
  private defaultSimulateExecution(genome: GraphGenome, task: string): number {
    return Math.random() * 0.5 + 0.3 + (genome.nodes.length > 3 ? 0.2 : 0)
  }

  /**
   * 模拟执行并计算得分
   */
  private simulateExecution(genome: GraphGenome, task: string): number {
    return this.simulateExecutionFn(genome, task)
  }
}
