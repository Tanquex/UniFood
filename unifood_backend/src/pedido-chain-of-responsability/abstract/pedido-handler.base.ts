import { PedidoContext } from '../interfaces/pedido-context.interface';



export abstract class PedidoHandler {
  protected nextHandler: PedidoHandler | null = null;
  protected handlerName: string;

  constructor(handlerName: string) {
    this.handlerName = handlerName;
  }

  setNext(handler: PedidoHandler): PedidoHandler {
    this.nextHandler = handler;
    return handler;
  }

  async handle(context: PedidoContext): Promise<void> {
    try {
      this.emitProgress(context, 'processing');

      await this.delay(500);

      await this.process(context);

      this.emitProgress(context, 'success');
      await this.delay(800);

      if (this.nextHandler) {
        await this.nextHandler.handle(context);
      }
    } catch (error) {
      this.emitProgress(context, 'error', error.message);
      await this.delay(800);
      throw error;
    }
  }

  private emitProgress(
    context: PedidoContext,
    status: 'processing' | 'success' | 'error',
    message?: string,
  ) {
    if (context.gateway) {
      context.gateway.emitValidacionProgreso(context.clienteId, {
        handler: this.handlerName,
        status,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected abstract process(context: PedidoContext): Promise<void>;
}
