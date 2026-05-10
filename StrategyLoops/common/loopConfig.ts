export class LoopConfig {

  public startPrompt: string = "准备好开始了吗？"

  public maxCycles: number = 3

  public staticCheckMaxRetries: number = 10

  constructor(params?: { maxCycles?: number, startPrompt: string, staticCheckMaxRetries?: number }) {
    if (params?.maxCycles !== undefined) {
      this.maxCycles = params.maxCycles
    }
    if (params?.startPrompt !== undefined) {
      this.startPrompt = params.startPrompt
    }
    if (params?.staticCheckMaxRetries !== undefined) {
      this.staticCheckMaxRetries = params.staticCheckMaxRetries
    }
  }
}
