import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private logger = new Logger('JwtAuthGuard');

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    
    // Log incoming request
    this.logger.debug(`[${method}] ${url}`);
    this.logger.debug('Authorization header:', request.headers.authorization ? 'Present' : 'Missing');
    
    // Skip CORS preflight requests
    if (request.method === 'OPTIONS') {
      this.logger.debug('Skipping OPTIONS request');
      return true;
    }
    
    // Check if endpoint is marked as public - first check method
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) {
      this.logger.debug(`✅ Endpoint ${method} ${url} is public, skipping JWT validation`);
      return true;
    }

    // Also check class-level public metadata
    const isClassPublic = this.reflector.get<boolean>('isPublic', context.getClass());
    if (isClassPublic) {
      this.logger.debug(`✅ Class ${method} ${url} is public, skipping JWT validation`);
      return true;
    }
    
    // Check if URL path contains 'liff' which should be public
    if (url.includes('/liff/')) {
      this.logger.debug(`✅ LIFF endpoint detected, skipping JWT validation`);
      return true;
    }

    this.logger.debug('Validating JWT token...');
    const result = super.canActivate(context);
    
    // Handle async result
    if (result instanceof Promise) {
      return result.catch((err) => {
        this.logger.error('JWT validation failed:', err.message);
        throw new UnauthorizedException('Invalid or expired token');
      });
    }
    
    return result;
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    
    if (err || !user) {
      const logger = new Logger('JwtAuthGuard.handleRequest');
      logger.error('Authentication failed', {
        error: err?.message,
        info: info?.message,
        url: request.url,
      });
      throw err || new UnauthorizedException('Invalid or expired token');
    }
    
    return user;
  }
}



