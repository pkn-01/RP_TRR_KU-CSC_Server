import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // In certain situations `httpAdapter` might not be available in the
    // constructor method, thus we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      message: (exception as any).message || 'Internal server error',
      error: (exception as any).name || 'UnknownError',
    };

    this.logger.error(
      `Exception thrown at ${responseBody.path}: ${JSON.stringify(responseBody)}`,
      (exception as any).stack,
    );
    
    // Also console.error for immediate visibility in terminal
    console.error('CRITICAL BACKEND ERROR:', exception);

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
