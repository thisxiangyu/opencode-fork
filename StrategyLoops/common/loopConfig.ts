export class LoopConfig {
  public maxCycles: number = 1

  constructor(params?: { maxCycles?: number }) {
    if (params?.maxCycles !== undefined) {
      this.maxCycles = params.maxCycles
    }
  }
}