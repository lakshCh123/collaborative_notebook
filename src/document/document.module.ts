import { Module } from '@nestjs/common';

import { DocumentController } from './document.controller.js';
import { DocumentMergeService } from './document.merge.service.js';
import { DocumentHistoryService} from './document.getDocumentVersions.service.js';
import { DocumentCreateService } from './docomument.create.service.js';

@Module({
  controllers: [DocumentController],
  providers: [
    DocumentCreateService,
    DocumentMergeService,
    DocumentHistoryService,
  ],
})
export class DocumentModule {}