import 'dotenv/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import * as express from 'express';
import helmet from 'helmet';

import { join } from 'path';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  
  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));


  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, 
  }));


  app.use(compression());


  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));


  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`[REQUEST] ${req.method} ${req.url}`);
      next();
    });
  }

  // CORS Configuration
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://rp-trr-ku-csc-2026.vercel.app',
    'https://qa-rp-trr-ku-csc.vercel.app',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        const logger = new Logger('CORS');
        logger.warn(`ไม่อนุญาตให้เข้าถึง: ${origin}`);
        callback(new Error('ไม่อนุญาตให้เข้าถึง'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`เซิฟเวอร์ทำงานที่: ${await app.getUrl()}`);
}

bootstrap();

