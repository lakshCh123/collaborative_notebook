import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { IdempotencyService } from './idempotency.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}