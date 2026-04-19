import { CIRCUIT_BREAKER_TIMEOUT } from "../constants.js"

/**
 * 熔断器状态
 */
export type CircuitState = "closed" | "open" | "half-open"

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  failureThreshold: number
  successThreshold: number
  timeout: number
}

const defaultConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: CIRCUIT_BREAKER_TIMEOUT,
}

/**
 * 熔断器
 * 用于防止级联失败的模式
 */
export class CircuitBreaker {
  private state: CircuitState = "closed"
  private failureCount = 0
  private successCount = 0
  private nextAttempt = 0
  private config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...defaultConfig, ...config }
  }

  isOpen(): boolean {
    if (this.state === "closed") return false
    if (this.state === "open" && Date.now() >= this.nextAttempt) {
      this.state = "half-open"
    }
    return this.state === "open"
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.successCount++
      if (this.successCount >= this.config.successThreshold) {
        this.state = "closed"
        this.failureCount = 0
        this.successCount = 0
      }
    } else if (this.state === "closed") {
      this.failureCount = Math.max(0, this.failureCount - 1)
    }
  }

  recordFailure(): void {
    this.failureCount++
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = "open"
      this.nextAttempt = Date.now() + this.config.timeout
    }
  }

  reset(): void {
    this.state = "closed"
    this.failureCount = 0
    this.successCount = 0
    this.nextAttempt = 0
  }

  getState(): CircuitState {
    return this.state
  }

  getConfig(): CircuitBreakerConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
