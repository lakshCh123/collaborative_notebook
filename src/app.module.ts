import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { createObserveModule } from '@nestjs/observe';
import { join } from 'path';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DocumentModule } from './document/document.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'),
    }),

    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'offline_sync',
    }),

    DocumentModule,

    IdempotencyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}