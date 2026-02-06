import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { TicketsModule } from './tickets/tickets.module';
import { NotificationModule } from './notification/notification.module';
import { UsersModule } from './users/users.module';
import { LoansModule } from './loans/loans.module';
import { LineOAModule } from './line-oa/line-oa.module';
import { RepairsModule } from './repairs/repairs.module';
import { StockModule } from './stock/stock.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { DataManagementModule } from './data-management/data-management.module';
import { JwtAuthGuard } from './auth/jwt.guard';

@Module({
  imports: [
    // Rate Limiting - 20 requests per 60 seconds per IP
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 20,
    }]),
    AuthModule,
    TicketsModule,
    NotificationModule,
    UsersModule,
    LoansModule,
    LineOAModule,
    RepairsModule,
    StockModule,
    CloudinaryModule,
    DataManagementModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

