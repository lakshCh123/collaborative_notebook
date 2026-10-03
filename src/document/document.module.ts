import { Module } from '@nestjs/common';

import { DocumentController } from './document.controller.js';
import { DocumentMergeService } from './document.merge.service.js';
import { DocumentHistoryService } from './document.getDocumentVersions.service.js';
import { DocumentCreateService } from './docomument.create.service.js';

import { DatabaseModule } from '../database/database.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { DocumentCurrentVersionService } from './document.currentVersion.service.js';

@Module({
  imports: [
    DatabaseModule,
    IdempotencyModule,
  ],
  controllers: [DocumentController],
  providers: [
    DocumentCurrentVersionService,
    DocumentCreateService,
    DocumentMergeService,
    DocumentHistoryService,
  ],
})
export class DocumentModule {}